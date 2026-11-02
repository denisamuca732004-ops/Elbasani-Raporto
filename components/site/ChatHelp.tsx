'use client';
/**
 * Help as a chat window, on every page of the public site: a round button at
 * the bottom right opens it. It replaces the search box of the menu and
 * answers the same four kinds of message, instantly and without AI:
 *  - a question ("si raportoj", "sa zgjat") → the answer of the guide the admin
 *    manages, with its button; emergencies ("zjarr") show the numbers first;
 *  - a report number (EL-2026-00042)       → a link to its progress;
 *  - a problem ("gropë")                   → its category, where the report starts
 *    (reports start only from a category);
 *  - a street or area ("Rinia")            → the OPEN reports there, so a problem
 *    is not reported twice.
 * The common questions are offered as buttons when the window opens, and again
 * when nothing was found.
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { searchOpenReportsAction } from '@/actions/reports';
import Icon from '@/components/Icon';
import { useCatalog, type TypeWithCategory } from '@/components/providers';
import { GuideAnswer, guideQuestion } from '@/components/public/Guide';
import { CategoryIcon, StatusBadge, TestBadge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { call } from '@/lib/client/action';
import { typeName } from '@/lib/client/format';
import { commonQuestions, matchGuide, matchTypes, type GuideItem } from '@/lib/shared/guide';
import type { PublicCard } from '@/lib/shared/types';

const CASE_RE = /^[A-Z]{1,6}-\d{4}-\d{5,}$/;
const CASE_START = /^[A-Z]{1,6}-\d/;

interface Reply {
  caseNumber: string | null;
  partialCase: boolean;
  emergencies: GuideItem[];
  answers: GuideItem[];
  types: TypeWithCategory[];
  places: PublicCard[] | null;
  searching: boolean;
}
type NewMessage =
  | { from: 'user'; text: string }
  | { from: 'bot'; kind: 'welcome' }
  | { from: 'bot'; kind: 'answer'; item: GuideItem }
  | { from: 'bot'; kind: 'reply'; reply: Reply };
type Message = NewMessage & { id: number };

export default function ChatHelp({ guide }: { guide: GuideItem[] }) {
  const { t, lang } = useI18n();
  const { types } = useCatalog();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Message[]>([{ id: 0, from: 'bot', kind: 'welcome' }]);
  const [showAll, setShowAll] = useState(false);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const common = useMemo(() => commonQuestions(guide), [guide]);
  const allQuestions = useMemo(() => guide.filter((g) => !g.emergency), [guide]);
  const urgent = useMemo(() => guide.filter((g) => g.emergency), [guide]);
  const chips = [...(showAll ? allQuestions : common), ...urgent];

  // Opened: the cursor in the field. Each new message: scrolled into view.
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, open]);

  function close() {
    setOpen(false);
    fabRef.current?.focus();
  }

  function add(...items: NewMessage[]): number[] {
    const ids = items.map(() => nextId.current++);
    setMessages((m) => [...m, ...items.map((item, i) => ({ ...item, id: ids[i]! }))]);
    return ids;
  }

  /** A common question pressed: the question as the resident's message, the answer under it. */
  function ask(item: GuideItem) {
    add({ from: 'user', text: guideQuestion(item, lang) }, { from: 'bot', kind: 'answer', item });
  }

  function send(e: FormEvent) {
    e.preventDefault();
    const typed = text.trim();
    if (!typed) return;
    setText('');
    const compact = typed.toUpperCase().replace(/\s+/g, '');
    const looksLikeCase = CASE_START.test(compact);
    const found = looksLikeCase ? [] : matchGuide(guide, typed).map((m) => m.item);
    const typeHits = looksLikeCase ? [] : matchTypes(types, typed).slice(0, 3);
    const search = !looksLikeCase && typed.length >= 3;
    const reply: Reply = {
      caseNumber: CASE_RE.test(compact) ? compact : null,
      partialCase: looksLikeCase && !CASE_RE.test(compact),
      emergencies: found.filter((a) => a.emergency),
      answers: found.filter((a) => !a.emergency).slice(0, typeHits.length ? 1 : 2),
      types: typeHits,
      places: null,
      searching: search,
    };
    const [, replyId] = add({ from: 'user', text: typed }, { from: 'bot', kind: 'reply', reply });
    if (!search) return;
    const update = (places: PublicCard[]) => setMessages((m) => m.map((msg) => (
      msg.id === replyId && msg.from === 'bot' && msg.kind === 'reply' ? { ...msg, reply: { ...msg.reply, places, searching: false } } : msg
    )));
    call(searchOpenReportsAction({ q: typed })).then(update).catch(() => update([]));
  }

  const chipList = (
    <div className="chat-chips">
      {chips.map((item) => (
        <button key={item.id} type="button" className={item.emergency ? 'urgent' : undefined} onClick={() => ask(item)}>
          {item.emergency && <Icon name="alert" size={14} />}{guideQuestion(item, lang)}
        </button>
      ))}
      {!showAll && allQuestions.length > common.length && (
        <button type="button" className="more" onClick={() => setShowAll(true)}>{t('chat.more', { n: allQuestions.length })}</button>
      )}
    </div>
  );

  function renderReply(r: Reply) {
    const nothing = !r.caseNumber && !r.partialCase && !r.emergencies.length && !r.answers.length && !r.types.length && !r.searching && !(r.places?.length);
    return (
      <>
        {r.caseNumber && (
          <Link href={`/ndiq/${r.caseNumber}`} className="btn btn-sm" onClick={close}><Icon name="search" size={14} />{t('chat.openCase', { n: r.caseNumber })}</Link>
        )}
        {r.partialCase && <p>{t('chat.caseHint')}</p>}
        {r.emergencies.map((item) => (
          <div key={item.id} className="chat-urgent">
            <strong><Icon name="alert" size={16} /> {guideQuestion(item, lang)}</strong>
            <GuideAnswer item={item} onNavigate={close} />
          </div>
        ))}
        {r.answers.map((item) => (
          <div key={item.id} className="chat-answer">
            <strong>{guideQuestion(item, lang)}</strong>
            <GuideAnswer item={item} onNavigate={close} />
          </div>
        ))}
        {r.types.length > 0 && (
          <div>
            <p>{t('chat.report')}</p>
            <ul className="chat-links">
              {r.types.map((ty) => (
                <li key={ty.id}>
                  <Link href={`/raporto?kategoria=${ty.category.code}`} onClick={close}>
                    <CategoryIcon icon={ty.category.icon} size={20} />
                    <span><strong>{lang === 'en' ? ty.category.nameEn : ty.category.nameSq}</strong> · {lang === 'en' ? ty.nameEn : ty.nameSq}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {r.searching && <p className="muted small">{t('chat.searching')}</p>}
        {r.places && r.places.length > 0 && (
          <div>
            <p>{t('chat.open')}</p>
            <ul className="chat-links">
              {r.places.slice(0, 5).map((c) => (
                <li key={c.caseNumber}>
                  <Link href={`/ndiq/${c.caseNumber}`} onClick={close}>
                    <span>
                      <span className="case-number">{c.caseNumber}</span> · <strong>{typeName(c.type, lang)}</strong>
                      <span className="where">{[c.address, c.neighbourhood].filter(Boolean).join(' · ') || '–'}</span>
                    </span>
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><TestBadge show={c.isTest} /><StatusBadge status={c.publicStatus} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {nothing && (
          <>
            <p>{t('chat.nothing')}</p>
            {chipList}
          </>
        )}
      </>
    );
  }

  if (!open) {
    return (
      <button ref={fabRef} type="button" className="chat-fab" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="chat" size={24} /><span>{t('chat.button')}</span>
      </button>
    );
  }

  return (
    <div className="chat-panel" role="dialog" aria-modal="false" aria-labelledby="chat-title" onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <div className="chat-head">
        <Icon name="chat" size={22} />
        <strong id="chat-title">{t('chat.title')}</strong>
        <button type="button" onClick={close} aria-label={t('common.close')}><Icon name="close" size={22} /></button>
      </div>
      <div className="chat-log" aria-live="polite">
        {messages.map((m) => (
          m.from === 'user'
            ? <div key={m.id} className="chat-msg user">{m.text}</div>
            : (
              <div key={m.id} className="chat-msg bot">
                {m.kind === 'welcome' && (<><p>{t('chat.welcome')}</p>{chipList}</>)}
                {m.kind === 'answer' && <GuideAnswer item={m.item} onNavigate={close} />}
                {m.kind === 'reply' && renderReply(m.reply)}
              </div>
            )
        ))}
        <div ref={endRef} />
      </div>
      <form className="chat-form" onSubmit={send}>
        <label htmlFor="chat-input" className="sr-only">{t('chat.placeholder')}</label>
        <input id="chat-input" ref={inputRef} type="text" autoComplete="off" maxLength={100} placeholder={t('chat.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" aria-label={t('chat.send')} disabled={!text.trim()}><Icon name="send" size={20} /></button>
      </form>
      <p className="chat-note">{t('chat.note')}</p>
    </div>
  );
}
