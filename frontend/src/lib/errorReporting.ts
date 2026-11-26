// Sends uncaught browser errors to the API (/api/client-errors), which logs them and, when
// ALERT_WEBHOOK_URL is configured, alerts the team. Deduplicated and capped per page load so a
// render loop cannot flood the server. Only the message, source location and path are sent.

const seen = new Set<string>();
let sent = 0;
const MAX_PER_LOAD = 10;

function report(message: string, source = '') {
  const text = message.trim().slice(0, 500);
  if (!text || sent >= MAX_PER_LOAD) return;
  // Errors thrown by browser extensions or cross-origin scripts carry no useful detail.
  if (/^Script error\.?$/.test(text) || /extension:\/\//.test(source)) return;
  const key = `${text}|${source}`;
  if (seen.has(key)) return;
  seen.add(key); sent++;
  const body = JSON.stringify({ message: text, source: source.slice(0, 300), page: location.pathname.replace(/\/share\/[^/]+/, '/share/…').slice(0, 200) });
  try {
    if (navigator.sendBeacon?.('/api/client-errors', new Blob([body], { type: 'application/json' }))) return;
  } catch { /* fall back to fetch */ }
  fetch('/api/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zynckle-Request': '1' }, body, keepalive: true }).catch(() => {});
}

export function installErrorReporting() {
  window.addEventListener('error', event => {
    const where = event.filename ? `${event.filename.replace(location.origin, '')}:${event.lineno}:${event.colno}` : '';
    report(event.message || String(event.error || 'Unknown error'), where);
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    // Network failures and expected API errors are already shown to the user.
    if (reason && typeof reason === 'object' && 'status' in reason) return;
    report(reason instanceof Error ? `${reason.name}: ${reason.message}` : `Unhandled rejection: ${String(reason)}`, reason instanceof Error ? (reason.stack || '').split('\n')[1]?.trim() || '' : '');
  });
}

/** For React error boundaries. */
export const reportError = (error: unknown, where = 'react') => report(error instanceof Error ? `${error.name}: ${error.message}` : String(error), where);
