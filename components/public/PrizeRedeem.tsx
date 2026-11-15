'use client';
/** The reward's page, opened by the partner (café or market) from its QR: shows it and marks it used with the PIN. */
import Link from 'next/link';
import { useState } from 'react';
import { redeemPrizeAction } from '@/actions/community';
import Icon from '@/components/Icon';
import { ErrorAlert, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { call } from '@/lib/client/action';
import { formatDate } from '@/lib/client/format';
import type { PrizeView } from '@/lib/shared/types';

export default function PrizeRedeem({ prize: initial }: { prize: PrizeView | null }) {
  const { t, lang } = useI18n();
  const [prize, setPrize] = useState(initial);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  if (!prize) return <div className="container cm-page cm-narrow"><h1>{t('community.redeem.notFound')}</h1></div>;

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setPrize(await call(redeemPrizeAction({ prizeCode: prize!.code, pin })));
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container cm-page cm-narrow">
      <div className="cm-ticket">
        <span className="cm-ticket-icon" aria-hidden="true">{prize.choice === 'COFFEE' ? '☕' : '🛒'}</span>
        <p className="cm-kicker">{t('community.redeem.title')}</p>
        <h1>{t('community.redeem.amount', { n: prize.amount })}</h1>
        <p className="lead">{t(prize.choice === 'COFFEE' ? 'community.page.coffee' : 'community.page.market')} · {prize.partner}</p>
        <p className="cm-code">{prize.code}</p>
        <p className="cm-muted">{t('community.redeem.people', { n: prize.people })} · {t('community.redeem.action')}: <Link href={`/ndihmo/${prize.actionCode}`}>{prize.title}</Link></p>
        {prize.redeemedAt ? (
          <p className={done ? 'cm-ok' : 'cm-warn'}><Icon name={done ? 'check' : 'alert'} size={18} />{done ? t('community.redeem.done') : t('community.redeem.used', { date: formatDate(prize.redeemedAt, lang, true) })}</p>
        ) : prize.held ? (
          <p className="cm-warn"><Icon name="alert" size={18} />{t('community.redeem.held')}</p>
        ) : (
          <form onSubmit={redeem} className="cm-redeem">
            <Field label={t('community.redeem.pin')} htmlFor="cm-pin">
              <input id="cm-pin" type="password" inputMode="numeric" autoComplete="off" value={pin} maxLength={12} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </Field>
            {error ? <ErrorAlert error={error} /> : null}
            <button type="submit" className="btn" disabled={busy || pin.length < 4}><Icon name="check" size={18} />{t('community.redeem.button')}</button>
          </form>
        )}
      </div>
    </div>
  );
}
