'use client';
/** Every email the system wrote. While MAIL_DRIVER=log, this is where you read them. */
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useState, useTransition } from 'react';
import { Pagination } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDate, key } from '@/lib/client/format';
import type { EmailLogItem } from '@/lib/server/services/admin';
import type { Paged } from '@/lib/shared/types';

export default function EmailLog({ data, q }: { data: Paged<EmailLogItem>; q: string }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [loading, startTransition] = useTransition();
  const [search, setSearch] = useState(q);
  const [open, setOpen] = useState<string | null>(null);

  function go(next: { q?: string; page?: number }) {
    const params = new URLSearchParams();
    const query = next.q ?? q;
    if (query) params.set('q', query);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div className="stack">
      <h1>{t('panel.nav.emails')}</h1>
      <p className="muted">{t('admin.emails.intro')}</p>
      <form className="search-inline" role="search" onSubmit={(e) => { e.preventDefault(); go({ q: search.trim(), page: 1 }); }}>
        <label htmlFor="el-q" className="sr-only">{t('reports.search')}</label>
        <input id="el-q" type="search" value={search} maxLength={100} placeholder={t('admin.emails.searchPlaceholder')} onChange={(e) => setSearch(e.target.value)} />
        <button type="submit" className="btn btn-sm btn-outline">{t('reports.search')}</button>
      </form>
      <div className={`table-wrap${loading ? ' refreshing' : ''}`} aria-busy={loading}>
        <table className="table">
          <thead><tr><th scope="col">{t('admin.emails.date')}</th><th scope="col">{t('admin.emails.to')}</th><th scope="col">{t('admin.emails.subject')}</th><th scope="col">{t('admin.emails.status')}</th></tr></thead>
          <tbody>
            {data.items.length === 0 && <tr><td colSpan={4} className="muted">{t('admin.emails.empty')}</td></tr>}
            {data.items.map((m) => (
              <Fragment key={m.id}>
                <tr className="clickable" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                  <td>{formatDate(m.createdAt, lang, true)}</td><td>{m.toAddress}</td><td>{m.subject}</td>
                  <td>
                    <span className={`badge ${m.status === 'SENT' || m.status === 'LOGGED' ? 'status-closed' : m.status === 'FAILED' ? 'status-rejected' : 'status-received'}`}>
                      {t(`admin.emails.statuses.${key(m.status)}`)}
                    </span>
                  </td>
                </tr>
                {open === m.id && <tr><td colSpan={4}><pre className="code light">{m.bodyText}</pre>{m.error && <div className="alert alert-error">{m.error}</div>}</td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={data.page} pages={data.pages} onChange={(p) => go({ page: p })} />
    </div>
  );
}
