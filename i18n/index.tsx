'use client';
/** Language for client components. The choice is kept in a cookie so server-rendered pages use it too. */
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { setLanguageAction } from '@/actions/auth';
import { translator, type Lang, type Translate } from './translate';

interface I18nValue { lang: Lang; setLang: (lang: Lang) => void; t: Translate }
const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ initialLang, children }: { initialLang: Lang; children: ReactNode }) {
  const router = useRouter();
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((value: Lang) => {
    setLangState(value);
    document.documentElement.lang = value;
    void setLanguageAction(value).then(() => router.refresh());
  }, [router]);
  const t = useMemo(() => translator(lang), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
