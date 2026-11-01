import { redirect } from 'next/navigation';

/**
 * Residents have no accounts any more: the public site is only for reporting
 * (anonymous, or a name and phone number on the report). Old links to the
 * account pages (/llogaria, /llogaria/hyr, /llogaria/regjistrohu) land on the home page.
 */
export default function OldAccountPages() {
  redirect('/');
}
