'use client';
/**
 * "Aksionet": the "Ndihmo qytetin" actions that wait for the admin (the AI was not sure, a valuable
 * reward, a random check, neighbours said "not done"), all the others, and the rewards' settings.
 */
import Link from 'next/link';
import { useState } from 'react';
import { decideActionAction, updateCommunitySettingsAction } from '@/actions/community';
import Icon from '@/components/Icon';
import { ErrorAlert, Field, SuccessAlert } from '@/components/ui';
import { useI18n } from '@/i18n';
import { call } from '@/lib/client/action';
import { formatDate } from '@/lib/client/format';
import type { AdminActionItem, CommunitySettings } from '@/lib/shared/types';
import { useAdminAction } from './useAdminAction';

type Decision = 'publish' | 'reject' | 'verify' | 'not_verified' | 'release_prize' | 'redeemed';

function ActionItem({ a, open: startOpen }: { a: AdminActionItem; open: boolean }) {
  const { t, lang } = useI18n();
  const { busy, error, notice, run } = useAdminAction();
  const [open, setOpen] = useState(startOpen);
  const [reason, setReason] = useState('');
  const decide = (decision: Decision) => run(() => call(decideActionAction(a.id, { decision, reason })), t('communityAdmin.saved'));
  const yesNo = (v: boolean | null) => (v === null ? '–' : v ? t('communityAdmin.yes') : t('communityAdmin.no'));
  const buttons: Array<[Decision, string, boolean]> = [];
  if (a.status === 'REVIEW') buttons.push(['publish', t('communityAdmin.publish'), false], ['reject', t('communityAdmin.reject'), true]);
  if (a.status === 'CLOSING') buttons.push(['verify', t('communityAdmin.verify'), false], ['not_verified', t('communityAdmin.notVerified'), true]);
  if (a.status === 'VERIFIED' && a.prize?.held) buttons.push(['release_prize', t('communityAdmin.release'), false], ['not_verified', t('communityAdmin.notVerified'), true]);
  if (a.status === 'VERIFIED' && a.prize?.choice && !a.prize.redeemed && !a.prize.held) buttons.push(['redeemed', t('communityAdmin.redeemed'), false]);
  const needsReason = buttons.some(([, , r]) => r);

  return (
    <article className={`ca-item${open ? ' open' : ''}`}>
      <button type="button" className="ca-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {a.beforePhotoUrl ? <img src={a.beforePhotoUrl} alt="" /> : <span className="ca-noimg"><Icon name="heart" size={20} /></span>}
        <span className="ca-title">
          <strong>{a.title}</strong>
          <span className="muted small">{a.code} · {formatDate(a.startsAt, lang, true)} · {a.place} · {t('communityAdmin.people', { n: a.people })}</span>
        </span>
        <span className={`cm-badge cm-badge-${a.status.toLowerCase()}`}>{t(`community.status.${a.status}`)}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      {open && (
        <div className="ca-body">
          {a.reviewReason && <p className="ca-why"><Icon name="alert" size={16} /><span><strong>{t('communityAdmin.why')}:</strong> {a.reviewReason}</span></p>}
          <div className="ca-photos">
            {a.beforePhotoUrl && <figure><img src={a.beforePhotoUrl} alt="" /><figcaption>{t('community.page.before')}</figcaption></figure>}
            {a.afterPhotoUrl && <figure><img src={a.afterPhotoUrl} alt="" /><figcaption>{t('community.page.after')}</figcaption></figure>}
          </div>
          <p>{a.description}</p>
          <ul className="ca-facts">
            <li><Icon name="phone" size={14} />{t('communityAdmin.phone')}: {a.organizerPhone ? <a href={`tel:${a.organizerPhone}`}>{a.organizerPhone}</a> : '–'}{a.organizerName ? ` (${a.organizerName})` : ''}</li>
            <li><Icon name="sparkle" size={14} />{t('communityAdmin.aiSafe', { v: yesNo(a.ai.safe) })}{a.ai.confidence !== null ? ` (${a.ai.confidence}%)` : ''}{a.ai.fixed !== null ? ` · ${t('communityAdmin.aiFixed', { v: yesNo(a.ai.fixed), c: a.ai.fixedConfidence ?? 0 })}` : ''}</li>
            {a.ai.reason && <li><Icon name="info" size={14} />{a.ai.reason}</li>}
            {(a.votes.done > 0 || a.votes.notDone > 0) && <li><Icon name="users" size={14} />{t('communityAdmin.votes', { yes: a.votes.done, no: a.votes.notDone })}</li>}
            {a.prize && <li><Icon name="gift" size={14} />{a.prize.amount} {lang === 'en' ? 'lek' : 'lekë'}{a.prize.choice ? ` · ${t(a.prize.choice === 'COFFEE' ? 'community.page.coffee' : 'community.page.market')} · ${a.prize.partner}` : ''}{a.prizeCode ? ` · ${t('communityAdmin.code')}: ${a.prizeCode}` : ''}{a.prize.redeemed ? ` · ${t('community.page.redeemed')}` : ''}</li>}
            <li><Icon name="clock" size={14} />{t('communityAdmin.created')}: {formatDate(a.createdAt, lang, true)}</li>
          </ul>
          {needsReason && (
            <Field label={t('communityAdmin.reason')} htmlFor={`ca-reason-${a.id}`}>
              <textarea id={`ca-reason-${a.id}`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          <div className="ca-actions">
            {buttons.map(([d, label, withReason]) => (
              <button key={d} type="button" className={`btn btn-sm${withReason ? ' btn-outline' : ''}`} disabled={busy || (withReason && reason.trim().length < 5)} onClick={() => void decide(d)}>{label}</button>
            ))}
            {a.status !== 'REVIEW' && a.status !== 'REJECTED' && <Link href={`/ndihmo/${a.code}`} className="btn btn-sm btn-ghost" target="_blank">{t('communityAdmin.open')}<Icon name="external" size={14} /></Link>}
          </div>
          {error && <ErrorAlert error={error} />}
          {notice && <SuccessAlert>{notice}</SuccessAlert>}
        </div>
      )}
    </article>
  );
}

function SettingsForm({ settings }: { settings: CommunitySettings }) {
  const { t } = useI18n();
  const { busy, error, notice, run } = useAdminAction();
  const [s, setS] = useState({ ...settings, partnerPin: '' });
  const setTier = (i: number, key: 'minPeople' | 'amount', v: number) => setS({ ...s, tiers: s.tiers.map((x, j) => (j === i ? { ...x, [key]: v } : x)) });
  return (
    <form className="card ca-settings" onSubmit={(e) => {
      e.preventDefault();
      void run(() => call(updateCommunitySettingsAction({
        enabled: s.enabled, rewards: s.rewards, tiers: s.tiers, coffeePartner: s.coffeePartner, marketPartner: s.marketPartner,
        monthlyBudget: s.monthlyBudget, checkFrom: s.checkFrom, partnerPin: s.partnerPin,
      })), t('communityAdmin.saved')).then(() => setS((x) => ({ ...x, partnerPin: '' })));
    }}>
      <h2><Icon name="gift" size={20} />{t('communityAdmin.settings')}</h2>
      <label className="switch">
        <input type="checkbox" role="switch" checked={s.enabled} aria-checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        <span className="switch-track" aria-hidden="true" />
        <span>{t('communityAdmin.enabled')}</span>
      </label>
      <label className="switch">
        <input type="checkbox" role="switch" checked={s.rewards} aria-checked={s.rewards} onChange={(e) => setS({ ...s, rewards: e.target.checked })} />
        <span className="switch-track" aria-hidden="true" />
        <span>{t('communityAdmin.rewards')}</span>
      </label>
      <p className="muted small" style={{ margin: '-6px 0 0' }}>{t('communityAdmin.rewardsHint')}</p>
      {s.rewards && <>
      <fieldset className="ca-tiers">
        <legend>{t('communityAdmin.tiers')}</legend>
        {s.tiers.map((tier, i) => (
          <div key={i} className="ca-tier">
            <Field label={t('communityAdmin.fromPeople')} htmlFor={`ca-t-${i}`}><input id={`ca-t-${i}`} type="number" min={1} max={100} value={tier.minPeople} disabled={i === 0} onChange={(e) => setTier(i, 'minPeople', Number(e.target.value))} /></Field>
            <Field label={t('communityAdmin.amount')} htmlFor={`ca-a-${i}`}><input id={`ca-a-${i}`} type="number" min={0} max={100000} step={50} value={tier.amount} onChange={(e) => setTier(i, 'amount', Number(e.target.value))} /></Field>
            {i > 0 ? <button type="button" className="btn btn-sm btn-ghost" aria-label="×" onClick={() => setS({ ...s, tiers: s.tiers.filter((_, j) => j !== i) })}><Icon name="close" size={16} /></button> : <span className="ca-tier-gap" />}
          </div>
        ))}
        {s.tiers.length < 6 && <button type="button" className="btn btn-sm btn-outline" onClick={() => setS({ ...s, tiers: [...s.tiers, { minPeople: (s.tiers.at(-1)?.minPeople ?? 1) + 3, amount: (s.tiers.at(-1)?.amount ?? 200) + 100 }] })}><Icon name="plus" size={14} />{t('communityAdmin.addTier')}</button>}
      </fieldset>
      <div className="ca-grid">
        <Field label={t('communityAdmin.coffeePartner')} htmlFor="ca-coffee"><input id="ca-coffee" value={s.coffeePartner} maxLength={80} onChange={(e) => setS({ ...s, coffeePartner: e.target.value })} /></Field>
        <Field label={t('communityAdmin.marketPartner')} htmlFor="ca-market"><input id="ca-market" value={s.marketPartner} maxLength={80} onChange={(e) => setS({ ...s, marketPartner: e.target.value })} /></Field>
        <Field label={t('communityAdmin.budget')} htmlFor="ca-budget"><input id="ca-budget" type="number" min={0} step={1000} value={s.monthlyBudget} onChange={(e) => setS({ ...s, monthlyBudget: Number(e.target.value) })} /></Field>
        <Field label={t('communityAdmin.checkFrom')} htmlFor="ca-check"><input id="ca-check" type="number" min={0} step={50} value={s.checkFrom} onChange={(e) => setS({ ...s, checkFrom: Number(e.target.value) })} /></Field>
        <Field label={t('communityAdmin.pin')} htmlFor="ca-pin" hint={`${t('communityAdmin.pinHint')} ${settings.hasPartnerPin ? t('communityAdmin.pinSet') : t('communityAdmin.pinMissing')}`}>
          <input id="ca-pin" inputMode="numeric" autoComplete="off" value={s.partnerPin} maxLength={12} onChange={(e) => setS({ ...s, partnerPin: e.target.value.replace(/\D/g, '') })} />
        </Field>
      </div>
      </>}
      {error && <ErrorAlert error={error} />}
      {notice && <SuccessAlert>{notice}</SuccessAlert>}
      <div><button type="submit" className="btn" disabled={busy}>{t('communityAdmin.save')}</button></div>
    </form>
  );
}

export default function CommunityAdmin({ waiting, others, settings }: { waiting: AdminActionItem[]; others: AdminActionItem[]; settings: CommunitySettings }) {
  const { t } = useI18n();
  return (
    <div className="stack">
      <h1>{t('communityAdmin.title')}</h1>
      <p className="muted">{t('communityAdmin.lead')}</p>
      <section className="stack">
        <h2>{t('communityAdmin.waiting')}{waiting.length > 0 && <span className="badge status-received" style={{ marginLeft: 8 }}>{waiting.length}</span>}</h2>
        {waiting.length === 0 ? <p className="muted">{t('communityAdmin.none')}</p> : waiting.map((a) => <ActionItem key={a.id} a={a} open />)}
      </section>
      {others.length > 0 && (
        <section className="stack">
          <h2>{t('communityAdmin.all')}</h2>
          {others.map((a) => <ActionItem key={a.id} a={a} open={false} />)}
        </section>
      )}
      <SettingsForm settings={settings} />
    </div>
  );
}
