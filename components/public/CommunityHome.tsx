'use client';
/**
 * "Ndihmo qytetin": what it is, the group's reward, the actions coming up and the ones done
 * (lib/server/services/community.ts). Creating one: /ndihmo/krijo.
 */
import Link from 'next/link';
import Icon from '@/components/Icon';
import { useI18n } from '@/i18n';
import { durationText } from '@/lib/client/community';
import { formatDate } from '@/lib/client/format';
import type { ActionCard, CommunitySettings } from '@/lib/shared/types';

export function prizeRows(tiers: CommunitySettings['tiers'], t: (k: string, v?: Record<string, string | number>) => string) {
  const sorted = [...tiers].sort((a, b) => a.minPeople - b.minPeople);
  return sorted.map((tier, i) => {
    const next = sorted[i + 1];
    return {
      people: !next ? t('community.prizes.from', { n: tier.minPeople })
        : next.minPeople - 1 === tier.minPeople ? t('communityAdmin.people', { n: tier.minPeople })
          : t('community.prizes.range', { from: tier.minPeople, to: next.minPeople - 1 }),
      amount: t('community.prizes.lek', { n: tier.amount }),
    };
  });
}

export function ActionCardView({ a }: { a: ActionCard }) {
  const { t, lang } = useI18n();
  return (
    <Link href={`/ndihmo/${a.code}`} className="cm-card">
      <span className="cm-card-photo">
        {a.photoUrl ? <img src={a.photoUrl} alt="" loading="lazy" /> : <span className="cm-card-blank"><Icon name="heart" size={32} /></span>}
        <span className={`cm-badge cm-badge-${a.status.toLowerCase()}`}>{t(`community.status.${a.status}`)}</span>
      </span>
      <span className="cm-card-body">
        <strong>{a.title}</strong>
        <span className="cm-card-meta"><Icon name="clock" size={14} />{formatDate(a.startsAt, lang, true)} · {durationText(a.minutes, t)}</span>
        <span className="cm-card-meta"><Icon name="pin" size={14} />{a.place}</span>
      </span>
      <span className="cm-card-foot">
        <span><Icon name="users" size={15} />{a.status === 'VERIFIED' ? t('communityAdmin.people', { n: a.people }) : t('community.people', { n: a.people, m: a.peopleNeeded })}</span>
        {a.status === 'VERIFIED' && a.prizeAmount ? <span className="cm-card-prize"><Icon name="gift" size={15} />{t('community.prizes.lek', { n: a.prizeAmount })}</span> : <Icon name="arrowRight" size={16} />}
      </span>
    </Link>
  );
}

export default function CommunityHome({ upcoming, done, settings }: { upcoming: ActionCard[]; done: ActionCard[]; settings: CommunitySettings }) {
  const { t } = useI18n();
  if (!settings.enabled) {
    return <div className="container cm-page"><h1>{t('community.title')}</h1><p className="lead">{t('community.off')}</p></div>;
  }
  return (
    <div className="cm-page">
      <section className="container cm-hero">
        <div>
          <span className="cm-kicker"><Icon name="heart" size={16} />{t('community.title')}</span>
          <h1>{t('community.home.text')}</h1>
          <p className="lead">{t('community.lead')}</p>
          <Link href="/ndihmo/krijo" className="btn btn-lg cm-cta"><Icon name="plus" size={20} />{t('community.create')}</Link>
        </div>
        <aside className="cm-prize-card" aria-labelledby="cm-prize-title">
          <h2 id="cm-prize-title"><Icon name="gift" size={20} />{t('community.prizes.title')}</h2>
          <ul>
            {prizeRows(settings.tiers, t).map((r) => <li key={r.people}><span>{r.people}</span><strong>{r.amount}</strong></li>)}
          </ul>
          <p>{t('community.prizes.choice', { coffee: settings.coffeePartner, market: settings.marketPartner })}</p>
          <p className="cm-muted">{t('community.prizes.one')}</p>
        </aside>
      </section>

      <section className="container cm-section" aria-labelledby="cm-how">
        <h2 id="cm-how">{t('community.how.title')}</h2>
        <ol className="cm-steps">
          {(['camera', 'users', 'qr', 'gift'] as const).map((icon, i) => (
            <li key={icon}>
              <span className="cm-step-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
              <strong>{t(`community.how.s${i + 1}t`)}</strong>
              <span>{t(`community.how.s${i + 1}`)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="container cm-section" aria-labelledby="cm-upcoming">
        <h2 id="cm-upcoming">{t('community.upcoming')}</h2>
        {upcoming.length ? (
          <div className="cm-grid">{upcoming.map((a) => <ActionCardView key={a.code} a={a} />)}</div>
        ) : (
          <div className="cm-empty"><Icon name="heart" size={22} /><p>{t('community.noneUpcoming')}</p><Link href="/ndihmo/krijo" className="btn btn-outline btn-sm">{t('community.create')}</Link></div>
        )}
      </section>

      {done.length > 0 && (
        <section className="container cm-section" aria-labelledby="cm-done">
          <h2 id="cm-done">{t('community.done')}</h2>
          <div className="cm-grid">{done.map((a) => <ActionCardView key={a.code} a={a} />)}</div>
        </section>
      )}

      <section className="container cm-section">
        <div className="cm-safety"><Icon name="alert" size={20} /><div><strong>{t('community.safety.title')}</strong><p>{t('community.safety.text')}</p></div></div>
      </section>
    </div>
  );
}
