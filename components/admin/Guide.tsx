'use client';
/**
 * Admin: the search guide. The questions and answers residents get while
 * typing in the home search box, and on the Help page. The admin adds,
 * edits, orders and hides them, and can try the search exactly as a
 * resident would (same matching code as the home page).
 */
import { useMemo, useState, type FormEvent } from 'react';
import { createGuideEntryAction, updateGuideEntryAction } from '@/actions/admin';
import Icon from '@/components/Icon';
import { GuideAnswer, guideQuestion } from '@/components/public/Guide';
import { ErrorAlert, Field, SuccessAlert } from '@/components/ui';
import { useI18n } from '@/i18n';
import { call } from '@/lib/client/action';
import type { GuideAdminRow } from '@/lib/server/services/guide';
import { GUIDE_ACTIONS, type GuideAction } from '@/lib/shared/domain';
import { guideHref, matchGuide } from '@/lib/shared/guide';
import { useAdminAction } from './useAdminAction';

type GuideForm = {
  questionSq: string; questionEn: string; answerSq: string; answerEn: string; keywords: string;
  action: GuideAction; emergency: boolean; sortOrder: string;
};

const fromRow = (r: GuideAdminRow): GuideForm => ({
  questionSq: r.questionSq, questionEn: r.questionEn, answerSq: r.answerSq, answerEn: r.answerEn, keywords: r.keywords ?? '',
  action: r.action, emergency: r.emergency, sortOrder: String(r.sortOrder),
});

function GuideFormView({ initial, suffix, busy, submitLabel, onSubmit, onCancel }: {
  initial: GuideForm; suffix: string; busy: boolean; submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const order = Number(form.sortOrder);
  const errors = {
    questionSq: form.questionSq.trim().length < 5 ? t('admin.guide.questionRule') : null,
    questionEn: form.questionEn.trim().length < 5 ? t('admin.guide.questionRule') : null,
    answerSq: form.answerSq.trim().length < 10 || form.answerSq.trim().length > 1500 ? t('admin.guide.answerRule') : null,
    answerEn: form.answerEn.trim().length < 10 || form.answerEn.trim().length > 1500 ? t('admin.guide.answerRule') : null,
    sortOrder: !Number.isInteger(order) || order < 0 || order > 9999 ? t('admin.required') : null,
  };
  const text = (field: 'questionSq' | 'questionEn' | 'answerSq' | 'answerEn' | 'keywords' | 'sortOrder') =>
    (e: { target: { value: string } }) => setForm((f) => ({ ...f, [field]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (Object.values(errors).some(Boolean)) {
      setShowErrors(true);
      return;
    }
    onSubmit({
      questionSq: form.questionSq.trim(), questionEn: form.questionEn.trim(), answerSq: form.answerSq.trim(), answerEn: form.answerEn.trim(),
      keywords: form.keywords.trim(), action: form.action, emergency: form.emergency, sortOrder: order,
    });
  }

  const id = (name: string) => `gf-${name}-${suffix}`;
  return (
    <form onSubmit={submit} noValidate>
      <div className="grid-2">
        <Field label={t('admin.guide.questionSq')} htmlFor={id('qsq')} error={showErrors ? errors.questionSq : null} required>
          <input id={id('qsq')} type="text" value={form.questionSq} maxLength={200} onChange={text('questionSq')} />
        </Field>
        <Field label={t('admin.guide.questionEn')} htmlFor={id('qen')} error={showErrors ? errors.questionEn : null} required>
          <input id={id('qen')} type="text" value={form.questionEn} maxLength={200} onChange={text('questionEn')} />
        </Field>
        <Field label={t('admin.guide.answerSq')} htmlFor={id('asq')} hint={t('admin.guide.answerHint')} error={showErrors ? errors.answerSq : null} required>
          <textarea id={id('asq')} value={form.answerSq} maxLength={1500} onChange={text('answerSq')} style={{ minHeight: 120 }} />
        </Field>
        <Field label={t('admin.guide.answerEn')} htmlFor={id('aen')} hint={t('admin.guide.answerHint')} error={showErrors ? errors.answerEn : null} required>
          <textarea id={id('aen')} value={form.answerEn} maxLength={1500} onChange={text('answerEn')} style={{ minHeight: 120 }} />
        </Field>
      </div>
      <Field label={t('admin.guide.keywords')} htmlFor={id('kw')} hint={t('admin.guide.keywordsHint')}>
        <textarea id={id('kw')} value={form.keywords} maxLength={500} onChange={text('keywords')} style={{ minHeight: 60 }} />
      </Field>
      <div className="grid-2">
        <Field label={t('admin.guide.action')} htmlFor={id('action')}>
          <select id={id('action')} value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as GuideAction })}>
            {GUIDE_ACTIONS.map((a) => (
              <option key={a} value={a}>{t(`guide.actions.${a.toLowerCase()}`)}{guideHref(a) ? ` · ${guideHref(a)}` : ''}</option>
            ))}
          </select>
        </Field>
        <Field label={t('admin.guide.sortOrder')} htmlFor={id('order')} hint={t('admin.guide.sortHint')} error={showErrors ? errors.sortOrder : null}>
          <input id={id('order')} type="number" min={0} max={9999} step={1} value={form.sortOrder} onChange={text('sortOrder')} />
        </Field>
      </div>
      <label className="check" htmlFor={id('emergency')}>
        <input id={id('emergency')} type="checkbox" checked={form.emergency} onChange={(e) => setForm({ ...form, emergency: e.target.checked })} />
        <span><strong>{t('admin.guide.emergency')}</strong> <span className="muted small">{t('admin.guide.emergencyHint')}</span></span>
      </label>
      <div className="row" style={{ marginTop: 16 }}>
        <button type="submit" className="btn" disabled={busy}>{busy ? t('common.wait') : submitLabel}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function TrySearch({ items }: { items: GuideAdminRow[] }) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const active = useMemo(() => items.filter((i) => i.active), [items]);
  const hits = query.trim().length >= 2 ? matchGuide(active, query) : [];
  return (
    <section className="card">
      <h2 className="card-title">{t('admin.guide.test')}</h2>
      <p className="muted small" style={{ marginTop: 0 }}>{t('admin.guide.testHint')}</p>
      <input type="search" value={query} maxLength={100} placeholder={t('admin.guide.testPlaceholder')} aria-label={t('admin.guide.test')} onChange={(e) => setQuery(e.target.value)} />
      {query.trim().length >= 2 && (
        hits.length === 0 ? <p className="muted small">{t('admin.guide.testNone')}</p> : (
          <ol className="guide-try">
            {hits.map(({ item }) => <li key={item.id} className={item.emergency ? 'emergency' : undefined}>{guideQuestion(item, lang)}</li>)}
          </ol>
        )
      )}
    </section>
  );
}

const EMPTY: GuideForm = { questionSq: '', questionEn: '', answerSq: '', answerEn: '', keywords: '', action: 'NONE', emergency: false, sortOrder: '' };

export default function Guide({ items }: { items: GuideAdminRow[] }) {
  const { t, lang } = useI18n();
  const { busy, error, notice, run } = useAdminAction();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  // The same rule as the home page: the first 4 active questions that are not emergencies.
  const chips = new Set(items.filter((i) => i.active && !i.emergency).slice(0, 4).map((i) => i.id));
  const nextOrder = String(Math.min(9999, Math.max(0, ...items.map((i) => i.sortOrder)) + 10));

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1>{t('admin.guide.title')}</h1>
          <p className="muted" style={{ margin: 0 }}>{t('admin.guide.intro')}</p>
        </div>
        <div className="row">
          <a href="/ndihme" target="_blank" rel="noreferrer" className="btn btn-outline"><Icon name="external" size={16} />{t('admin.guide.viewPublic')}</a>
          {!adding && <button type="button" className="btn" onClick={() => { setAdding(true); setEditing(null); }}><Icon name="plus" size={16} />{t('admin.guide.add')}</button>}
        </div>
      </div>
      <SuccessAlert>{notice}</SuccessAlert>
      <ErrorAlert error={error} />
      <TrySearch items={items} />
      {adding && (
        <section className="card">
          <h2 className="card-title">{t('admin.guide.add')}</h2>
          <GuideFormView
            initial={{ ...EMPTY, sortOrder: nextOrder }} suffix="new" busy={busy} submitLabel={t('admin.guide.create')} onCancel={() => setAdding(false)}
            onSubmit={async (body) => {
              if (await run(() => call(createGuideEntryAction(body)), t('admin.guide.created'))) setAdding(false);
            }}
          />
        </section>
      )}
      {items.map((item) => (
        <article key={item.id} className={`card guide-card${item.active ? '' : ' inactive'}${item.emergency ? ' emergency' : ''}`}>
          {editing === item.id ? (
            <GuideFormView
              initial={fromRow(item)} suffix={String(item.id)} busy={busy} submitLabel={t('common.save')} onCancel={() => setEditing(null)}
              onSubmit={async (body) => {
                if (await run(() => call(updateGuideEntryAction(item.id, body)), t('admin.guide.saved'))) setEditing(null);
              }}
            />
          ) : (
            <>
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <h2 className="guide-question">
                    {item.emergency && <Icon name="alert" size={18} />}{guideQuestion(item, lang)}
                  </h2>
                  <div className="small muted">{lang === 'en' ? item.questionSq : item.questionEn} · {t('admin.guide.sortOrder')}: {item.sortOrder}</div>
                </div>
                <div className="row">
                  {item.emergency && <span className="badge badge-overdue">{t('admin.guide.emergency')}</span>}
                  {chips.has(item.id) && <span className="badge status-open">{t('admin.guide.chip')}</span>}
                  {!item.active && <span className="badge badge-muted">{t('admin.inactive')}</span>}
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => { setEditing(item.id); setAdding(false); }}><Icon name="edit" size={14} />{t('common.edit')}</button>
                  <button
                    type="button" className="btn btn-sm btn-ghost" disabled={busy}
                    onClick={() => run(() => call(updateGuideEntryAction(item.id, { active: !item.active })), item.active ? t('admin.guide.deactivated') : t('admin.guide.activated'))}
                  >
                    {item.active ? t('admin.deactivate') : t('admin.activate')}
                  </button>
                </div>
              </div>
              <GuideAnswer item={item} />
              {item.keywords && <p className="small muted" style={{ margin: '8px 0 0' }}><strong>{t('admin.guide.keywords')}:</strong> {item.keywords}</p>}
            </>
          )}
        </article>
      ))}
    </div>
  );
}
