// Desktop notifications for workspace events (mentions, assignments, invites, due dates).
// They use the browser Notification API and fire while Zynckle is open in some tab but you are
// looking elsewhere. (Notifying a fully closed browser would need Web Push and a push service.)

const KEY = 'zynckle-desktop-notifications';

export const desktopSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export function desktopEnabled() {
  try { return desktopSupported() && Notification.permission === 'granted' && localStorage.getItem(KEY) === 'on'; } catch { return false; }
}

/** Ask for permission (must run from a click) and remember the choice. Returns the resulting state. */
export async function setDesktopNotifications(on: boolean): Promise<'on' | 'off' | 'denied' | 'unsupported'> {
  if (!desktopSupported()) return 'unsupported';
  if (!on) { try { localStorage.setItem(KEY, 'off'); } catch { /* ignore */ } return 'off'; }
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return 'denied';
  try { localStorage.setItem(KEY, 'on'); } catch { /* ignore */ }
  return 'on';
}

/** Show a notification when the page is in the background; clicking it focuses the tab and opens the link. */
export function desktopNotify(n: { id?: string; title: string; body?: string; link?: string | null }, open: (path: string) => void) {
  if (!desktopEnabled() || document.visibilityState === 'visible') return;
  try {
    const note = new Notification(n.title, { body: n.body || '', tag: n.id || n.title });
    note.onclick = () => { window.focus(); if (n.link) open(n.link); note.close(); };
  } catch { /* some browsers only allow notifications from a service worker */ }
}
