'use client';
/** Small shared UI pieces (same look as v2). */
import type { KeyboardEvent, ReactNode } from 'react';
import { useI18n } from '@/i18n';
import { delta, formatNumber, key } from '@/lib/client/format';
import type { Priority, PublicStatus, Status } from '@/lib/shared/domain';
import Icon from './Icon';

export function Spinner({ label }: { label?: string }) {
  const { t } = useI18n();
  return <div role="status" aria-live="polite"><div className="spinner" /><span className="sr-only">{label || t('common.loading')}</span></div>;
}

type ErrorLike = { code?: string; message?: string; details?: unknown } | null | undefined;

export function ErrorAlert({ error, onRetry, showDetails = true }: { error: ErrorLike; onRetry?: () => void; showDetails?: boolean }) {
  const { t } = useI18n();
  if (!error) return null;
  const message = error.code === 'NETWORK' || error.message === 'network' ? t('errors.network') : error.message || t('errors.generic');
  const details = showDetails && Array.isArray(error.details)
    ? (error.details as Array<{ message?: string } | null>).filter((d): d is { message: string } => Boolean(d?.message))
    : [];
  return (
    <div className="alert alert-error" role="alert">
      <div className="row-between">
        <span>{message}</span>
        {onRetry && <button type="button" className="btn btn-sm btn-outline" onClick={onRetry}>{t('common.retry')}</button>}
      </div>
      {details.length > 0 && (
        <ul className="small" style={{ margin: '6px 0 0' }}>
          {details.map((d, i) => <li key={i}>{d.message}</li>)}
        </ul>
      )}
    </div>
  );
}

export function SuccessAlert({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <div className="alert alert-ok" role="status">{children}</div>;
}

export function StatusBadge({ status }: { status: PublicStatus }) {
  const { t } = useI18n();
  return <span className={`badge status-${key(status)}`}>{t(`status.${key(status)}`)}</span>;
}

const INTERNAL_TO_PUBLIC: Record<Status, string> = {
  PENDING: 'received', NEEDS_REVIEW: 'received', VERIFIED: 'open', ASSIGNED: 'open', IN_PROGRESS: 'in_progress', RESOLVED: 'resolved', CLOSED: 'closed', REJECTED: 'rejected',
};
export function InternalStatusBadge({ status }: { status: Status }) {
  const { t } = useI18n();
  return <span className={`badge status-${INTERNAL_TO_PUBLIC[status] ?? 'received'}`}>{t(`internalStatus.${key(status)}`)}</span>;
}

const PRIORITY_ICON: Record<Priority, string> = { HIGH: 'arrowUp', MEDIUM: 'minus', LOW: 'arrowDown' };
/** Priority is shown with an icon and a word, never with colour alone. */
export function PriorityBadge({ priority, compact = false }: { priority: Priority | null | undefined; compact?: boolean }) {
  const { t } = useI18n();
  if (!priority) return null;
  const label = t(`priority.${key(priority)}`);
  return (
    <span className={`priority priority-${key(priority)}`} title={label}>
      <Icon name={PRIORITY_ICON[priority]} size={14} strokeWidth={2.4} />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

export function TestBadge({ show }: { show: boolean }) {
  const { t } = useI18n();
  return show ? <span className="badge badge-test">{t('common.test')}</span> : null;
}

export function OverdueBadge({ show }: { show: boolean }) {
  const { t } = useI18n();
  return show ? <span className="badge badge-overdue"><Icon name="clock" size={12} />{t('panel.overdue')}</span> : null;
}

export function TransferBadge({ show }: { show: boolean }) {
  const { t } = useI18n();
  return show ? <span className="badge badge-transfer">{t('panel.transferPending')}</span> : null;
}

export function CategoryIcon({ icon, size = 34 }: { icon: string | null | undefined; size?: number }) {
  return <Icon name={icon ?? 'other'} size={size} strokeWidth={1.6} />;
}

export function Field({ label, hint, error, children, htmlFor, required }: {
  label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; required?: boolean;
}) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      {label && <label htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>}
      {children}
      {error && <div className="field-error" role="alert"><Icon name="alert" size={14} />{error}</div>}
      {hint && !error && <div className="hint">{hint}</div>}
    </div>
  );
}

export interface SegmentedOption<V extends string> { value: V; label: ReactNode; icon?: string; count?: number; disabled?: boolean }

/** Two to five mutually exclusive options shown as a button row (a radio group: arrow keys move the choice). */
export function Segmented<V extends string>({ options, value, onChange, label, size }: {
  options: Array<SegmentedOption<V>>; value: V; onChange: (value: V) => void; label: string; size?: 'sm';
}) {
  const enabled = options.filter((o) => !o.disabled);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const step = keys[e.key];
    if (step === undefined || !enabled.length) return;
    e.preventDefault();
    const current = enabled.findIndex((o) => o.value === value);
    const next = enabled[(current + step + enabled.length) % enabled.length]!;
    onChange(next.value);
    const group = e.currentTarget.closest('[role="radiogroup"]');
    requestAnimationFrame(() => group?.querySelector<HTMLElement>(`[data-value="${CSS.escape(String(next.value))}"]`)?.focus());
  }
  return (
    <div className={`segmented${size === 'sm' ? ' sm' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value} type="button" role="radio" aria-checked={value === o.value} data-value={o.value}
          tabIndex={i === selectedIndex ? 0 : -1} onKeyDown={onKeyDown}
          className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)} disabled={o.disabled}
        >
          {o.icon && <Icon name={o.icon} size={14} strokeWidth={2.4} />}
          {o.label}
          {o.count !== undefined && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Stat tile: label, value and the change against the previous period. */
export function KpiTile({ label, value, previous, suffix = '', upIsGood = true, hint, accent }: {
  label: ReactNode; value: number | null | undefined; previous?: number; suffix?: string; upIsGood?: boolean | null; hint?: ReactNode; accent?: string;
}) {
  const { t, lang } = useI18n();
  const d = previous === undefined ? null : delta(value ?? 0, previous ?? 0);
  // upIsGood = null: the change is shown without judging it (e.g. more reports received).
  const good = d && d.pct !== null && d.direction !== 'flat' && upIsGood !== null ? (d.direction === 'up') === upIsGood : null;
  return (
    <div className={`kpi${accent ? ` kpi-${accent}` : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value === null || value === undefined ? '–' : `${formatNumber(value, lang)}${suffix}`}</div>
      {d && (
        <div className={`delta${good === true ? ' good' : good === false ? ' bad' : ''}`}>
          {d.pct !== null && d.direction === 'up' && <Icon name="arrowUp" size={14} strokeWidth={2.6} />}
          {d.pct !== null && d.direction === 'down' && <Icon name="arrowDown" size={14} strokeWidth={2.6} />}
          {d.pct === null ? t('dashboard.noPrevious') : `${d.pct > 0 ? '+' : ''}${d.pct}% ${t('dashboard.vsPrevious', { n: previous })}`}
        </div>
      )}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export interface BarRow { key?: string | number; label: string; total: number; resolved?: number; [extra: string]: unknown }

/** Horizontal bars. With withResolved: the resolved part + the rest. */
export function BarList({ rows, withResolved = false, emptyText, onRowClick }: {
  rows: BarRow[]; withResolved?: boolean; emptyText?: ReactNode; onRowClick?: (row: BarRow) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => r.total || 0));
  if (!rows.length) return <p className="muted">{emptyText}</p>;
  return (
    <div className="bars">
      {rows.map((r) => {
        const resolved = r.resolved ?? 0;
        const content = (
          <>
            <span className="bar-label" title={r.label}>{r.label}</span>
            <div className="bar-track" aria-hidden="true">
              {withResolved ? (
                <>
                  {resolved > 0 && <div className="bar-fill" style={{ width: `${(resolved / max) * 100}%` }} />}
                  {r.total - resolved > 0 && <div className="bar-fill secondary" style={{ width: `${((r.total - resolved) / max) * 100}%` }} />}
                </>
              ) : (
                r.total > 0 && <div className="bar-fill single" style={{ width: `${(r.total / max) * 100}%` }} />
              )}
            </div>
            <span className="bar-num">{r.total}{withResolved ? <span className="muted"> / {resolved}</span> : null}</span>
          </>
        );
        const title = withResolved ? `${r.label}: ${r.total} (${resolved} ✓)` : `${r.label}: ${r.total}`;
        return onRowClick ? (
          <button type="button" className="bar-row clickable" key={r.key ?? r.label} title={title} onClick={() => onRowClick(r)}>{content}</button>
        ) : (
          <div className="bar-row" key={r.key ?? r.label} title={title}>{content}</div>
        );
      })}
    </div>
  );
}

/** Paired columns per month (public statistics). */
export function ColumnChart({ rows, aLabel, bLabel }: { rows: Array<{ label: string; short?: string; a: number; b: number }>; aLabel: string; bLabel: string }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a || 0, r.b || 0]));
  return (
    <div>
      <div className="legend"><span><i style={{ background: 'var(--series-a)' }} />{aLabel}</span><span><i style={{ background: 'var(--series-b)' }} />{bLabel}</span></div>
      <div className="columns" role="img" aria-label={`${aLabel} / ${bLabel}`}>
        {rows.map((r) => (
          <div className="col" key={r.label} title={`${r.label}: ${aLabel} ${r.a} · ${bLabel} ${r.b}`}>
            <div className="pair">
              <div className="b" style={{ height: `${((r.a || 0) / max) * 100}%` }} />
              <div className="b secondary" style={{ height: `${((r.b || 0) / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="columns-labels">{rows.map((r) => <span key={r.label}>{r.short ?? r.label}</span>)}</div>
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, text, action }: { icon?: string; title?: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={40} strokeWidth={1.4} />
      {title && <h3>{title}</h3>}
      {text && <p className="muted">{text}</p>}
      {action}
    </div>
  );
}

export function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  const { t } = useI18n();
  if (!pages || pages <= 1) return null;
  return (
    <nav className="pagination" aria-label={t('common.pages')}>
      <button type="button" className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label={t('common.previous')}>←</button>
      <span className="small">{t('common.pageOf', { n: page, total: pages })}</span>
      <button type="button" className="btn btn-sm btn-outline" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label={t('common.nextPage')}>→</button>
    </nav>
  );
}
