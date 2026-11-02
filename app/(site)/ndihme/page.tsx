import { redirect } from 'next/navigation';

/**
 * The Help page was removed: the questions are answered in the help chat (bottom right) on
 * the top of the menu, on every page. Old links land on the home page.
 */
export default function Help() {
  redirect('/');
}
