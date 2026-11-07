'use client';
/**
 * The plain lines that tell the admin where a report stands with its sector:
 *  - did the request really reach the sector (sent / only saved because SMTP is off / failed);
 *  - has the sector accepted it (waiting / accepted / cannot handle it / resolved).
 * Used on the board rows and on the report's own page.
 */
import type { ReactNode } from 'react';
import Icon, { type IconName } from '@/components/Icon';
import { useI18n } from '@/i18n';
import { timeAgo } from '@/lib/client/format';
import type { SectorMailStatus } from '@/lib/shared/types';

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

export function StatusLine({ tone, icon, children, extra }: { tone: Tone; icon: IconName; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className={`st st-${tone}`} suppressHydrationWarning>
      <Icon name={icon} size={15} />
      <span>{children}</span>
      {extra}
    </div>
  );
}

/** Whether the request reached the sector. `sentAt` is the link's date, for reports sent before e-mails were tracked. */
export function DeliveryLine({ mail, email, sentAt }: { mail: SectorMailStatus | null; email: string; sentAt?: string | null }) {
  const { t } = useI18n();
  if (!mail) return sentAt ? <StatusLine tone="ok" icon="check">{t('board.delivery.sent', { email, when: timeAgo(sentAt, t) })}</StatusLine> : null;
  switch (mail.status) {
    case 'SENT': return <StatusLine tone="ok" icon="check">{t('board.delivery.sent', { email, when: timeAgo(mail.at, t) })}</StatusLine>;
    case 'LOGGED': return <StatusLine tone="warn" icon="alert">{t('board.delivery.logged', { email })}</StatusLine>;
    case 'FAILED': return <StatusLine tone="bad" icon="alert">{t('board.delivery.failed', { email, error: mail.error ?? '' })}</StatusLine>;
    default: return <StatusLine tone="muted" icon="clock">{t('board.delivery.queued', { email })}</StatusLine>;
  }
}
