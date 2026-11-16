// Thin fetch wrapper shared by every module. The session token lives in localStorage
// (set by App on sign-in); provider secrets never reach the browser.
export const getToken = () => localStorage.getItem('zynckle-token') || '';

export class ApiError extends Error {
  constructor(message: string, public status: number, public data: Record<string, unknown> = {}) { super(message); }
}

type Options = { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string>; signal?: AbortSignal };

export async function api<T = unknown>(path: string, { method, body, raw, headers = {}, signal }: Options = {}): Promise<T> {
  const token = getToken();
  let response: Response;
  try {
    response = await fetch(path, {
      method: method || (body !== undefined || raw !== undefined ? 'POST' : 'GET'),
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError('The workspace API is unreachable. Check that the backend is running.', 0);
  }
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json().catch(() => ({})) : null;
  if (!response.ok) {
    if (response.status === 401 && token && path !== '/api/auth/login') window.dispatchEvent(new CustomEvent('zynckle:session-expired'));
    throw new ApiError((data && (data as { error?: string }).error) || `Request failed (${response.status})`, response.status, data || {});
  }
  return (data ?? (await response.blob())) as T;
}

export const errorMessage = (error: unknown, fallback = 'Something went wrong') => (error instanceof Error && error.message ? error.message : fallback);

/** Upload a raw body with progress reporting (fetch has no upload progress). */
export function uploadWithProgress<T>(path: string, file: Blob, headers: Record<string, string>, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(String(data.error || `Upload failed (${xhr.status})`), xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed — the API is unreachable', 0));
    xhr.send(file);
  });
}

export type StreamMeta = { conversationId: string | null; provider: string; providerId: string; model: string; sources: { type: string; id: string; label: string }[]; mode: string; section?: string | null };

/** POST to the SSE endpoint and surface meta / delta / done / error frames. */
export async function streamAI(body: Record<string, unknown>, handlers: { onMeta?: (meta: StreamMeta) => void; onDelta: (text: string) => void; signal?: AbortSignal }): Promise<{ messageId: string | null }> {
  const response = await fetch('/api/ai/stream', {
    method: 'POST', signal: handlers.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
  }).catch(error => { if (error.name === 'AbortError') throw error; throw new ApiError('The workspace API is unreachable', 0); });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data.error || `AI request failed (${response.status})`, response.status, data);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = { messageId: null as string | null };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = frame.match(/^event: (.+)$/m)?.[1];
      const raw = frame.match(/^data: (.+)$/m)?.[1];
      if (!event || !raw) continue;
      const data = JSON.parse(raw);
      if (event === 'meta') handlers.onMeta?.(data);
      else if (event === 'delta') handlers.onDelta(data.text);
      else if (event === 'done') result = data;
      else if (event === 'error') throw new ApiError(data.error, data.status || 502);
    }
  }
  return result;
}

export const formatBytes = (size: number) => size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : size < 1073741824 ? `${(size / 1048576).toFixed(1)} MB` : `${(size / 1073741824).toFixed(2)} GB`;

export function timeAgo(value: string | number | Date) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const units: [number, string][] = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [604800, 'week'], [2629800, 'month'], [31557600, 'year']];
  let label = `${Math.round(seconds / 60)}m ago`;
  for (let i = units.length - 1; i >= 0; i--) {
    if (seconds >= units[i][0]) { const n = Math.round(seconds / units[i][0]); label = `${n} ${units[i][1]}${n === 1 ? '' : 's'} ago`; break; }
  }
  return label;
}

/** Calendar date (YYYY-MM-DD) in the viewer's local time zone — never UTC. */
export const localDate = (value: Date | string | number = new Date()) => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export type Member = { id: string; name: string; email: string; avatar: string; role?: string; title?: string };
