/** The visitor's language on the server (from the er_lang cookie). */
import 'server-only';
import { cookies } from 'next/headers';
import { LANG_COOKIE, normaliseLang, translator, type Lang, type Translate } from './translate';

export async function getLang(): Promise<Lang> {
  return normaliseLang((await cookies()).get(LANG_COOKIE)?.value);
}

export async function getT(): Promise<{ lang: Lang; t: Translate }> {
  const lang = await getLang();
  return { lang, t: translator(lang) };
}
