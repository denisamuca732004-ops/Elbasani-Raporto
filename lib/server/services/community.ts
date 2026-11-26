/**
 * "Ndihmo qytetin": residents fix small problems themselves, alone or with others,
 * and the group gets ONE prize (one per action, never one per person: making many
 * cards would earn nothing).
 *
 *  1. Creating: the organiser gives the "before" photo, what, where, when, how many
 *     people. The AI checks it is safe and fit for residents (no electricity, big
 *     trees, traffic, heights, dangerous material, private property). Clear cases
 *     are published at once; doubtful ones (or without the AI) wait for a person.
 *  2. Joining: on the spot, each person scans the QR on the organiser's phone. The
 *     QR changes every 30 seconds (a screenshot sent on WhatsApp is useless), works
 *     only around the action's time and only within MAX_JOIN_METERS of its point.
 *  3. Closing: only the organiser closes it, with the "after" photo. The AI compares
 *     the two photos; a sure result is verified at once, otherwise a person looks.
 *     A person also looks at valuable prizes and at a random 1 in 10.
 *  4. Prize: by the number of people (settings.tiers), within the monthly budget and
 *     at most one prize a month per organiser's phone. Everyone who scanned is told.
 *     The organiser chooses coffee with friends or the market discount, once; the
 *     prize code is used once (the partner marks it with its PIN).
 *  5. Neighbours can answer "A u bë vërtet?". Two "No" hold the prize for the admin.
 */
import 'server-only';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type {
  ActionCard, AdminActionItem, CommunitySettings, OrganizerAction, Principal, PrizeView, PublicAction,
} from '@/lib/shared/types';
import type { CommunitySettingsInput } from '@/lib/validation/community';
import { AiRefusedError, AiUnavailableError, aiEnabled, chatJson, hideKeys, type AiJson } from '../ai';
import { db, type Prisma } from '../db';
import type { ActionStatus } from '@/lib/generated/prisma/enums';
import { AppError, badRequest, conflict, forbidden, notFound, tooMany } from '../errors';
import { enqueue } from '../queue';
import { config } from '../env';
import { deleteStoredImage, imageDataUrl, storeUploadedPhoto } from '../storage';
import { createToken, hashToken, sha256 } from '../tokens';
import { assertAdmin } from './access';
import { distanceMeters, insideServiceArea } from './geo';
import { smallPhoto } from './photoCheck';
import { isPushEndpoint, pushToDevice } from './push';

/* ─── Rules ─── */

export const JOIN_WINDOW_SECONDS = 30;
export const MAX_JOIN_METERS = 250;
/** Scanning opens this long before the start and stays open this long after the planned end. */
const JOIN_OPENS_BEFORE_MS = 30 * 60_000;
const JOIN_CLOSES_AFTER_MS = 3 * 3600_000;
/** An action never closed by its organiser is cancelled this long after its planned end. */
const STALE_AFTER_MS = 48 * 3600_000;
const MAX_ACTIVE_PER_PHONE = 2;
const MAX_JOINS_PER_DEVICE_DAY = 3;
const PUBLISH_MIN_CONFIDENCE = 80;
const VERIFY_MIN_CONFIDENCE = 90;
const NOT_DONE_VOTES_TO_HOLD = 2;
const VOTE_DAYS = 7;
const ACTIVE: ActionStatus[] = ['REVIEW', 'PUBLISHED', 'CLOSING'];

let spotCheck = () => Math.random() < 0.1;
/** Tests: decide the random check. */
export function setSpotCheckForTests(fn: () => boolean): void {
  spotCheck = fn;
}

/* ─── Settings ─── */

const SETTINGS_KEY = 'community';
interface StoredSettings extends Omit<CommunitySettings, 'hasPartnerPin'> { partnerPinHash?: string | null }
const DEFAULTS: StoredSettings = {
  enabled: true,
  // The MVP: no QR check-in and no rewards. The AI publishes clear, safe actions; the staff checks the rest and verifies the closing.
  rewards: false,
  tiers: [{ minPeople: 1, amount: 200 }, { minPeople: 3, amount: 300 }, { minPeople: 6, amount: 500 }],
  coffeePartner: 'Kafe partnere',
  marketPartner: 'Market partner',
  monthlyBudget: 20_000,
  checkFrom: 500,
  partnerPinHash: null,
};

async function storedSettings(): Promise<StoredSettings> {
  const row = await db.setting.findUnique({ where: { key: SETTINGS_KEY } });
  return { ...DEFAULTS, ...((row?.value ?? {}) as Partial<StoredSettings>) };
}

export async function getCommunitySettings(): Promise<CommunitySettings> {
  const { partnerPinHash, ...rest } = await storedSettings();
  return { ...rest, tiers: [...rest.tiers].sort((a, b) => a.minPeople - b.minPeople), hasPartnerPin: Boolean(partnerPinHash) };
}

export async function updateCommunitySettings(user: Principal, input: CommunitySettingsInput): Promise<CommunitySettings> {
  assertAdmin(user);
  const current = await storedSettings();
  const tiers = [...input.tiers].sort((a, b) => a.minPeople - b.minPeople);
  if (tiers[0]!.minPeople !== 1) throw badRequest('Niveli i parë i çmimit duhet të nisë nga 1 person.');
  const value: StoredSettings = {
    enabled: input.enabled, rewards: input.rewards, tiers, coffeePartner: input.coffeePartner, marketPartner: input.marketPartner,
    monthlyBudget: input.monthlyBudget, checkFrom: input.checkFrom,
    partnerPinHash: input.partnerPin ? sha256(`partner-pin:${input.partnerPin}`) : current.partnerPinHash ?? null,
  };
  await db.setting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value: value as unknown as Prisma.InputJsonValue }, update: { value: value as unknown as Prisma.InputJsonValue } });
  return getCommunitySettings();
}

/** The full version (QR check-in on the spot, rewards, AI approval) is on; otherwise the simple MVP. */
async function checkInOn(): Promise<boolean> {
  return (await getCommunitySettings()).rewards;
}

export function prizeForPeople(tiers: CommunitySettings['tiers'], people: number): number {
  let amount = 0;
  for (const t of [...tiers].sort((a, b) => a.minPeople - b.minPeople)) if (people >= t.minPeople) amount = t.amount;
  return amount;
}

/* ─── Small helpers ─── */

/** Albanian phone numbers in one form (06x…), so "+355 69…" and "069…" are the same organiser. */
export function normalizePhone(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00355')) d = d.slice(5);
  else if (d.startsWith('355')) d = d.slice(3);
  if (d.length === 9 && d.startsWith('6')) d = `0${d}`;
  return d;
}

const tiraneMonth = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tirane', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
function monthStart(now: Date): Date {
  // The first day of this month in Tirana, as an instant (a day early is fine for a monthly count).
  const [y, m] = tiraneMonth(now).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1) - 2 * 3600_000);
}

export function joinTokenAt(secret: string, at: number): string {
  const window = Math.floor(at / 1000 / JOIN_WINDOW_SECONDS);
  return createHmac('sha256', secret).update(`join:${window}`).digest('base64url').slice(0, 12);
}
function joinTokenValid(secret: string, token: string, now: number): boolean {
  for (const at of [now, now - JOIN_WINDOW_SECONDS * 1000]) {
    const expected = Buffer.from(joinTokenAt(secret, at));
    const given = Buffer.from(token);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true;
  }
  return false;
}

function joinOpen(a: { status: ActionStatus; startsAt: Date; minutes: number }, now = Date.now()): boolean {
  if (a.status !== 'PUBLISHED') return false;
  const start = a.startsAt.getTime();
  return now >= start - JOIN_OPENS_BEFORE_MS && now <= start + a.minutes * 60_000 + JOIN_CLOSES_AFTER_MS;
}

const PRIZE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function prizeCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += PRIZE_ALPHABET[randomInt(PRIZE_ALPHABET.length)];
  return s;
}

async function nextCode(now = new Date()): Promise<string> {
  const year = now.getFullYear();
  const last = await db.communityAction.findFirst({ where: { code: { startsWith: `AK-${year}-` } }, orderBy: { code: 'desc' }, select: { code: true } });
  const n = last ? Number(last.code.split('-')[2]) + 1 : 1;
  return `AK-${year}-${String(n).padStart(4, '0')}`;
}

const photoUrl = (id: string | undefined) => (id ? `/api/public/action-photos/${id}` : null);

type ActionWithAll = Prisma.CommunityActionGetPayload<{ include: { participants: true; photos: true; votes: true } }>;
const WITH_ALL = { participants: { orderBy: { joinedAt: 'asc' } }, photos: { orderBy: { createdAt: 'asc' } }, votes: true } as const;

/** withPrize: only for the organiser, the people who took part and the admin (others never see money). */
function toPublic(a: ActionWithAll, now = Date.now(), withPrize = false, checkIn = false): PublicAction {
  const before = a.photos.find((p) => p.kind === 'BEFORE' && p.isPublic);
  const after = a.photos.find((p) => p.kind === 'AFTER' && p.isPublic);
  const showPrize = withPrize && a.status === 'VERIFIED' && a.prizeAmount !== null;
  return {
    code: a.code,
    status: a.status,
    title: a.title,
    description: a.description,
    bring: a.bring,
    place: a.place,
    latitude: a.latitude,
    longitude: a.longitude,
    startsAt: a.startsAt.toISOString(),
    minutes: a.minutes,
    peopleNeeded: a.peopleNeeded,
    organizerName: a.organizerName,
    people: a.participants.length + 1,
    names: a.participants.map((p) => p.name).filter((n): n is string => Boolean(n)),
    beforePhotoUrl: photoUrl(before?.id),
    afterPhotoUrl: photoUrl(after?.id),
    joinOpen: checkIn && joinOpen(a, now),
    checkIn,
    prize: showPrize ? {
      amount: a.prizeAmount!, choice: a.prizeChoice, partner: a.prizePartner, held: a.prizeHeld, redeemed: Boolean(a.prizeRedeemedAt),
    } : null,
    votes: { done: a.votes.filter((v) => v.done).length, notDone: a.votes.filter((v) => !v.done).length },
    rejectReason: a.status === 'REJECTED' || a.status === 'NOT_VERIFIED' ? a.rejectReason : null,
    closedAt: a.closedAt?.toISOString() ?? null,
    verifiedAt: a.verifiedAt?.toISOString() ?? null,
  };
}

async function loadByCode(code: string): Promise<ActionWithAll> {
  const a = await db.communityAction.findUnique({ where: { code: code.toUpperCase() }, include: WITH_ALL });
  if (!a) throw notFound('Aksioni nuk u gjet.');
  return a;
}

async function loadAsOrganizer(code: string, token: string): Promise<ActionWithAll> {
  const a = await loadByCode(code);
  const expected = Buffer.from(a.organizerTokenHash);
  const given = Buffer.from(hashToken(token));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw forbidden('Vetëm organizatori mund ta bëjë këtë.');
  return a;
}

async function assertEnabled(): Promise<CommunitySettings> {
  const s = await getCommunitySettings();
  if (!s.enabled) throw new AppError(503, 'COMMUNITY_OFF', '“Ndihmo qytetin” nuk është aktiv tani.');
  return s;
}

/* ─── The AI ─── */

const CHECK_SYSTEM = `You check an action that residents of Elbasan (Albania) want to organise themselves to fix a small problem in a public place (for example: pick up litter, clean a small park, clear leaves from a drain, repaint a bench).
You get the photo of the place and the text of the action. Answer ONLY with a JSON object:
{
  "safe": boolean,         // false for anything dangerous for ordinary residents: electricity or lamps, cutting or climbing big trees, work on roads with traffic, heights or roofs, deep water, asbestos, chemicals, syringes, dead or aggressive animals, building or demolition, heavy machinery.
  "appropriate": boolean,  // false for: private property, political or commercial promotion, insults, anything that is not fixing something in a public place, or a photo that is not of a place.
  "confidence": number,    // 0-100: how sure you are about both answers.
  "reasonSq": string       // one short sentence IN ALBANIAN with the reason (especially when safe or appropriate is false).
}`;

const DRAFT_SYSTEM = `You help a resident of Elbasan (Albania) invite neighbours to fix a small problem in a public place themselves, starting from a photo.
Write every text in the LANGUAGE given in the request ("Albanian" or "English"), even though the keys end in "Sq".
Answer ONLY with a JSON object:
{
  "citizensCanDo": boolean,  // true only when ordinary residents can do it safely with simple tools in under 3 hours (litter, leaves, small cleaning, painting). False for electricity, big trees, traffic, heights, dangerous material, building work, animals.
  "problemSq": string,       // the kind of problem in that language in 2-4 words, e.g. "Mbeturina të shpërndara"
  "titleSq": string,         // a short friendly title in that language, e.g. "Pastrojmë këndin e lojërave", max 60 characters.
  "descriptionSq": string,   // 1-3 friendly sentences in that language inviting people: what we will do and why. No names, no promises of money.
  "peopleNeeded": number,    // 1-20
  "minutes": number,         // 15-240
  "bringSq": string,         // what to bring, in that language, e.g. "Doreza dhe thasë mbeturinash"
  "reasonSq": string         // when citizensCanDo is false: one short sentence in that language why the Municipality should handle it
}`;

const CLOSE_SYSTEM = `Residents of Elbasan (Albania) organised an action to fix a small problem in a public place. Compare their two photos of the same place: the first BEFORE, the second AFTER.
Answer ONLY with a JSON object:
{
  "samePlace": boolean,   // the two photos show the same place
  "done": boolean,        // the problem visible before is clearly gone or much better after
  "confidence": number,   // 0-100: how sure you are about done (lower it if the place is not clearly the same)
  "reasonSq": string      // one short sentence IN ALBANIAN on what changed
}`;

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export interface ActionDraft {
  available: boolean; citizensCanDo: boolean; problem: string; title: string; description: string; peopleNeeded: number; minutes: number; bring: string; reason: string;
}

/** "Shkruaje me AI": a proposal for the form from the photo (and a few words). The organiser changes what they want. */
export async function draftAction(photoKey: string, notes: string, lang: 'sq' | 'en' = 'sq'): Promise<ActionDraft> {
  const none: ActionDraft = { available: false, citizensCanDo: true, problem: '', title: '', description: '', peopleNeeded: 3, minutes: 60, bring: '', reason: '' };
  if (!aiEnabled()) return none;
  const small = await smallPhoto(photoKey);
  if (!small) return none;
  try {
    const a = await chatJson({
      kind: 'action-draft', system: DRAFT_SYSTEM,
      userText: JSON.stringify({ language: lang === 'en' ? 'English' : 'Albanian', residentNotes: notes.slice(0, 500) }),
      imageDataUrls: [`data:image/jpeg;base64,${small.toString('base64')}`],
      cacheKey: sha256(`action-draft:v3:${config().ai.model}:${lang}:${photoKey}:${notes}`),
    });
    return {
      available: true,
      citizensCanDo: a.citizensCanDo !== false,
      problem: text(a.problemSq, 60),
      title: text(a.titleSq, 60),
      description: text(a.descriptionSq, 600),
      peopleNeeded: num(a.peopleNeeded, 1, 20, 3),
      minutes: num(a.minutes, 15, 240, 60),
      bring: text(a.bringSq, 200),
      reason: text(a.reasonSq, 300),
    };
  } catch (err) {
    if (err instanceof AiRefusedError) return { ...none, available: true, citizensCanDo: false, reason: lang === 'en' ? 'The photo cannot be used.' : 'Fotoja nuk mund të përdoret.' };
    if (err instanceof AiUnavailableError) {
      console.error('[action-draft] AI unavailable:', hideKeys(err.message));
      return none;
    }
    throw err;
  }
}

async function checkNewAction(photo: Buffer | null, input: { title: string; description: string; bring: string; place: string }):
  Promise<{ safe: boolean | null; confidence: number | null; reason: string | null; publish: boolean; review: string | null }> {
  if (!aiEnabled() || !photo) return { safe: null, confidence: null, reason: null, publish: false, review: 'AI nuk e kontrolloi: shikojeni para se të publikohet.' };
  let a: AiJson;
  try {
    a = await chatJson({
      kind: 'action-check', system: CHECK_SYSTEM,
      userText: JSON.stringify({ title: input.title, description: input.description, bring: input.bring, place: input.place }),
      imageDataUrls: [`data:image/jpeg;base64,${photo.toString('base64')}`],
    });
  } catch (err) {
    if (err instanceof AiRefusedError) return { safe: false, confidence: 100, reason: 'Fotoja u refuzua nga kontrolli.', publish: false, review: 'Fotoja u refuzua nga kontrolli i AI.' };
    if (err instanceof AiUnavailableError) {
      console.error('[action-check] AI unavailable:', hideKeys(err.message));
      return { safe: null, confidence: null, reason: null, publish: false, review: 'AI nuk u përgjigj: shikojeni para se të publikohet.' };
    }
    throw err;
  }
  const safe = a.safe !== false;
  const appropriate = a.appropriate !== false;
  const confidence = num(a.confidence, 0, 100, 0);
  const reason = text(a.reasonSq, 300) || null;
  const publish = safe && appropriate && confidence >= PUBLISH_MIN_CONFIDENCE;
  const review = publish ? null
    : !safe ? `AI: mund të jetë e rrezikshme për qytetarët.${reason ? ` ${reason}` : ''}`
      : !appropriate ? `AI: nuk duket aksion në hapësirë publike.${reason ? ` ${reason}` : ''}`
        : `AI nuk është i sigurt (${confidence}%).${reason ? ` ${reason}` : ''}`;
  return { safe: safe && appropriate, confidence, reason, publish, review };
}

/* ─── 1. Creating ─── */

export interface CreateActionInput {
  photoKey: string; title: string; description: string; bring: string; place: string; latitude: number; longitude: number;
  startsAt: Date; minutes: number; peopleNeeded: number; organizerName: string; organizerPhone: string; deviceRef: string;
  push?: { endpoint: string; keys: { p256dh: string; auth: string } } | undefined; lang: 'sq' | 'en';
}

export async function createAction(input: CreateActionInput, now = new Date()): Promise<{ code: string; organizerToken: string; status: ActionStatus }> {
  await assertEnabled();
  const phone = normalizePhone(input.organizerPhone);
  if (phone.length < 9 || phone.length > 12) throw badRequest('Numri i telefonit nuk duket i saktë.', [{ field: 'organizerPhone', code: 'invalid', message: 'Numri i telefonit nuk duket i saktë.' }]);
  if (!insideServiceArea(input.latitude, input.longitude)) throw badRequest('Vendi duhet të jetë brenda Bashkisë Elbasan.', [{ field: 'latitude', code: 'invalid', message: 'Vendi duhet të jetë brenda Bashkisë Elbasan.' }]);
  const start = input.startsAt.getTime();
  if (start < now.getTime() - 15 * 60_000) throw badRequest('Koha e aksionit ka kaluar.', [{ field: 'startsAt', code: 'invalid', message: 'Koha e aksionit ka kaluar.' }]);
  if (start > now.getTime() + 60 * 86_400_000) throw badRequest('Aksioni mund të planifikohet deri në 60 ditë përpara.', [{ field: 'startsAt', code: 'invalid', message: 'Deri në 60 ditë përpara.' }]);
  const active = await db.communityAction.count({ where: { organizerPhone: phone, status: { in: ACTIVE } } });
  if (active >= MAX_ACTIVE_PER_PHONE) throw tooMany('Keni tashmë aksione të hapura. Mbyllni njërin para se të krijoni një tjetër.');
  if (input.push && !isPushEndpoint(input.push.endpoint)) input.push = undefined;

  const small = await smallPhoto(input.photoKey);
  // Clear, safe cases are published at once (the AI decides); anything doubtful waits for the staff.
  // Both versions alike: the staff sees every action and can still reject a published one.
  const check = await checkNewAction(small, input);
  const stored = await storeUploadedPhoto(input.photoKey);
  const { token, hash } = createToken(24);

  for (let attempt = 0; ; attempt++) {
    try {
      const created = await db.communityAction.create({
        data: {
          code: await nextCode(now),
          status: check.publish ? 'PUBLISHED' : 'REVIEW',
          title: input.title.trim(), description: input.description.trim(), bring: input.bring.trim() || null,
          place: input.place.trim(), latitude: input.latitude, longitude: input.longitude,
          startsAt: input.startsAt, minutes: input.minutes, peopleNeeded: input.peopleNeeded,
          organizerName: input.organizerName.trim().split(/\s+/)[0]?.slice(0, 40) || null,
          organizerPhone: phone, organizerTokenHash: hash, organizerDevice: input.deviceRef,
          joinSecret: randomBytes(32).toString('hex'), lang: input.lang,
          pushEndpoint: input.push?.endpoint ?? null, pushP256dh: input.push?.keys.p256dh ?? null, pushAuth: input.push?.keys.auth ?? null,
          aiSafe: check.safe, aiConfidence: check.confidence, aiReason: check.reason, reviewReason: check.review,
          publishedAt: check.publish ? now : null,
          photos: { create: { kind: 'BEFORE', storageKey: stored.key, storageUrl: stored.url, mime: stored.mime, size: stored.size, width: stored.width, height: stored.height } },
        },
      });
      return { code: created.code, organizerToken: token, status: created.status };
    } catch (err) {
      // Two actions created in the same instant got the same number: take the next one.
      if ((err as { code?: string }).code === 'P2002' && attempt < 3) continue;
      if (attempt >= 3) await deleteStoredImage(stored.key).catch(() => {});
      throw err;
    }
  }
}

/* ─── Reading ─── */

export async function getPublicAction(code: string): Promise<PublicAction> {
  const a = await loadByCode(code);
  if (a.status === 'REVIEW') throw notFound('Aksioni nuk u gjet ose pret miratimin.');
  return toPublic(a, Date.now(), false, await checkInOn());
}

/** The page as this browser sees it: with the group's reward when it took part. */
export async function getActionForDevice(code: string, deviceRef: string): Promise<PublicAction> {
  const a = await loadByCode(code);
  if (a.status === 'REVIEW') throw notFound('Aksioni nuk u gjet ose pret miratimin.');
  return toPublic(a, Date.now(), a.participants.some((p) => p.deviceRef === deviceRef), await checkInOn());
}

export async function getOrganizerAction(code: string, token: string, now = Date.now()): Promise<OrganizerAction> {
  const a = await loadAsOrganizer(code, token);
  const checkIn = await checkInOn();
  return {
    ...toPublic(a, now, true, checkIn),
    joinToken: checkIn && joinOpen(a, now) ? joinTokenAt(a.joinSecret, now) : null,
    prizeCode: a.status === 'VERIFIED' && a.prizeChoice ? a.prizeCode : null,
    reviewReason: a.status === 'REVIEW' || a.status === 'CLOSING' ? (a.status === 'REVIEW' ? 'Aksioni po shikohet nga Bashkia para se të publikohet.' : 'Aksioni po verifikohet.') : null,
  };
}

/** "Ndihmo qytetin": what is coming (or happening now) and what was done in the last 30 days. */
export async function listPublicActions(now = new Date()): Promise<{ upcoming: ActionCard[]; done: ActionCard[] }> {
  const [open, finished] = await Promise.all([
    db.communityAction.findMany({
      where: { status: 'PUBLISHED', startsAt: { gte: new Date(now.getTime() - 12 * 3600_000) } },
      include: { photos: true, _count: { select: { participants: true } } }, orderBy: { startsAt: 'asc' }, take: 30,
    }),
    db.communityAction.findMany({
      where: { status: 'VERIFIED', verifiedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
      include: { photos: true, _count: { select: { participants: true } } }, orderBy: { verifiedAt: 'desc' }, take: 12,
    }),
  ]);
  const card = (a: (typeof open)[number]): ActionCard => {
    const before = a.photos.find((p) => p.kind === 'BEFORE' && p.isPublic);
    const after = a.photos.find((p) => p.kind === 'AFTER' && p.isPublic);
    return {
      code: a.code, status: a.status, title: a.title, place: a.place, startsAt: a.startsAt.toISOString(), minutes: a.minutes,
      peopleNeeded: a.peopleNeeded, people: a._count.participants + 1,
      photoUrl: photoUrl((a.status === 'VERIFIED' ? after ?? before : before)?.id), prizeAmount: null,
    };
  };
  // Still open: until the end of its scanning time.
  const upcoming = open.filter((a) => a.startsAt.getTime() + a.minutes * 60_000 + JOIN_CLOSES_AFTER_MS >= now.getTime()).map(card);
  return { upcoming, done: finished.map(card) };
}

/** A photo of an action that anyone may see (the action is public). */
export async function getActionPhoto(id: string) {
  const p = await db.actionPhoto.findUnique({ where: { id }, include: { action: { select: { status: true } } } });
  if (!p || !p.isPublic || p.action.status === 'REVIEW' || p.action.status === 'REJECTED') throw notFound('Fotoja nuk u gjet.');
  return p;
}

/* ─── 2. Joining ─── */

export async function joinAction(input: {
  code: string; token: string; deviceRef: string; latitude: number; longitude: number; name: string;
  push?: { endpoint: string; keys: { p256dh: string; auth: string } } | undefined; lang: 'sq' | 'en';
}, now = Date.now()): Promise<PublicAction> {
  await assertEnabled();
  if (!(await checkInOn())) throw conflict('Për këtë aksion nuk ka nevojë për skanim: thjesht ejani në vend.');
  const a = await loadByCode(input.code);
  if (a.status !== 'PUBLISHED') throw conflict('Ky aksion nuk pranon më pjesëmarrës.');
  if (!joinOpen(a, now)) throw conflict('Skanimi hapet 30 minuta para fillimit të aksionit dhe mbyllet pas mbarimit të tij.');
  if (!joinTokenValid(a.joinSecret, input.token, now)) throw new AppError(400, 'QR_EXPIRED', 'Kodi QR ka skaduar. Skanojeni përsëri nga telefoni i organizatorit.');
  if (input.deviceRef === a.organizerDevice) throw conflict('Organizatori llogaritet vetë: nuk ka nevojë të skanojë.');
  const meters = Math.round(distanceMeters(input.latitude, input.longitude, a.latitude, a.longitude));
  if (meters > MAX_JOIN_METERS) throw new AppError(400, 'TOO_FAR', `Duhet të jeni në vendin e aksionit për t’u bashkuar (jeni rreth ${meters < 2000 ? `${meters} m` : `${Math.round(meters / 1000)} km`} larg).`);
  const already = a.participants.find((p) => p.deviceRef === input.deviceRef);
  if (!already) {
    const today = await db.actionParticipant.count({ where: { deviceRef: input.deviceRef, joinedAt: { gte: new Date(now - 86_400_000) } } });
    if (today >= MAX_JOINS_PER_DEVICE_DAY) throw tooMany('Sot jeni bashkuar tashmë në disa aksione. Faleminderit! Provoni nesër.');
  }
  const push = input.push && isPushEndpoint(input.push.endpoint) ? input.push : undefined;
  const data = {
    name: input.name.trim().split(/\s+/)[0]?.slice(0, 40) || null, meters, lang: input.lang,
    ...(push ? { pushEndpoint: push.endpoint, pushP256dh: push.keys.p256dh, pushAuth: push.keys.auth } : {}),
  };
  await db.actionParticipant.upsert({
    where: { actionId_deviceRef: { actionId: a.id, deviceRef: input.deviceRef } },
    create: { actionId: a.id, deviceRef: input.deviceRef, ...data },
    update: data,
  });
  return getActionForDevice(a.code, input.deviceRef);
}

/* ─── 3. Closing and verifying ─── */

export async function closeAction(input: { code: string; token: string; photoKey: string }, now = new Date()): Promise<OrganizerAction> {
  const a = await loadAsOrganizer(input.code, input.token);
  if (a.status !== 'PUBLISHED') throw conflict('Ky aksion nuk mund të mbyllet tani.');
  if (now.getTime() < a.startsAt.getTime() - JOIN_OPENS_BEFORE_MS) throw conflict('Aksioni mbyllet pasi të jetë bërë.');
  const stored = await storeUploadedPhoto(input.photoKey);
  await db.communityAction.update({
    where: { id: a.id },
    data: {
      status: 'CLOSING', closedAt: now,
      photos: { create: { kind: 'AFTER', storageKey: stored.key, storageUrl: stored.url, mime: stored.mime, size: stored.size, width: stored.width, height: stored.height } },
    },
  });
  await checkClosedAction(a.id, now);
  return getOrganizerAction(a.code, input.token, now.getTime());
}

/** What the group would get now (budget and the organiser's monthly limit included). */
async function prizeFor(a: { id: string; organizerPhone: string; participants: unknown[] }, now: Date): Promise<number> {
  const s = await getCommunitySettings();
  const amount = prizeForPeople(s.tiers, a.participants.length + 1);
  if (amount <= 0) return 0;
  const from = monthStart(now);
  const [organiserPrizes, spent] = await Promise.all([
    db.communityAction.count({ where: { id: { not: a.id }, organizerPhone: a.organizerPhone, status: 'VERIFIED', prizeAmount: { gt: 0 }, verifiedAt: { gte: from } } }),
    db.communityAction.aggregate({ _sum: { prizeAmount: true }, where: { id: { not: a.id }, status: 'VERIFIED', verifiedAt: { gte: from } } }),
  ]);
  if (organiserPrizes >= 1) return 0;
  if ((spent._sum.prizeAmount ?? 0) + amount > s.monthlyBudget) return 0;
  return amount;
}

/** After closing: the AI compares the photos; a sure, ordinary case is verified at once. */
export async function checkClosedAction(id: string, now = new Date()): Promise<void> {
  const a = await db.communityAction.findUnique({ where: { id }, include: WITH_ALL });
  if (!a || a.status !== 'CLOSING') return;
  let fixed: boolean | null = null;
  let confidence: number | null = null;
  let reason: string | null = null;
  const before = a.photos.find((p) => p.kind === 'BEFORE');
  const after = a.photos.find((p) => p.kind === 'AFTER');
  if (aiEnabled() && before && after) {
    try {
      const out = await chatJson({
        kind: 'action-close', system: CLOSE_SYSTEM, userText: JSON.stringify({ action: a.title, place: a.place }),
        imageDataUrls: [await imageDataUrl(before, 768), await imageDataUrl(after, 768)],
      });
      confidence = num(out.confidence, 0, 100, 0);
      fixed = out.done === true && out.samePlace !== false;
      if (out.samePlace === false) confidence = Math.min(confidence, 50);
      reason = text(out.reasonSq, 300) || null;
    } catch (err) {
      if (!(err instanceof AiUnavailableError) && !(err instanceof AiRefusedError)) throw err;
      console.error('[action-close] AI unavailable:', hideKeys((err as Error).message));
    }
  }
  const s = await getCommunitySettings();
  const amount = s.rewards ? await prizeFor(a, now) : 0;
  const notDone = a.votes.filter((v) => !v.done).length;
  const advice = fixed === null ? 'AI nuk i krahasoi fotot.' : `AI: ${fixed ? 'u bë' : 'nuk duket e bërë'} (${confidence ?? 0}%).${reason ? ` ${reason}` : ''}`;
  const review = !s.rewards ? `Shikoni fotot para/pas dhe verifikojeni. ${advice}`
    : fixed === null ? 'AI nuk i krahasoi fotot: shikojini para/pas.'
    : !fixed || (confidence ?? 0) < VERIFY_MIN_CONFIDENCE ? `AI nuk është i sigurt që u bë (${confidence ?? 0}%).${reason ? ` ${reason}` : ''}`
      : notDone >= NOT_DONE_VOTES_TO_HOLD ? 'Banorët thonë që nuk u bë.'
        : amount > 0 && amount >= s.checkFrom ? `Çmim me vlerë (${amount} lekë): kërkon një miratim.`
          : spotCheck() ? 'Kontroll i rastësishëm (1 në 10).'
            : null;
  await db.communityAction.update({ where: { id }, data: { aiFixed: fixed, aiFixedConfidence: confidence, reviewReason: review, ...(reason ? { aiReason: reason } : {}) } });
  if (!review) await verify(id, now);
}

async function verify(id: string, now: Date): Promise<void> {
  const a = await db.communityAction.findUnique({ where: { id }, include: { participants: true } });
  if (!a || a.status !== 'CLOSING') return;
  const amount = (await checkInOn()) ? await prizeFor(a, now) : 0;
  await db.communityAction.update({ where: { id }, data: { status: 'VERIFIED', verifiedAt: now, prizeAmount: amount, reviewReason: null } });
  await enqueue('action-push', { actionId: id, moment: 'verified' });
}

/* ─── 4. The prize ─── */

export async function choosePrize(input: { code: string; token: string; choice: 'COFFEE' | 'MARKET' }): Promise<OrganizerAction> {
  const a = await loadAsOrganizer(input.code, input.token);
  if (a.status !== 'VERIFIED' || !a.prizeAmount) throw conflict('Ky aksion nuk ka çmim për të zgjedhur.');
  if (a.prizeChoice) throw conflict('Çmimi është zgjedhur tashmë.');
  if (a.prizeHeld) throw conflict('Çmimi është pezulluar derisa ta shikojë Bashkia.');
  const s = await getCommunitySettings();
  for (let attempt = 0; ; attempt++) {
    try {
      const done = await db.communityAction.updateMany({
        where: { id: a.id, prizeChoice: null },
        data: { prizeChoice: input.choice, prizePartner: input.choice === 'COFFEE' ? s.coffeePartner : s.marketPartner, prizeCode: prizeCode() },
      });
      if (done.count === 0) throw conflict('Çmimi është zgjedhur tashmë.');
      break;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002' && attempt < 3) continue;
      throw err;
    }
  }
  await enqueue('action-push', { actionId: a.id, moment: 'prize_chosen' });
  return getOrganizerAction(a.code, input.token);
}


export async function getPrize(prizeCodeValue: string): Promise<PrizeView> {
  const a = await db.communityAction.findUnique({ where: { prizeCode: prizeCodeValue.toUpperCase() }, include: { _count: { select: { participants: true } } } });
  if (!a || a.status !== 'VERIFIED' || !a.prizeChoice || !a.prizeAmount) throw notFound('Ky kod çmimi nuk u gjet.');
  return {
    code: a.prizeCode!, actionCode: a.code, title: a.title, amount: a.prizeAmount, choice: a.prizeChoice, partner: a.prizePartner ?? '',
    people: a._count.participants + 1, redeemedAt: a.prizeRedeemedAt?.toISOString() ?? null, held: a.prizeHeld,
  };
}

/** The partner (café or market) marks the prize as used, with the PIN the Municipality gave them. */
export async function redeemPrize(prizeCodeValue: string, pin: string, now = new Date()): Promise<PrizeView> {
  const settings = await storedSettings();
  if (!settings.partnerPinHash) throw conflict('PIN-i i partnerëve nuk është vendosur ende nga Bashkia.');
  const given = Buffer.from(sha256(`partner-pin:${pin}`));
  const expected = Buffer.from(settings.partnerPinHash);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw forbidden('PIN-i nuk është i saktë.');
  const prize = await getPrize(prizeCodeValue);
  if (prize.held) throw conflict('Ky çmim është pezulluar derisa ta shikojë Bashkia.');
  const done = await db.communityAction.updateMany({ where: { prizeCode: prize.code, prizeRedeemedAt: null }, data: { prizeRedeemedAt: now } });
  if (done.count === 0) throw conflict('Ky çmim është përdorur tashmë.');
  return getPrize(prize.code);
}

/* ─── 5. Neighbours: "A u bë vërtet?" ─── */

export async function voteAction(input: { code: string; deviceRef: string; done: boolean }, now = new Date()): Promise<PublicAction> {
  if (!(await checkInOn())) throw conflict('Ky aksion verifikohet nga stafi i Bashkisë.');
  const a = await loadByCode(input.code);
  if (!(a.status === 'CLOSING' || a.status === 'VERIFIED') || !a.closedAt || now.getTime() - a.closedAt.getTime() > VOTE_DAYS * 86_400_000) {
    throw conflict('Ky aksion nuk pret më përgjigje.');
  }
  if (input.deviceRef === a.organizerDevice || a.participants.some((p) => p.deviceRef === input.deviceRef)) {
    throw conflict('Ju morët pjesë në aksion: përgjigjen e japin banorët e tjerë.');
  }
  await db.actionVote.upsert({
    where: { actionId_deviceRef: { actionId: a.id, deviceRef: input.deviceRef } },
    create: { actionId: a.id, deviceRef: input.deviceRef, done: input.done },
    update: { done: input.done },
  });
  const notDone = await db.actionVote.count({ where: { actionId: a.id, done: false } });
  if (notDone >= NOT_DONE_VOTES_TO_HOLD) {
    if (a.status === 'VERIFIED' && !a.prizeRedeemedAt && !a.prizeHeld) {
      await db.communityAction.update({ where: { id: a.id }, data: { prizeHeld: true, reviewReason: 'Banorët thonë që nuk u bë: çmimi u pezullua.' } });
    } else if (a.status === 'CLOSING') {
      await db.communityAction.update({ where: { id: a.id }, data: { reviewReason: 'Banorët thonë që nuk u bë.' } });
    }
  }
  return getPublicAction(a.code);
}

/* ─── The admin ─── */

function toAdmin(a: ActionWithAll, checkIn = false): AdminActionItem {
  return {
    ...toPublic(a, Date.now(), true, checkIn),
    id: a.id,
    organizerPhone: a.organizerPhone,
    reviewReason: a.reviewReason,
    ai: { safe: a.aiSafe, confidence: a.aiConfidence, reason: a.aiReason, fixed: a.aiFixed, fixedConfidence: a.aiFixedConfidence },
    prizeCode: a.prizeCode,
    createdAt: a.createdAt.toISOString(),
    // The admin sees the photos of actions not yet public too.
    beforePhotoUrl: a.photos.find((p) => p.kind === 'BEFORE') ? `/api/admin/action-photos/${a.photos.find((p) => p.kind === 'BEFORE')!.id}` : null,
    afterPhotoUrl: a.photos.find((p) => p.kind === 'AFTER') ? `/api/admin/action-photos/${a.photos.find((p) => p.kind === 'AFTER')!.id}` : null,
  };
}

/** "Aksionet": first what waits for a person, then the rest (newest first). */
export async function listAdminActions(user: Principal): Promise<{ waiting: AdminActionItem[]; others: AdminActionItem[] }> {
  assertAdmin(user);
  const rows = await db.communityAction.findMany({ include: WITH_ALL, orderBy: { createdAt: 'desc' }, take: 200 });
  const waits = (a: ActionWithAll) => a.status === 'REVIEW' || (a.status === 'CLOSING' && Boolean(a.reviewReason)) || a.prizeHeld;
  const checkIn = await checkInOn();
  return { waiting: rows.filter(waits).map((a) => toAdmin(a, checkIn)), others: rows.filter((a) => !waits(a)).map((a) => toAdmin(a, checkIn)) };
}

export async function countWaitingActions(): Promise<number> {
  return db.communityAction.count({ where: { OR: [{ status: 'REVIEW' }, { status: 'CLOSING', reviewReason: { not: null } }, { prizeHeld: true }] } });
}

export async function getAdminActionPhoto(user: Principal, id: string) {
  assertAdmin(user);
  const p = await db.actionPhoto.findUnique({ where: { id } });
  if (!p) throw notFound('Fotoja nuk u gjet.');
  return p;
}

export async function decideAction(
  user: Principal, id: string,
  decision: 'publish' | 'reject' | 'verify' | 'not_verified' | 'release_prize' | 'redeemed', reason: string, now = new Date(),
): Promise<AdminActionItem> {
  assertAdmin(user);
  const a = await db.communityAction.findUnique({ where: { id }, include: WITH_ALL });
  if (!a) throw notFound('Aksioni nuk u gjet.');
  const needReason = () => { if (reason.trim().length < 5) throw badRequest('Shkruani arsyen (të paktën 5 shkronja).'); };
  switch (decision) {
    case 'publish':
      if (a.status !== 'REVIEW') throw conflict('Aksioni nuk pret miratim.');
      await db.communityAction.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: now, reviewReason: null } });
      await enqueue('action-push', { actionId: id, moment: 'published' });
      break;
    case 'reject':
      if (a.status !== 'REVIEW' && a.status !== 'PUBLISHED') throw conflict('Ky aksion nuk mund të refuzohet tani.');
      needReason();
      await db.communityAction.update({ where: { id }, data: { status: 'REJECTED', rejectReason: reason.trim(), reviewReason: null } });
      await enqueue('action-push', { actionId: id, moment: 'rejected' });
      break;
    case 'verify':
      if (a.status !== 'CLOSING') throw conflict('Aksioni nuk pret verifikim.');
      await verify(id, now);
      break;
    case 'not_verified':
      if (a.status !== 'CLOSING' && !(a.status === 'VERIFIED' && !a.prizeRedeemedAt)) throw conflict('Ky aksion nuk mund të shënohet si i paverifikuar.');
      needReason();
      await db.communityAction.update({ where: { id }, data: { status: 'NOT_VERIFIED', rejectReason: reason.trim(), reviewReason: null, prizeHeld: false } });
      await enqueue('action-push', { actionId: id, moment: 'not_verified' });
      break;
    case 'release_prize':
      if (!a.prizeHeld) throw conflict('Çmimi nuk është i pezulluar.');
      await db.communityAction.update({ where: { id }, data: { prizeHeld: false, reviewReason: null } });
      break;
    case 'redeemed':
      if (a.status !== 'VERIFIED' || !a.prizeChoice || a.prizeRedeemedAt) throw conflict('Çmimi nuk mund të shënohet si i përdorur.');
      await db.communityAction.update({ where: { id }, data: { prizeRedeemedAt: now } });
      break;
  }
  const fresh = await db.communityAction.findUniqueOrThrow({ where: { id }, include: WITH_ALL });
  return toAdmin(fresh, await checkInOn());
}

/* ─── Notifications ─── */

type Moment = 'published' | 'rejected' | 'verified' | 'not_verified' | 'prize_chosen';

function messageFor(moment: Moment, a: { title: string; code: string; prizeAmount: number | null; prizeChoice: string | null; prizePartner: string | null; rejectReason: string | null }, lang: 'sq' | 'en', s: CommunitySettings) {
  const url = `${config().appUrl}/ndihmo/${a.code}`;
  const sq = lang !== 'en';
  const amount = a.prizeAmount ?? 0;
  const choice = a.prizeChoice === 'COFFEE' ? (sq ? `kafe me miqtë te ${a.prizePartner}` : `coffee with friends at ${a.prizePartner}`) : (sq ? `zbritje te ${a.prizePartner}` : `a discount at ${a.prizePartner}`);
  const m: Record<Moment, { title: string; body: string }> = {
    published: { title: sq ? 'Aksioni juaj u publikua' : 'Your action is public', body: sq ? `${a.title}: tani mund ta ndani me të tjerët.` : `${a.title}: you can now share it.` },
    rejected: { title: sq ? 'Aksioni nuk u publikua' : 'Your action was not published', body: `${a.title}: ${a.rejectReason ?? ''}`.trim() },
    verified: amount > 0
      ? { title: sq ? `Fituat ${amount} lekë për grupin! 🎉` : `Your group won ${amount} lek! 🎉`, body: sq ? `${a.title}: u verifikua. Organizatori zgjedh: kafe me miqtë (${s.coffeePartner}) ose zbritje (${s.marketPartner}).` : `${a.title}: verified. The organiser chooses: coffee with friends (${s.coffeePartner}) or a discount (${s.marketPartner}).` }
      : { title: sq ? 'Faleminderit! Aksioni u verifikua 💚' : 'Thank you! The action was verified 💚', body: sq ? `${a.title}: e bëtë Elbasanin më të bukur.` : `${a.title}: you made Elbasan nicer.` },
    not_verified: { title: sq ? 'Aksioni nuk u verifikua' : 'The action was not verified', body: `${a.title}: ${a.rejectReason ?? ''}`.trim() },
    prize_chosen: { title: sq ? 'Grupi zgjodhi çmimin' : 'The group chose its prize', body: sq ? `${a.title}: ${choice}. Kodin e ka organizatori.` : `${a.title}: ${choice}. The organiser has the code.` },
  };
  return { ...m[moment], url, tag: `action-${a.code}` };
}

/** Background job: tells the organiser (and, for the prize, everyone who scanned). */
export async function sendActionPush(p: { actionId: string; moment: Moment }): Promise<number> {
  const a = await db.communityAction.findUnique({ where: { id: p.actionId }, include: { participants: true } });
  if (!a) return 0;
  const s = await getCommunitySettings();
  const targets: Array<{ endpoint: string; p256dh: string; auth: string; lang: string; participantId?: string }> = [];
  if (a.pushEndpoint && a.pushP256dh && a.pushAuth) targets.push({ endpoint: a.pushEndpoint, p256dh: a.pushP256dh, auth: a.pushAuth, lang: a.lang });
  if (p.moment === 'verified' || p.moment === 'prize_chosen' || p.moment === 'not_verified') {
    for (const x of a.participants) {
      if (x.pushEndpoint && x.pushP256dh && x.pushAuth) targets.push({ endpoint: x.pushEndpoint, p256dh: x.pushP256dh, auth: x.pushAuth, lang: x.lang, participantId: x.id });
    }
  }
  let sent = 0;
  for (const t of targets) {
    const result = await pushToDevice(t, messageFor(p.moment, a, t.lang === 'en' ? 'en' : 'sq', s));
    if (result === 'sent') sent++;
    if (result === 'gone') {
      if (t.participantId) await db.actionParticipant.update({ where: { id: t.participantId }, data: { pushEndpoint: null, pushP256dh: null, pushAuth: null } }).catch(() => {});
      else await db.communityAction.update({ where: { id: a.id }, data: { pushEndpoint: null, pushP256dh: null, pushAuth: null } }).catch(() => {});
    }
  }
  return sent;
}

/* ─── Daily ─── */

/** Actions never closed (or never approved) after their time: cancelled, so they leave the lists. */
export async function cancelStaleActions(now = new Date()): Promise<number> {
  const rows = await db.communityAction.findMany({ where: { status: { in: ['PUBLISHED', 'REVIEW'] } }, select: { id: true, startsAt: true, minutes: true } });
  const stale = rows.filter((a) => a.startsAt.getTime() + a.minutes * 60_000 + STALE_AFTER_MS < now.getTime()).map((a) => a.id);
  if (!stale.length) return 0;
  const res = await db.communityAction.updateMany({ where: { id: { in: stale } }, data: { status: 'CANCELLED', reviewReason: null } });
  return res.count;
}

/** The organiser's phone is kept only while it is needed (the monthly prize limit): removed 90 days after the action. */
export async function eraseOldActionPhones(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - 90 * 86_400_000);
  const res = await db.communityAction.updateMany({
    where: { organizerPhone: { not: '' }, status: { notIn: ACTIVE }, updatedAt: { lt: before } },
    data: { organizerPhone: '', pushEndpoint: null, pushP256dh: null, pushAuth: null },
  });
  return res.count;
}
