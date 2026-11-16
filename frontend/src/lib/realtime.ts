import { useEffect, useRef, useState } from 'react';

export type Presence = { id: string; name: string; email: string; avatar: string; location: string };
type Listener = (data: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

// Module-level bus so any component can subscribe without prop drilling.
const listeners = new Map<string, Set<Listener>>();
let socket: WebSocket | null = null;
let lastLocation = '/';

export function subscribe(type: string, fn: Listener) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(fn);
  return () => { listeners.get(type)?.delete(fn); };
}
const publish = (type: string, data: unknown) => listeners.get(type)?.forEach(fn => fn(data));

export function sendPresence(location: string) {
  lastLocation = location;
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'presence', location }));
}

/** Keep one authenticated event socket open for the session, reconnecting with backoff. */
export function useRealtime(token: string) {
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [presence, setPresence] = useState<Presence[]>([]);
  const attempt = useRef(0);
  useEffect(() => {
    if (!token) return;
    let closed = false;
    let timer = 0;
    const connect = () => {
      setStatus('connecting');
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${protocol}://${location.host}/ws?token=${encodeURIComponent(token)}`);
      socket = ws;
      ws.onopen = () => { attempt.current = 0; setStatus('live'); ws.send(JSON.stringify({ type: 'presence', location: lastLocation })); };
      ws.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'presence') setPresence(message.data);
          publish(message.type, message.data);
          publish('*', message);
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        if (closed) return;
        setStatus('offline');
        const delay = Math.min(30_000, 1000 * 2 ** attempt.current++);
        timer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => { closed = true; window.clearTimeout(timer); socket?.close(); socket = null; };
  }, [token]);
  return { status, presence };
}

/** Subscribe to a realtime event for the lifetime of a component. */
export function useRealtimeEvent(type: string, fn: Listener) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribe(type, data => ref.current(data)), [type]);
}
