'use client';
/**
 * One answer of the search guide (text and its button), shown in the search
 * box at the top of the menu. Answers are plain text, rendered as text (never
 * as HTML), with the admin's line breaks kept.
 */
import Link from 'next/link';
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
