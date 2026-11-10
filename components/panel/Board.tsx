'use client';
/**
 * The admin's board of reports (/admin/reports), split by where each report is:
 * Të reja → Dërguar te sektori → Në punë → Zgjidhur, plus Kthyer nga sektori and Refuzuar.
 * Sectors get their reports by e-mail automatically, so the admin acts only where needed:
 *  - Të reja: send it to its sector, or to another one (a sector without an e-mail cannot get it);
 *  - Dërguar: see when it was sent, opened and reminded; send it again or elsewhere;
 *  - Kthyer: the sector's reason; move it to the right sector or keep it there with a note.
 * Filters (sector, priority, overdue, search) and the column live in the address.
 */
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { dismissDuplicateAction, mergeDuplicateAction, resendToSectorAction, updateReportAction } from '@/actions/reports';
import Icon from '@/components/Icon';
import { useCatalog } from '@/components/providers';
import { EmptyState, ErrorAlert, OverdueBadge, Pagination, PriorityBadge, SuccessAlert, TestBadge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { departmentName, timeAgo, typeName } from '@/lib/client/format';
import { PRIORITIES, type Priority } from '@/lib/shared/domain';
import { BOARD_ATTENTION, BOARD_BUCKETS, type BoardBucket } from '@/lib/shared/reportViews';
import type { Board as BoardData, BoardItem } from '@/lib/shared/types';
import { DeliveryLine, StatusLine } from './SectorStatus';
import TransferDecision from './TransferDecision';

const DAY_MS = 86_400_000;
/** The columns grouped by priority (high first); the finished ones are listed by date. */
const BY_PRIORITY: readonly BoardBucket[] = ['new', 'sent', 'returned', 'working'];
const PRIORITY_ORDER: Priority[] = ['HIGH', 'MEDIUM', 'LOW'];
const REMIND_AFTER_MS = 2 * DAY_MS;

export interface BoardFilters { departmentId: number | null; priority: Priority | null; overdue: boolean; q: string }

export default function Board({ data, filters, mailEnabled = true }: { data: BoardData | null; filters: BoardFilters; mailEnabled?: boolean }) {
  const { t, lang } = useI18n();
  const { departments } = useCatalog();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [loading, startTransition] = useTransition();
  const [search, setSearch] = useState(filters.q);
  useEffect(() => setSearch(filters.q), [filters.q]);
  const bucket = (data?.bucket ?? 'new') as BoardBucket;

  function update(changes: Record<string, string | number | boolean | null>) {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value === '' || value === null || value === false) next.delete(name);
      else next.set(name, value === true ? '1' : String(value));
    }
    if (!('page' in changes)) next.delete('page');
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const returnTo = `${pathname}${params.size ? `?${params}` : ''}`;
  const detailHref = (id: string) => `/admin/reports/${id}?from=${encodeURIComponent(returnTo)}`;

  return (
    <div className="stack board">
      <div className="page-head">
        <div>
          <h1>{t('panel.nav.reports')}</h1>
          <p className="muted" style={{ margin: 0 }}>{t('board.intro')}</p>
        </div>
      </div>
      {!mailEnabled && <div className="alert alert-warn" role="status"><Icon name="alert" size={18} /> {t('board.mailOff')}</div>}

      <nav className="board-tabs" aria-label={t('panel.nav.reports')}>
        {BOARD_BUCKETS.map((b, i) => {
          const n = data?.counts[b] ?? 0;
          const attention = BOARD_ATTENTION.includes(b) && n > 0;
          return (
            <button
              key={b} type="button" aria-current={bucket === b ? 'page' : undefined}
              className={`board-tab tab-${b}${bucket === b ? ' active' : ''}${attention ? ' attention' : ''}`}
              onClick={() => update({ tab: b })}
            >
              <span className="board-tab-label">{t(`board.tabs.${b}`)}</span>
              <span className="board-tab-count">{data ? n : '·'}</span>
              {i < 3 && <Icon name="chevronRight" size={16} className="board-tab-arrow" />}
            </button>
          );
        })}
      </nav>
      <p className="board-hint">{t(`board.hints.${bucket}`)}</p>

      <div className="filter-row">
        <div className="field inline">
          <label htmlFor="b-sector">{t('board.sector')}</label>
          <select id="b-sector" value={filters.departmentId ?? ''} onChange={(e) => update({ departmentId: e.target.value || null })}>
            <option value="">{t('board.allSectors')}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{departmentName(d, lang)}</option>)}
          </select>
        </div>
        <div className="field inline">
          <label htmlFor="b-priority">{t('board.priority')}</label>
          <select id="b-priority" value={filters.priority ?? ''} onChange={(e) => update({ priority: e.target.value || null })}>
            <option value="">{t('board.allPriorities')}</option>
            {PRIORITIES.slice().reverse().map((p) => <option key={p} value={p}>{t(`priority.${p.toLowerCase()}`)}</option>)}
          </select>
        </div>
        <form className="search-inline" role="search" onSubmit={(e) => { e.preventDefault(); update({ q: search.trim() }); }}>
          <label htmlFor="b-search" className="sr-only">{t('board.search')}</label>
          <input id="b-search" type="search" maxLength={100} placeholder={t('board.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" className="btn btn-sm btn-outline"><Icon name="search" size={16} /><span className="sr-only">{t('board.search')}</span></button>
        </form>
        <label className="check small"><input type="checkbox" checked={filters.overdue} onChange={(e) => update({ overdue: e.target.checked })} /><span>{t('board.overdue')}</span></label>
      </div>

      {!data && <div className="alert alert-error" role="alert">{t('errors.generic')}</div>}
      {data && (
        <div className={loading ? 'refreshing' : ''} aria-busy={loading}>
          {data.items.length === 0 ? (
            <EmptyState icon="inbox" title={t('board.empty')} />
          ) : BY_PRIORITY.includes(bucket) ? (
            // Waiting and in work: grouped by priority, high first (it needs action at once), oldest first inside.
            PRIORITY_ORDER.filter((p) => data.items.some((r) => r.priority === p)).map((p) => (
              <section key={p} className={`board-group group-${p.toLowerCase()}`} aria-labelledby={`bg-${p}`}>
                <h2 id={`bg-${p}`} className="board-group-title">
                  <PriorityBadge priority={p} />
                  <span>{t(`board.groups.${p}`)}</span>
                  <span className="board-group-count">{data.byPriority[p] ?? 0}</span>
                </h2>
                <ul className="board-list">
                  {data.items.filter((r) => r.priority === p).map((r) => (
                    <BoardRow key={r.id} r={r} bucket={bucket} href={detailHref(r.id)} onChanged={() => router.refresh()} />
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <ul className="board-list">
              {data.items.map((r) => (
                <BoardRow key={r.id} r={r} bucket={bucket} href={detailHref(r.id)} onChanged={() => router.refresh()} />
              ))}
            </ul>
          )}
          <Pagination page={data.page} pages={data.pages} onChange={(p) => update({ page: p === 1 ? null : p })} />
        </div>
      )}
    </div>
  );
}

function BoardRow({ r, bucket, href, onChanged }: { r: BoardItem; bucket: BoardBucket; href: string; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const sector = departmentName(r.department, lang);
  const place = [r.address, r.neighbourhood].filter(Boolean).join(' · ');
  return (
    <li className={`board-row priority-row-${r.priority.toLowerCase()}${r.overdue ? ' overdue' : ''}`}>
      <div className="board-main">
        <div className="board-title">
          <PriorityBadge priority={r.priority} />
          <Link href={href} className="board-type">{typeName(r.type, lang)}</Link>
          <Link href={href} className="case-number">{r.caseNumber}</Link>
          <OverdueBadge show={r.overdue} />
          <TestBadge show={r.isTest} />
        </div>
        <div className="board-meta" suppressHydrationWarning>
          {[place, t('board.received', { when: timeAgo(r.createdAt, t) }), bucket !== 'new' && sector ? sector : null].filter(Boolean).join(' · ')}
        </div>
        {bucket !== 'new' && bucket !== 'rejected' && <SectorStatus r={r} bucket={bucket} />}
        {bucket === 'new' && r.duplicate && <DuplicateNote d={r.duplicate} />}
        {bucket === 'returned' && r.returned && (
          <div className="board-info warn">
            <strong>{t('board.returnedBy')}</strong> “{r.returned.reason}”
            {r.returned.suggestedDepartment && <div className="small">{t('board.suggested', { sector: departmentName(r.returned.suggestedDepartment, lang) ?? '' })}</div>}
          </div>
        )}
        {bucket === 'resolved' && r.closingNote && <div className="board-info"><strong>{t('board.note')}</strong> “{r.closingNote}”</div>}
        {bucket === 'rejected' && r.rejectionReason && <div className="board-info"><strong>{t('board.reason')}</strong> “{r.rejectionReason}”</div>}
      </div>
      <div className="board-actions">
        {bucket === 'new' && r.duplicate && <DuplicateControls r={r} onChanged={onChanged} />}
        {((bucket === 'new' && !r.duplicate) || bucket === 'sent') && <SendControls r={r} onChanged={onChanged} />}
        {bucket === 'returned' && r.returned && (
          <TransferDecision transfer={r.returned} currentDepartmentId={r.department?.id} onDone={onChanged} />
        )}
        {(bucket === 'working' || bucket === 'resolved' || bucket === 'rejected') && (
          <Link href={href} className="btn btn-sm btn-outline">{t('board.open')}<Icon name="arrowRight" size={16} /></Link>
        )}
      </div>
    </li>
  );
}

/** "Maybe the same problem as EL-…": what the other report is, how far, and how many people support it. */
function DuplicateNote({ d }: { d: NonNullable<BoardItem['duplicate']> }) {
  const { t, lang } = useI18n();
  return (
    <div className="dup-note" suppressHydrationWarning>
      <Icon name="layers" size={18} />
      <div>
        <strong>{t('board.dup.title')}</strong>{' '}
        <Link href={`/admin/reports/${d.id}`} className="case-number">{d.caseNumber}</Link>
        <div className="small">
          {[lang === 'en' ? d.typeNameEn : d.typeNameSq, d.meters !== null ? t('board.dup.meters', { n: d.meters }) : t('board.dup.sameAddress'), d.address,
            t('board.received', { when: timeAgo(d.createdAt, t) }), d.supporters ? t('board.dup.supporters', { n: d.supporters }) : null].filter(Boolean).join(' · ')}
        </div>
        {d.photos && (
          <div className={`dup-photos ${d.photos.same ? 'same' : 'different'}`}>
            <Icon name={d.photos.same ? 'check' : 'alert'} size={14} strokeWidth={2.4} />
            <span>
              <strong>{t(d.photos.same ? 'board.dup.photosSame' : 'board.dup.photosDifferent', { n: d.photos.confidence })}</strong>
              {d.photos.reason && <> {d.photos.reason}</>}
            </span>
          </div>
        )}
        <div className="small muted">{t('board.dup.held')}</div>
      </div>
    </div>
  );
}

/** Merge into the earlier report, or say it is different and send it to the sector. */
function DuplicateControls({ r, onChanged }: { r: BoardItem; onChanged: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await fn(); onChanged(); } catch (err) { setError(err as ActionFailure); } finally { setBusy(false); }
  }
  return (
    <div className="send-controls">
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(() => call(mergeDuplicateAction(r.id)))}>
        <Icon name="layers" size={16} />{t('board.dup.merge', { n: r.duplicate!.caseNumber })}
      </button>
      <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={() => run(() => call(dismissDuplicateAction(r.id)))}>
        <Icon name="send" size={16} />{t('board.dup.different')}
      </button>
      {error && <p className="small error-text" role="alert">{error.message}</p>}
    </div>
  );
}

/** Two plain lines: did the request reach the sector, and has the sector accepted it. */
function SectorStatus({ r, bucket }: { r: BoardItem; bucket: BoardBucket }) {
  const { t } = useI18n();
  const sent = r.sent;
  const waited = sent ? Date.now() - new Date(sent.sentAt).getTime() : 0;
  return (
    <div className="board-status">
      <DeliveryLine mail={r.mail} email={sent?.email ?? r.departmentEmail ?? ''} sentAt={sent?.sentAt} />
      {bucket === 'sent' && (
        <StatusLine tone="warn" icon="clock" extra={waited >= REMIND_AFTER_MS && <span className="badge badge-overdue">{t('board.unanswered', { n: Math.max(2, Math.round(waited / DAY_MS)) })}</span>}>
          {t('board.accept.waiting')}
          {sent && <> · {sent.lastUsedAt ? t('board.opened', { when: timeAgo(sent.lastUsedAt, t) }) : t('board.notOpened')}</>}
          {sent?.remindedAt && <> · {t('board.reminded', { when: timeAgo(sent.remindedAt, t) })}</>}
        </StatusLine>
      )}
      {bucket === 'sent' && sent && new Date(sent.expiresAt).getTime() < Date.now() && <StatusLine tone="bad" icon="alert">{t('board.expired')}</StatusLine>}
      {bucket === 'returned' && <StatusLine tone="bad" icon="transfer">{t('board.accept.returned')}</StatusLine>}
      {bucket === 'working' && <StatusLine tone="ok" icon="check">{r.acceptedAt ? t('board.accept.accepted', { when: timeAgo(r.acceptedAt, t) }) : t('board.accept.acceptedPlain')}</StatusLine>}
      {bucket === 'resolved' && r.resolvedAt && <StatusLine tone="ok" icon="check">{t('board.accept.resolved', { when: timeAgo(r.resolvedAt, t) })}</StatusLine>}
    </div>
  );
}

/**
 * "Dërgo te …": e-mail it to its sector (again), or choose another sector (the report moves there and
 * is e-mailed to it). A sector without an e-mail address cannot get it: its address is set first.
 */
function SendControls({ r, onChanged }: { r: BoardItem; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const { departments } = useCatalog();
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<ActionFailure | null>(null);
  const sector = departmentName(r.department, lang);

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setDone(message);
      onChanged();
    } catch (err) {
      setError(err as ActionFailure);
    } finally {
      setBusy(false);
    }
  }

  const target = departments.find((d) => d.id === Number(other));
  return (
    <div className="send-controls">
      {!r.department && <p className="small warn-text">{t('board.noSector')}</p>}
      {r.department && !r.departmentEmail && (
        <p className="small warn-text">
          {t('board.noEmail', { sector: sector ?? '' })} <Link href="/admin/departments">{t('board.addEmail')}</Link>
        </p>
      )}
      {r.department && r.departmentEmail && (
        <button type="button" className={`btn btn-sm${r.sent ? ' btn-outline' : ''}`} disabled={busy}
          onClick={() => run(() => call(resendToSectorAction(r.id)), t('board.done', { sector: sector ?? '' }))}>
          <Icon name="send" size={16} />{r.sent ? t('board.resend') : t('board.sendTo', { sector: sector ?? '' })}
        </button>
      )}
      <div className="send-other">
        <label htmlFor={`b-other-${r.id}`} className="small muted">{t('board.otherSector')}</label>
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <select id={`b-other-${r.id}`} value={other} onChange={(e) => setOther(e.target.value)}>
            <option value="">{t('board.chooseSector')}</option>
            {departments.filter((d) => d.id !== r.department?.id).map((d) => <option key={d.id} value={d.id}>{departmentName(d, lang)}</option>)}
          </select>
          <button type="button" className="btn btn-sm btn-outline" disabled={busy || !other}
            onClick={() => run(() => call(updateReportAction(r.id, { departmentId: Number(other) })), t('board.done', { sector: departmentName(target, lang) ?? '' }))}>
            {t('board.send')}
          </button>
        </div>
      </div>
      {done && <SuccessAlert>{done}</SuccessAlert>}
      <ErrorAlert error={error} />
    </div>
  );
}
