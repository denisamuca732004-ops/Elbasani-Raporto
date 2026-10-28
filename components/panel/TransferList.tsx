'use client';
/**
 * Review requests ("this report belongs to another department").
 *  - admin: every request; decide to move the report or keep it.
 *  - department head: the requests their department sent, with the admin's answer.
 */
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import Icon from '@/components/Icon';
import { EmptyState, InternalStatusBadge, Pagination, PriorityBadge, Segmented, SuccessAlert, TestBadge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { departmentName, formatDate, key, typeName } from '@/lib/client/format';
import type { Paged, Principal, TransferListItem } from '@/lib/shared/types';
import TransferDecision from './TransferDecision';

export type TransferFilter = 'pending' | 'approved' | 'declined' | 'all';

export default function TransferList({ principal, filter, data }: { principal: Principal; filter: TransferFilter; data: Paged<TransferListItem> | null }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [loading, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const admin = principal.role === 'ADMIN';

  function go(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v === null) next.delete(k); else next.set(k, v); }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{admin ? t('panel.nav.reviews') : t('panel.nav.sectorReviews')}</h1>
          <p className="muted" style={{ margin: 0 }}>{admin ? t('transfers.introAdmin') : t('transfers.introSector')}</p>
        </div>
      </div>
      <div className="filter-row">
        <Segmented<TransferFilter>
          label={t('transfers.filter')}
          value={filter}
          onChange={(v) => go({ status: v === 'pending' ? null : v, page: null })}
          options={(['pending', 'approved', 'declined', 'all'] as const).map((s) => ({ value: s, label: t(`transfers.filters.${s}`) }))}
        />
      </div>
      <SuccessAlert>{notice}</SuccessAlert>
      {!data && <div className="alert alert-error" role="alert">{t('errors.generic')}</div>}
      <div className={loading ? 'stack refreshing' : 'stack'} aria-busy={loading}>
        {data && data.items.length === 0 && <EmptyState icon="transfer" title={t('transfers.emptyTitle')} text={filter === 'pending' ? t('transfers.emptyPending') : t('transfers.empty')} />}
        {data && data.items.map((item) => (
          <article className="card transfer-card" key={item.id}>
            <div className="row-between">
              <div>
                <Link href={`/admin/reports/${item.report.id}`} className="case-number">{item.report.caseNumber}</Link>
                <div className="strong">{typeName(item.report.type, lang)}</div>
                <div className="row" style={{ gap: 6, marginTop: 4 }}>
                  <PriorityBadge priority={item.report.priority} />
                  <InternalStatusBadge status={item.report.status} />
                </div>
              </div>
              <span className={`badge ${item.status === 'PENDING' ? 'badge-transfer' : item.status === 'APPROVED' ? 'status-closed' : 'status-rejected'}`}>
                {t(`transfers.statuses.${key(item.status)}`)}
              </span>
            </div>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>{t('transfers.from')}</dt><dd>{departmentName(item.fromDepartment, lang) ?? '—'}{item.requestedBy ? ` · ${item.requestedBy.name}` : ''}</dd>
              <dt>{t('transfers.sentAt')}</dt><dd>{formatDate(item.createdAt, lang, true)}</dd>
              <dt>{t('transfers.reason')}</dt><dd><blockquote style={{ margin: 0 }}>{item.reason}</blockquote></dd>
              <dt>{t('transfers.suggestion')}</dt><dd>{departmentName(item.suggestedDepartment, lang) ?? t('transfers.noSuggestion')}</dd>
              {item.report.address && (<><dt>{t('detail.address')}</dt><dd>{item.report.address}</dd></>)}
              {item.status !== 'PENDING' && (
                <>
                  <dt>{t('transfers.decision')}</dt>
                  <dd>
                    {item.status === 'APPROVED' ? t('transfers.movedTo', { sector: departmentName(item.toDepartment, lang) ?? '—' }) : t('transfers.kept')}
                    {item.decidedBy ? ` · ${item.decidedBy.name}` : ''} · {formatDate(item.decidedAt, lang, true)}
                    {item.decisionNote && <div className="small muted">“{item.decisionNote}”</div>}
                  </dd>
                </>
              )}
            </dl>
            {admin && item.status === 'PENDING' && (
              <TransferDecision
                transfer={item}
                currentDepartmentId={item.fromDepartment?.id}
                onDone={(result, decision) => {
                  setNotice(decision === 'approve'
                    ? t('detail.transfer.approvedNotice', { sector: departmentName(result.toDepartment, lang) })
                    : t('detail.transfer.declinedNotice'));
                  router.refresh();
                }}
              />
            )}
            <Link href={`/admin/reports/${item.report.id}`} className="small">{t('transfers.openReport')} <Icon name="chevronRight" size={14} /></Link>
          </article>
        ))}
      </div>
      {data && <Pagination page={data.page} pages={data.pages} onChange={(p) => go({ page: p === 1 ? null : String(p) })} />}
    </div>
  );
}
