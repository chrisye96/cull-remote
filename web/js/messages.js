import { t, hasText } from './i18n.js';

// The text for an error code from the server or the page; unknown codes get a general one.
export const messageFor = (code) => (hasText(`error.${code}`) ? t(`error.${code}`) : t('error.generic'));

// Text of the top status bar. `code` is '' while everything is reachable. With marks
// waiting, the bar says how many instead of how to fix the connection.
export function statusLine(code, pendingCount) {
  if (!code) return '';
  if (pendingCount > 0) return t('status.waiting', { status: hasText(`status.${code}`) ? t(`status.${code}`) : messageFor(code), n: pendingCount });
  return messageFor(code);
}
