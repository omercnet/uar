export function getToken(): string {
  if (typeof document === 'undefined') return '';
  const cookie = document.cookie;
  const match = cookie.match(/(?:^|;\s*)DS=([^;]*)/) ?? cookie.match(/(?:^|;\s*)ds=([^;]*)/);
  return match != null && match[1] != null ? decodeURIComponent(match[1]) : '';
}
