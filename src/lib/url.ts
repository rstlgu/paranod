/**
 * Helpers per costruire URL.
 */
export function buildAppUrl(pathname: string, search = '') {
  // Absolute URL passthrough
  if (/^https?:\/\//.test(pathname)) return `${pathname}${search}`;

  // Client-side: usa l'origin corrente (localhost in dev)
  if (typeof window !== 'undefined') {
    return new URL(`${pathname}${search}`, window.location.origin).toString();
  }

  // Server-side fallback: in dev puntiamo a localhost
  const base =
    (process.env.NEXT_PUBLIC_APP_URL || '').trim() ||
    (process.env.APP_URL || '').trim() ||
    (process.env.BETTER_AUTH_URL || '').trim() ||
    'http://localhost:3000';
  return new URL(`${pathname}${search}`, base).toString();
}
