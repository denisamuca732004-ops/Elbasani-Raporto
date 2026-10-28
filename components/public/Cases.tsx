'use client';
/** Public case card and timeline. */
import Link from 'next/link';
import Icon from '@/components/Icon';
import { StatusBadge, TestBadge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { distanceLabel, formatDate, key, timeAgo, typeName } from '@/lib/client/format';
import type { PublicCard, PublicTimelineItem } from '@/lib/shared/types';

export function CaseCard({ item, href }: { item: PublicCard; href?: string }) {
  const { t, lang } = useI18n();
  return (
    <Link href={href ?? `/ndiq/${item.caseNumber}`} className="case-card">
      <div className="photo" style={item.photoUrl ? { backgroundImage: `url(${item.photoUrl})` } : undefined}>
        {!item.photoUrl && <Icon name={item.category?.icon || 'other'} size={44} strokeWidth={1.3} />}
      </div>
      <div className="body">
        <div className="row-between"><StatusBadge status={item.publicStatus} /><TestBadge show={item.isTest} /></div>
        <span className="type">{typeName(item.type, lang)}</span>
        <span className="meta">{item.address || item.neighbourhood || '–'}</span>
        {/* "para 5 min" can change between the server render and the browser: not a real mismatch */}
        <span className="meta" suppressHydrationWarning>
          <span className="case-number">{item.caseNumber}</span> · {timeAgo(item.createdAt, t)}
          {item.distanceMeters !== null ? ` · ${distanceLabel(item.distanceMeters)}` : ''}
        </span>
        {item.supporters > 0 && <span className="meta">{t('track.supporters', { n: item.supporters })}</span>}
      </div>
    </Link>
  );
}

export function PublicTimeline({ items }: { items: PublicTimelineItem[] }) {
  const { t, lang } = useI18n();
  return (
    <ol className="timeline">
      {items.map((e, i) => (
        <li key={i}>
          <div className="what">{t(`timeline.${key(e.type)}`, { status: e.status ? t(`status.${key(e.status)}`) : '' })}</div>
          {e.status && e.type === 'STATUS_CHANGED' && <div>{t(`status.${key(e.status)}`)}</div>}
          {e.message && <div>{e.message}</div>}
          <div className="when">{formatDate(e.at, lang, true)}</div>
        </li>
      ))}
    </ol>
  );
}
