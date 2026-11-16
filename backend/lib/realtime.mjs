import { WebSocketServer } from 'ws';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { config } from './config.mjs';
import { db } from './store.mjs';
import { sessionFor, membership, onEvent, publicUser } from './core.mjs';

const ydocDir = join(config.dataDir, 'ydocs');
await mkdir(ydocDir, { recursive: true });

// ---- Workspace event channel (/ws) ---------------------------------------------
const eventClients = new Set();

function presenceFor(workspaceId) {
  const seen = new Map();
  for (const client of eventClients) {
    if (client.workspaceId !== workspaceId) continue;
    seen.set(client.user.id, { ...publicUser(client.user), location: client.location || '/' });
  }
  return [...seen.values()];
}
function broadcastPresence(workspaceId) {
  const payload = JSON.stringify({ type: 'presence', data: presenceFor(workspaceId) });
  for (const client of eventClients) if (client.workspaceId === workspaceId) client.socket.send(payload);
}

/** Route domain events to the sockets allowed to see them. */
onEvent(event => {
  const payload = JSON.stringify({ type: event.type, data: event.data });
  for (const client of eventClients) {
    if (client.socket.readyState !== 1) continue;
    if (event.userId) { if (client.user.id === event.userId) client.socket.send(payload); continue; }
    if (client.workspaceId !== event.workspaceId || !membership(client.user.id, event.workspaceId)) continue;
    if (event.audience && !event.audience.includes(client.user.id)) continue;
    client.socket.send(payload);
  }
  if (event.type === 'document.deleted') closeRoom(event.data.id, true);
});

// ---- Collaborative documents (/collab/:id) using the y-websocket protocol -----
const messageSync = 0;
const messageAwareness = 1;
const rooms = new Map();

async function getRoom(docId) {
  if (rooms.has(docId)) return rooms.get(docId);
  const pending = (async () => {
    const doc = new Y.Doc();
    try { Y.applyUpdate(doc, await readFile(join(ydocDir, `${docId}.bin`))); } catch { /* new document */ }
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);
    const room = { docId, doc, awareness, conns: new Map(), timer: null };
    doc.on('update', (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      for (const conn of room.conns.keys()) if (conn !== origin) sendBinary(room, conn, message);
      clearTimeout(room.timer);
      room.timer = setTimeout(() => saveRoom(room), 1500);
    });
    awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      const controlled = room.conns.get(origin);
      if (controlled) { added.forEach(id => controlled.add(id)); removed.forEach(id => controlled.delete(id)); }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      const message = encoding.toUint8Array(encoder);
      for (const conn of room.conns.keys()) sendBinary(room, conn, message);
    });
    return room;
  })();
  rooms.set(docId, pending);
  const room = await pending;
  rooms.set(docId, room);
  return room;
}

async function saveRoom(room) {
  clearTimeout(room.timer);
  if (!db.documents.some(d => d.id === room.docId)) return;
  await writeFile(join(ydocDir, `${room.docId}.bin`), Y.encodeStateAsUpdate(room.doc)).catch(error => console.error('Collaboration save failed', error.message));
}

async function closeRoom(docId, deleted = false) {
  const room = await rooms.get(docId);
  if (room) {
    for (const conn of room.conns.keys()) conn.close(4404, 'Document removed');
    room.doc.destroy();
    rooms.delete(docId);
  }
  if (deleted) await rm(join(ydocDir, `${docId}.bin`), { force: true });
}
export const resetCollaborativeState = docId => closeRoom(docId, true);

function sendBinary(room, conn, message) {
  if (conn.readyState > 1) { leaveRoom(room, conn); return; }
  try { conn.send(message); } catch { leaveRoom(room, conn); }
}

function leaveRoom(room, conn) {
  const controlled = room.conns.get(conn);
  if (!controlled) return;
  room.conns.delete(conn);
  awarenessProtocol.removeAwarenessStates(room.awareness, [...controlled], null);
  if (!room.conns.size) {
    saveRoom(room).then(() => {
      if (!room.conns.size && rooms.get(room.docId) === room) { room.doc.destroy(); rooms.delete(room.docId); }
    });
  }
}

async function joinRoom(conn, docId, readOnly) {
  // Buffer messages that arrive while the room loads from disk; dropping the
  // client's first sync step would leave it without the server state.
  const early = [];
  conn.binaryType = 'arraybuffer';
  conn.on('message', data => early.push(data));
  const room = await getRoom(docId);
  room.conns.set(conn, new Set());
  conn.removeAllListeners('message');
  const handle = data => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const encoder = encoding.createEncoder();
      const type = decoding.readVarUint(decoder);
      if (type === messageSync) {
        encoding.writeVarUint(encoder, messageSync);
        if (readOnly) {
          // Viewers may request state (step 1) but their edits are ignored.
          if (decoding.readVarUint(decoder) === syncProtocol.messageYjsSyncStep1) syncProtocol.readSyncStep1(decoder, encoder, room.doc);
        } else syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn);
        if (encoding.length(encoder) > 1) sendBinary(room, conn, encoding.toUint8Array(encoder));
      } else if (type === messageAwareness) {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), conn);
      }
    } catch (error) { console.error('Collaboration message rejected', error.message); }
  };
  conn.on('message', handle);
  conn.on('close', () => leaveRoom(room, conn));
  if (conn.readyState > 1) { leaveRoom(room, conn); return; }
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  sendBinary(room, conn, encoding.toUint8Array(encoder));
  const states = room.awareness.getStates();
  if (states.size) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, messageAwareness);
    encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]));
    sendBinary(room, conn, encoding.toUint8Array(awarenessEncoder));
  }
  early.splice(0).forEach(handle);
}

// ---- HTTP upgrade handling ----------------------------------------------------
export function attachRealtime(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 5_000_000 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://local');
    const origin = req.headers.origin;
    const reject = (code, text) => { socket.write(`HTTP/1.1 ${code} ${text}\r\n\r\n`); socket.destroy(); };
    if (origin && !config.origins.includes(origin) && !origin.startsWith('http://localhost') && !origin.startsWith('http://127.0.0.1')) return reject(403, 'Forbidden');
    const auth = sessionFor(url.searchParams.get('token'));
    if (!auth) return reject(401, 'Unauthorized');
    const { user } = auth;

    if (url.pathname === '/ws') {
      const workspaceId = user.workspaceId;
      if (!membership(user.id, workspaceId)) return reject(403, 'Forbidden');
      return wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req);
        const client = { socket: ws, user, workspaceId, location: '/' };
        eventClients.add(client);
        ws.on('message', raw => {
          try {
            const message = JSON.parse(String(raw));
            if (message.type === 'presence' && typeof message.location === 'string') { client.location = message.location.slice(0, 200); broadcastPresence(workspaceId); }
            if (message.type === 'ping') ws.send('{"type":"pong"}');
          } catch { /* ignore malformed */ }
        });
        ws.on('close', () => { eventClients.delete(client); broadcastPresence(workspaceId); });
        broadcastPresence(workspaceId);
      });
    }

    const collab = url.pathname.match(/^\/collab\/([\w-]{1,100})$/);
    if (collab) {
      const doc = db.documents.find(d => d.id === collab[1]);
      const member = doc && membership(user.id, doc.workspaceId);
      const visible = doc && (doc.visibility !== 'private' || doc.ownerId === user.id || (doc.collaboratorIds || []).includes(user.id));
      if (!doc || !member || !visible || doc.type === 'latex') return reject(403, 'Forbidden');
      return wss.handleUpgrade(req, socket, head, ws => { wss.emit('connection', ws, req); joinRoom(ws, doc.id, member.role === 'VIEWER'); });
    }
    reject(404, 'Not Found');
  });

  // Keep connections alive and drop dead ones.
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  wss.on('connection', ws => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });
  wss.on('close', () => clearInterval(interval));
  return wss;
}

export async function flushRealtime() {
  for (const pending of rooms.values()) { const room = await pending; await saveRoom(room); }
}
