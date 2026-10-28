'use client';
/** Ready-to-copy code for the municipality's IT team (elbasani.gov.al). */
import { useState } from 'react';
import { useI18n } from '@/i18n';

function CopyBlock({ code }: { code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <pre className="code">{code}</pre>
      <button type="button" className="btn btn-sm btn-outline" onClick={() => navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {})}>
        {copied ? t('admin.copied') : t('admin.integration.copy')}
      </button>
    </div>
  );
}

export default function Integration({ origin }: { origin: string }) {
  const { t } = useI18n();
  const iframe = `<iframe src="${origin}/embed" title="Elbasani Raporton" style="width:100%;min-height:900px;border:0" loading="lazy" allow="geolocation; camera"></iframe>`;
  const button = `<a href="${origin}/raporto" target="_blank" rel="noopener"
   style="display:inline-block;background:#067A06;color:#fff;padding:14px 22px;border-radius:4px;font-family:Montserrat,Arial,sans-serif;font-weight:700;text-transform:uppercase;text-decoration:none">
  Raporto një problem
</a>`;
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <h1>{t('admin.integration.title')}</h1>
      <p>{t('admin.integration.intro')}</p>
      <section className="card stack">
        <h2 className="card-title">{t('admin.integration.option1')}</h2>
        <p className="muted">{t('admin.integration.option1Text')}</p>
        <CopyBlock code={button} />
      </section>
      <section className="card stack">
        <h2 className="card-title">{t('admin.integration.option2')}</h2>
        <p className="muted">{t('admin.integration.option2Text')}</p>
        <CopyBlock code={iframe} />
        <div className="alert alert-info small">{t('admin.integration.headerNote')}</div>
      </section>
      <section className="card stack">
        <h2 className="card-title">{t('admin.integration.option3')}</h2>
        <p className="muted">{t('admin.integration.option3Text')}</p>
      </section>
      <section className="card">
        <h2 className="card-title">{t('admin.integration.preview')}</h2>
        <iframe src="/embed" title={t('admin.integration.preview')} style={{ width: '100%', minHeight: 640, border: '1px solid var(--line)', borderRadius: 4 }} />
      </section>
    </div>
  );
}
