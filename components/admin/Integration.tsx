'use client';
/**
 * Ready-to-copy code for the municipality's IT team (elbasani.gov.al), and the
 * state of the AI connection (photo check and report check) with a test button.
 */
import { useState } from 'react';
import { testAiAction } from '@/actions/admin';
import Icon from '@/components/Icon';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';

export interface AiSummary { enabled: boolean; enabledFlag: boolean; hasKey: boolean; model: string; host: string }
export interface AiUsage { calls: number; costUsd: number; budgetUsd: number; reached: boolean }

const usd = (n: number) => (n > 0 && n < 0.01 ? '< $0.01' : `$${n < 10 ? n.toFixed(2) : Math.round(n)}`);

/** This month's AI use against the monthly limit (AI_MONTHLY_BUDGET_USD). */
function AiBudget({ usage }: { usage: AiUsage }) {
  const { t } = useI18n();
  const share = usage.budgetUsd > 0 ? Math.min(1, usage.costUsd / usage.budgetUsd) : 0;
  return (
    <div className="ai-budget">
      <p style={{ margin: 0 }}>
        <strong>{t('admin.integration.budget.month')}</strong>{' '}
        {usage.budgetUsd > 0
          ? t('admin.integration.budget.used', { calls: usage.calls, cost: usd(usage.costUsd), budget: usd(usage.budgetUsd) })
          : t('admin.integration.budget.noLimit', { calls: usage.calls, cost: usd(usage.costUsd) })}
      </p>
      {usage.budgetUsd > 0 && (
        <div className={`ai-budget-bar${share >= 0.8 ? ' high' : ''}`} role="img" aria-label={`${Math.round(share * 100)}%`}><span style={{ width: `${share * 100}%` }} /></div>
      )}
      <p className="small muted" style={{ margin: 0 }}>{t('admin.integration.budget.hint')}</p>
      {usage.reached && <div className="alert alert-warn" role="alert" style={{ margin: 0 }}>{t('admin.integration.budget.reached')}</div>}
    </div>
  );
}

/** Whether the AI is on, and one click to see whether it really answers (and why not). */
function AiConnection({ ai, usage }: { ai: AiSummary; usage: AiUsage }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; problem?: string; detail?: string } | null>(null);
  async function test() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await call(testAiAction()));
    } catch (err) {
      setResult({ ok: false, problem: 'other', detail: err instanceof ActionFailure ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }
  const missing = !ai.enabledFlag ? 'AI_ENABLED=true' : !ai.hasKey ? 'AI_API_KEY' : null;
  return (
    <section className="card stack">
      <h2 className="card-title">{t('admin.integration.aiTitle')}</h2>
      <p className="muted" style={{ margin: 0 }}>{t('admin.integration.aiText')}</p>
      {ai.enabled
        ? <p style={{ margin: 0 }}><span className="badge status-open">{t('admin.integration.aiOn')}</span> <span className="small muted">{t('admin.integration.aiModel', { model: ai.model, host: ai.host })}</span></p>
        : <div className="alert alert-warn" style={{ margin: 0 }}>{t('admin.integration.aiOff', { missing: missing ?? '' })}</div>}
      {ai.enabled && <AiBudget usage={usage} />}
      <div>
        <button type="button" className="btn btn-outline" onClick={test} disabled={busy || !ai.enabled}>
          <Icon name="refresh" size={16} />{busy ? t('common.wait') : t('admin.integration.aiTest')}
        </button>
      </div>
      {result?.ok && <div className="alert alert-ok" role="status" style={{ margin: 0 }}>{t('admin.integration.aiWorks')}</div>}
      {result && !result.ok && (
        <div className="alert alert-error" role="alert" style={{ margin: 0 }}>
          <strong>{t(`admin.integration.aiProblems.${result.problem ?? 'other'}`)}</strong>
          {result.detail && <div className="small" style={{ marginTop: 6, wordBreak: 'break-word' }}>{result.detail}</div>}
        </div>
      )}
    </section>
  );
}

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

export default function Integration({ origin, ai, usage }: { origin: string; ai: AiSummary; usage: AiUsage }) {
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
      <AiConnection ai={ai} usage={usage} />
      <section className="card">
        <h2 className="card-title">{t('admin.integration.preview')}</h2>
        <iframe src="/embed" title={t('admin.integration.preview')} style={{ width: '100%', minHeight: 640, border: '1px solid var(--line)', borderRadius: 4 }} />
      </section>
    </div>
  );
}
