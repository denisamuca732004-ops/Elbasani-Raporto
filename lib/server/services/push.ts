/**
 * "Më njoftoni në këtë telefon": free notifications on the resident's phone
 * (browser push), only when they ask for it while reporting, and only at the
 * three moments that matter to them:
 *  - the sector took the report into work (IN_PROGRESS);
 *  - the Municipality marked it fixed, with the "A u rregullua?" link;
 *  - it was refused or merged into another report, with the reason.
 * No account and no phone number are needed: the browser gives a subscription
 * for this device, kept with the report. It is deleted when the push service
 * says it no longer exists, after the last notification (closed or refused)
 * and with the resident's contact data (maintenance.eraseOldContacts).
 * The keys (VAPID) come from AUTH_SECRET, so nothing has to be configured;
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY override them.
 */
import 'server-only';
import { createECDH, createHmac } from 'node:crypto';
import webpush from 'web-push';
import { db } from '../db';
import { config } from '../env';
import { badRequest, notFound, tooMany } from '../errors';
import { feedbackUrl, trackUrl } from '../mailTemplates';
import { enqueue } from '../queue';

export type PushMoment = 'in_progress' | 'resolved' | 'rejected';

/** Only these push services: the server never posts to an address a browser made up. */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/;
const MAX_PER_REPORT = 5;

const b64url = (b: Buffer) => b.toString('base64url');
let keys: { publicKey: string; privateKey: string } | null = null;

/** The VAPID key pair: from the environment, or derived from AUTH_SECRET (stable across deployments). */
export function vapidKeys(): { publicKey: string; privateKey: string } {
  const p = config().push;
  if (p.publicKey && p.privateKey) return { publicKey: p.publicKey, privateKey: p.privateKey };
  if (!keys) {
    const priv = createHmac('sha256', config().auth.secret).update('elbasani-raporton:vapid:p256').digest();
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(priv);
    keys = { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(priv) };
  }
  return keys;
}

/** The public key the browser needs to subscribe, or null when notifications are off. */
export function pushPublicKey(): string | null {
  return config().push.enabled ? vapidKeys().publicKey : null;
}

export interface SubscriptionInput { endpoint: string; keys: { p256dh: string; auth: string } }

/**
 * The resident who just sent the report asks for notifications on this device. Proof that it is
 * them: the random reference their form made (clientRef), which only that browser knows.
 */
export async function subscribeToReport(input: { caseNumber: string; clientRef: string; subscription: SubscriptionInput; lang: 'sq' | 'en' }): Promise<void> {
  if (!config().push.enabled) throw badRequest('Njoftimet nuk janë aktive.');
  let host = '';
  try {
    const url = new URL(input.subscription.endpoint);
    host = url.protocol === 'https:' ? url.hostname : '';
  } catch { /* not a URL */ }
  if (!PUSH_HOSTS.test(host)) throw badRequest('Ky shfletues nuk mund të marrë njoftime.');
  const report = await db.report.findUnique({ where: { caseNumber: input.caseNumber }, select: { id: true, clientRef: true, isTest: true, _count: { select: { pushSubscriptions: true } } } });
  if (!report || !report.clientRef || report.clientRef !== input.clientRef) throw notFound('Raportimi nuk u gjet.');
  const data = { p256dh: input.subscription.keys.p256dh, auth: input.subscription.keys.auth, lang: input.lang };
  const existing = await db.pushSubscription.findUnique({ where: { reportId_endpoint: { reportId: report.id, endpoint: input.subscription.endpoint } } });
  if (existing) {
    await db.pushSubscription.update({ where: { id: existing.id }, data });
    return;
  }
  if (report._count.pushSubscriptions >= MAX_PER_REPORT) throw tooMany('Ky raportim ka tashmë shumë pajisje për njoftime.');
  await db.pushSubscription.create({ data: { reportId: report.id, endpoint: input.subscription.endpoint, ...data } });
}

export async function hasPushSubscribers(reportId: string): Promise<boolean> {
  return (await db.pushSubscription.count({ where: { reportId } })) > 0;
}

const TEXT: Record<'sq' | 'en', Record<PushMoment, { title: string; body: (n: string, note: string | null) => string }>> = {
  sq: {
    in_progress: { title: 'Raportimi juaj është në punë', body: (n, note) => `${n}: sektori përgjegjës e ka marrë në punë.${note ? ` ${note}` : ''}` },
    resolved: { title: 'Bashkia e shënoi si të rregulluar', body: (n, note) => `${n}: ${note ? `${note} ` : ''}A u rregullua vërtet? Na tregoni.` },
    rejected: { title: 'Raportimi juaj u mbyll', body: (n, note) => `${n}: ${note ?? 'shihni arsyen në faqen e raportimit.'}` },
  },
  en: {
    in_progress: { title: 'Your report is being worked on', body: (n, note) => `${n}: the responsible sector has taken it on.${note ? ` ${note}` : ''}` },
    resolved: { title: 'The Municipality marked it fixed', body: (n, note) => `${n}: ${note ? `${note} ` : ''}Was it really fixed? Let us know.` },
    rejected: { title: 'Your report was closed', body: (n, note) => `${n}: ${note ?? 'see the reason on the report page.'}` },
  },
};

const short = (s: string | null, max = 140) => (s && s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : s);

export function pushMessage(moment: PushMoment, caseNumber: string, note: string | null, lang: 'sq' | 'en', feedbackToken?: string) {
  const t = TEXT[lang][moment];
  return {
    title: t.title,
    body: t.body(caseNumber, short(note?.trim() || null)),
    url: moment === 'resolved' && feedbackToken ? feedbackUrl(feedbackToken) : trackUrl(caseNumber),
    tag: `report-${caseNumber}`,
  };
}

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<void>;
let sender: Sender = async (sub, payload) => {
  const { publicKey, privateKey } = vapidKeys();
  const app = config().appUrl;
  await webpush.sendNotification(sub, payload, {
    vapidDetails: { subject: app.startsWith('https://') ? app : 'mailto:noreply@elbasani-raporton.app', publicKey, privateKey },
    TTL: 86_400, timeout: 10_000, urgency: 'normal',
  });
};
export function setPushSenderForTests(fn: Sender): void {
  sender = fn;
}

/** Queues the notification (the person who changed the status never waits for it). */
export async function queuePush(reportId: string, moment: PushMoment, note: string | null, feedbackToken?: string): Promise<void> {
  if (!config().push.enabled || !(await hasPushSubscribers(reportId))) return;
  await enqueue('push', { reportId, moment, note: short(note, 300), ...(feedbackToken ? { feedbackToken } : {}) });
}

/** Background job: sends it to every device of the report; gone subscriptions are deleted. */
export async function sendReportPush(p: { reportId: string; moment: PushMoment; note?: string | null; feedbackToken?: string }): Promise<number> {
  const report = await db.report.findUnique({ where: { id: p.reportId }, select: { caseNumber: true, isTest: true, pushSubscriptions: true } });
  if (!report || report.isTest) return 0;
  let sent = 0;
  for (const s of report.pushSubscriptions) {
    const message = pushMessage(p.moment, report.caseNumber, p.note ?? null, s.lang === 'en' ? 'en' : 'sq', p.feedbackToken);
    try {
      await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(message));
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      else console.error('[push] not sent:', status ?? (err instanceof Error ? err.message : err));
    }
  }
  // A refused or merged report has nothing more to tell.
  if (p.moment === 'rejected') await db.pushSubscription.deleteMany({ where: { reportId: p.reportId } });
  return sent;
}
