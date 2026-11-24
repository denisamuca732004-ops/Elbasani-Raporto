'use client';
/**
 * The page of one action (/ndihmo/AK-…):
 *  - everyone: what, where, when, how many, the photos, sharing, the group's reward;
 *  - someone who scanned the QR (?t=…): "Bashkohu" (name optional, the position checked once);
 *  - the organiser (the secret link kept in this browser): the QR that changes every
 *    30 seconds, closing with the "after" photo, the choice of the reward and its code;
 *  - neighbours, after closing: "A u bë vërtet?".
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { choosePrizeAction, closeActionAction, joinActionAction, organizerActionAction, viewActionAction, voteActionAction } from '@/actions/community';
import Icon from '@/components/Icon';
import PhotoInput from '@/components/PhotoInput';
import { MiniMap } from '@/components/maps';
import { useSettings } from '@/components/providers';
import { ErrorAlert, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import {
  currentPosition, deviceRef, durationText, hasJoined, hasVoted, markJoined, markVoted, organizerToken,
} from '@/lib/client/community';
import { formatDate } from '@/lib/client/format';
import { askPushPermission, browserSubscription, pushSupport } from '@/lib/client/push';
import { uploadPhoto } from '@/lib/client/upload';
import type { OrganizerAction, PublicAction } from '@/lib/shared/types';

function useQr(text: string | null, width = 320): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!text) { setUrl(null); return; }
    let live = true;
    void QRCode.toDataURL(text, { margin: 1, width, errorCorrectionLevel: 'M', color: { dark: '#0F2A1D', light: '#FFFFFF' } }).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [text, width]);
  return url;
}

export default function ActionPage({ code, initial }: { code: string; initial: PublicAction | null }) {
  const { t, lang } = useI18n();
  const params = useSearchParams();
  const joinToken = params.get('t');
  const [action, setAction] = useState<PublicAction | OrganizerAction | null>(initial);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const own = organizerToken(code);
    setToken(own);
    setJoined(hasJoined(code));
    setReady(true);
    // Those who took part see the group's reward once it is done (nobody else ever sees money).
    if (!own && hasJoined(code) && initial?.status === 'VERIFIED') {
      void call(viewActionAction({ code, deviceRef: deviceRef() })).then(setAction).catch(() => {});
    }
  }, [code, initial?.status]);

  const org = token && action && 'joinToken' in action ? (action as OrganizerAction) : null;

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setAction(await call(organizerActionAction({ code, token })));
    } catch (err) {
      if (err instanceof ActionFailure && err.status === 403) setToken(null);
    }
  }, [code, token]);

  // The organiser's view, refreshed often while the QR is shown (it changes every 30 s).
  useEffect(() => {
    if (!token) return undefined;
    void refresh();
    const every = action?.status === 'PUBLISHED' && action.joinOpen ? 10_000 : 30_000;
    const id = window.setInterval(() => void refresh(), every);
    return () => window.clearInterval(id);
  }, [token, refresh, action?.status, action?.joinOpen]);

  if (!action) {
    return (
      <div className="container cm-page cm-narrow">
        {!ready || token ? <p className="hint">…</p> : (
          <>
            <h1>{t('community.page.notFound')}</h1>
            <Link href="/ndihmo" className="btn btn-outline">{t('community.page.back')}</Link>
          </>
        )}
      </div>
    );
  }

  const isOrganizer = Boolean(org);
  const showJoin = Boolean(joinToken) && !isOrganizer && action.status === 'PUBLISHED';

  return (
    <div className="container cm-page cm-narrow">
      <Link href="/ndihmo" className="cm-back"><Icon name="arrowLeft" size={16} />{t('community.page.back')}</Link>

      {showJoin && <JoinBox code={code} token={joinToken!} joined={joined} onJoined={(a) => { setAction(a); setJoined(true); markJoined(code); }} />}

      <article className="cm-action">
        <div className="cm-action-photos">
          {action.beforePhotoUrl && <figure><img src={action.beforePhotoUrl} alt="" /><figcaption>{t('community.page.before')}</figcaption></figure>}
          {action.afterPhotoUrl && <figure><img src={action.afterPhotoUrl} alt="" /><figcaption>{t('community.page.after')}</figcaption></figure>}
        </div>
        <div className="cm-action-head">
          <span className={`cm-badge cm-badge-${action.status.toLowerCase()}`}>{t(`community.status.${action.status}`)}</span>
          <span className="cm-code-sm">{action.code}</span>
        </div>
        <h1>{action.title}</h1>
        {action.organizerName && <p className="cm-muted">{t('community.page.organizer', { name: action.organizerName })}</p>}
        <p>{action.description}</p>

        <dl className="cm-facts">
          <div><dt><Icon name="clock" size={16} />{t('community.page.when')}</dt><dd>{formatDate(action.startsAt, lang, true)} · {durationText(action.minutes, t)}</dd></div>
          <div><dt><Icon name="pin" size={16} />{t('community.page.where')}</dt><dd>{action.place}</dd></div>
          <div><dt><Icon name="users" size={16} />{t('community.form.people')}</dt><dd>{action.checkIn ? t('community.people', { n: action.people, m: action.peopleNeeded }) : t('community.form.peopleShort', { n: action.peopleNeeded })}</dd></div>
          {action.bring && <div><dt><Icon name="list" size={16} />{t('community.page.bring')}</dt><dd>{action.bring}</dd></div>}
        </dl>
        {action.names.length > 0 && <p className="cm-muted">{t('community.page.names', { names: action.names.join(', ') })}</p>}

        {action.rejectReason && <p className="cm-reason">{t('community.page.reason', { reason: action.rejectReason })}</p>}
        <PrizeLine action={action} />

        {isOrganizer ? <OrganizerPanel action={org!} token={token!} onChange={setAction} setError={setError} />
          : action.status === 'PUBLISHED' && !showJoin && (
            <div className="cm-howjoin"><Icon name={action.checkIn ? 'qr' : 'users'} size={22} /><div><strong>{t('community.page.join')}</strong><p>{joined ? t('community.joinBox.already') : action.checkIn ? t('community.page.joinText') : t('community.page.joinTextSimple')}</p></div></div>
          )}

        {!isOrganizer && !joined && action.checkIn && <VoteBox action={action} onChange={setAction} />}
        {error ? <ErrorAlert error={error} /> : null}

        <ShareRow action={action} />
        <MiniMap latitude={action.latitude} longitude={action.longitude} />
      </article>
    </div>
  );
}

function PrizeLine({ action }: { action: PublicAction }) {
  const { t } = useI18n();
  if (action.status !== 'VERIFIED') return null;
  if (!action.prize) {
    return <div className="cm-prize-line"><Icon name="heart" size={22} /><div><strong>{t('community.page.doneThanks', { n: action.people })}</strong></div></div>;
  }
  const p = action.prize;
  return (
    <div className="cm-prize-line">
      <Icon name="gift" size={22} />
      <div>
        <strong>{p.amount > 0 ? t('community.page.prizeWon', { n: p.amount }) : t('community.page.prizeThanks')}</strong>
        {p.choice && <span>{t('community.page.chose', { choice: `${t(p.choice === 'COFFEE' ? 'community.page.coffee' : 'community.page.market')}${p.partner ? ` · ${p.partner}` : ''}` })}</span>}
        {p.held && <span className="cm-warn">{t('community.page.held')}</span>}
        {p.redeemed && <span>{t('community.page.redeemed')}</span>}
      </div>
    </div>
  );
}

function ShareRow({ action }: { action: PublicAction }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  if (action.status !== 'PUBLISHED' && action.status !== 'VERIFIED') return null;
  const url = typeof window !== 'undefined' ? `${window.location.origin}/ndihmo/${action.code}` : `/ndihmo/${action.code}`;
  const text = t('community.page.shareText', { title: action.title });
  return (
    <div className="cm-share">
      <a className="btn btn-outline btn-sm" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noreferrer"><Icon name="chat" size={16} />WhatsApp</a>
      <button type="button" className="btn btn-outline btn-sm" onClick={async () => {
        try {
          if (navigator.share) await navigator.share({ title: action.title, text, url });
          else { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
        } catch { /* closed */ }
      }}><Icon name="share" size={16} />{copied ? t('community.page.copied') : t('community.page.share')}</button>
    </div>
  );
}

function JoinBox({ code, token, joined, onJoined }: { code: string; token: string; joined: boolean; onJoined: (a: PublicAction) => void }) {
  const { t, lang } = useI18n();
  const { rules } = useSettings();
  const [name, setName] = useState('');
  const [notify, setNotify] = useState(false);
  const [canPush, setCanPush] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(joined);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setCanPush(Boolean(rules.pushKey) && pushSupport() === 'yes'), [rules.pushKey]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      let pos;
      try {
        pos = await currentPosition();
      } catch {
        throw new ActionFailure({ code: 'LOCATION', status: 400, message: t('community.joinBox.location') });
      }
      const push = notify && rules.pushKey ? await browserSubscription(rules.pushKey) : null;
      const a = await call(joinActionAction({ code, token, deviceRef: deviceRef(), ...pos, name, ...(push ? { push } : {}), lang: lang === 'en' ? 'en' : 'sq' }));
      setDone(true);
      onJoined(a);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <div className="cm-join cm-join-done"><Icon name="heart" size={26} /><div><strong>{t('community.joinBox.done')}</strong><p>{t('community.joinBox.doneText')}</p></div></div>;
  }
  return (
    <div className="cm-join">
      <h2><Icon name="qr" size={22} />{t('community.joinBox.title')}</h2>
      <p>{t('community.joinBox.text')}</p>
      <Field label={t('community.joinBox.name')} htmlFor="cm-join-name">
        <input id="cm-join-name" value={name} maxLength={40} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
      </Field>
      {canPush && (
        <label className="switch">
          <input type="checkbox" role="switch" checked={notify} aria-checked={notify} onChange={async (e) => setNotify(e.target.checked ? await askPushPermission() : false)} />
          <span className="switch-track" aria-hidden="true" />
          <span>{t('community.joinBox.notify')}</span>
        </label>
      )}
      {error ? <ErrorAlert error={error} /> : null}
      <button type="button" className="btn btn-lg" disabled={busy} onClick={() => void join()}><Icon name="check" size={20} />{busy ? t('community.joinBox.busy') : t('community.joinBox.button')}</button>
    </div>
  );
}

function OrganizerPanel({ action, token, onChange, setError }: { action: OrganizerAction; token: string; onChange: (a: OrganizerAction) => void; setError: (e: unknown) => void }) {
  const { t, lang } = useI18n();
  const { rules } = useSettings();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const joinUrl = action.joinToken ? `${origin}/ndihmo/${action.code}?t=${action.joinToken}` : null;
  const qr = useQr(joinUrl, 360);
  const prizeQr = useQr(action.prizeCode ? `${origin}/ndihmo/cmim/${action.prizeCode}` : null, 260);
  const [after, setAfter] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const started = Date.now() >= new Date(action.startsAt).getTime() - 30 * 60_000;

  async function close() {
    if (!after) return;
    setBusy(true);
    setError(null);
    try {
      const key = await uploadPhoto(after);
      onChange(await call(closeActionAction({ code: action.code, token, photoKey: key })));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function choose(choice: 'COFFEE' | 'MARKET') {
    setBusy(true);
    setError(null);
    try {
      onChange(await call(choosePrizeAction({ code: action.code, token, choice })));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cm-org" aria-labelledby="cm-org-title">
      <h2 id="cm-org-title"><Icon name="key" size={20} />{t('community.org.title')}</h2>

      {action.status === 'REVIEW' && <p>{t('community.org.review')}</p>}

      {action.status === 'PUBLISHED' && (
        joinUrl ? (
          <div className="cm-qr">
            <strong>{t('community.org.qrTitle')}</strong>
            {qr ? <img src={qr} alt={t('community.org.qrTitle')} width={300} height={300} /> : <div className="cm-qr-blank" />}
            <span className="cm-qr-count"><Icon name="users" size={16} />{t('community.org.joined', { n: action.people })}</span>
            <p className="hint">{t('community.org.qrText')}</p>
          </div>
        ) : <p className="hint">{action.checkIn ? t('community.org.qrLater', { time: formatDate(action.startsAt, lang, true) }) : t('community.org.shareHint')}</p>
      )}

      {action.status === 'PUBLISHED' && started && (
        <div className="cm-close">
          <strong>{t('community.org.closeTitle')}</strong>
          <p className="hint">{t('community.org.closeText')}</p>
          <PhotoInput value={after} onChange={setAfter} required maxBytes={rules.maxUploadBytes} idPrefix="action-after" />
          <button type="button" className="btn" disabled={!after || busy} onClick={() => void close()}>
            <Icon name="check" size={18} />{busy ? t('community.org.closing') : t('community.org.closeButton')}
          </button>
        </div>
      )}

      {action.status === 'CLOSING' && <p><Icon name="clock" size={16} /> {t('community.org.checking')}</p>}

      {action.status === 'VERIFIED' && action.prize && (
        action.prize.amount <= 0 ? <p>{action.checkIn ? t('community.org.noPrize') : t('community.org.thanks')}</p>
          : !action.prize.choice ? (
            <div className="cm-choose">
              <strong>{t('community.org.choose')}</strong>
              <div className="cm-choose-row">
                <button type="button" className="cm-choice" disabled={busy || action.prize.held} onClick={() => void choose('COFFEE')}>
                  <span aria-hidden="true">☕</span><strong>{t('community.org.coffee')}</strong>
                </button>
                <button type="button" className="cm-choice" disabled={busy || action.prize.held} onClick={() => void choose('MARKET')}>
                  <span aria-hidden="true">🛒</span><strong>{t('community.org.market')}</strong>
                </button>
              </div>
            </div>
          ) : action.prizeCode && (
            <div className="cm-qr">
              <strong>{t('community.org.code')}</strong>
              {prizeQr && <img src={prizeQr} alt="" width={220} height={220} />}
              <span className="cm-code">{action.prizeCode}</span>
              <p className="hint">{t('community.org.codeText', { partner: action.prize.partner ?? '' })}</p>
            </div>
          )
      )}
    </section>
  );
}

function VoteBox({ action, onChange }: { action: PublicAction; onChange: (a: PublicAction) => void }) {
  const { t } = useI18n();
  const [voted, setVoted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setVoted(hasVoted(action.code)), [action.code]);
  const open = (action.status === 'CLOSING' || action.status === 'VERIFIED') && action.closedAt
    && Date.now() - new Date(action.closedAt).getTime() < 7 * 86_400_000;
  if (!open) return null;
  async function vote(done: boolean) {
    try {
      onChange(await call(voteActionAction({ code: action.code, deviceRef: deviceRef(), done })));
      markVoted(action.code);
      setVoted(true);
    } catch (err) {
      setError(err);
    }
  }
  return (
    <div className="cm-vote">
      <strong>{t('community.page.vote')}</strong>
      {voted ? <p>{t('community.page.voted')}</p> : (
        <>
          <p className="hint">{t('community.page.voteText')}</p>
          <div className="cm-vote-row">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void vote(true)}>{t('community.page.yes')}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void vote(false)}>{t('community.page.no')}</button>
          </div>
        </>
      )}
      {error ? <ErrorAlert error={error} /> : null}
    </div>
  );
}
