'use client';
/**
 * The search guide for residents: one answer (text and its button), and the
 * Help page (/ndihme) with every question. Answers are plain text, rendered
 * as text (never as HTML), with the admin's line breaks kept.
 */
import Link from 'next/link';
import { useEffect } from 'react';
import Icon from '@/components/Icon';
import { useI18n } from '@/i18n';
import { guideHref, type GuideItem } from '@/lib/shared/guide';

export function guideQuestion(item: GuideItem, lang: string): string {
  return lang === 'en' ? item.questionEn : item.questionSq;
}

export function GuideAnswer({ item, onNavigate }: { item: GuideItem; onNavigate?: () => void }) {
  const { t, lang } = useI18n();
  const href = guideHref(item.action);
  const label = t(`guide.actions.${item.action.toLowerCase()}`);
  return (
    <div className="guide-answer">
      <p>{lang === 'en' ? item.answerEn : item.answerSq}</p>
      {href && (href.startsWith('tel:') ? (
        <a href={href} className="btn btn-sm btn-danger"><Icon name="phone" size={14} />{label}</a>
      ) : (
        <Link href={href} className="btn btn-sm" onClick={onNavigate}>{label}<Icon name="arrowRight" size={14} /></Link>
      ))}
    </div>
  );
}

export default function HelpPage({ items }: { items: GuideItem[] | null }) {
  const { t, lang } = useI18n();
  const emergencies = (items ?? []).filter((i) => i.emergency);
  const questions = (items ?? []).filter((i) => !i.emergency);
  // A link such as /ndihme#q-12 (from the search box) opens that question.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    const el = target ? document.getElementById(target) : null;
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
      el.scrollIntoView({ block: 'center' });
    }
  }, []);
  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <h1>{t('guide.title')}</h1>
        <p>{t('guide.intro')}</p>
        {items === null && <div className="alert alert-error" role="alert">{t('errors.generic')}</div>}
        {items && items.length === 0 && <p className="muted">{t('guide.empty')}</p>}
        {emergencies.map((item) => (
          <section key={item.id} id={`q-${item.id}`} className="guide-emergency" aria-labelledby={`q-${item.id}-title`}>
            <h2 id={`q-${item.id}-title`}><Icon name="alert" size={20} />{guideQuestion(item, lang)}</h2>
            <GuideAnswer item={item} />
          </section>
        ))}
        <div className="faq-list">
          {questions.map((item) => (
            <details key={item.id} id={`q-${item.id}`}>
              <summary>{guideQuestion(item, lang)}</summary>
              <GuideAnswer item={item} />
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
