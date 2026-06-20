/**
 * Reads the Descope session token from the `ds` cookie (client-side only).
 */
export function getToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|; )ds=([^;]*)/);
  return match != null && match[1] != null ? decodeURIComponent(match[1]) : '';
}
