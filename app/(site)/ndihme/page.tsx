import { redirect } from 'next/navigation';

/**
 * The Help page was removed: the questions are answered in the search box at
 * the top of the menu, on every page. Old links land on the home page.
 */
export default function Help() {
  redirect('/');
}
