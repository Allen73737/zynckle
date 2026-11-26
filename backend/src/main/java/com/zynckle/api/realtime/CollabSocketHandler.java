package com.zynckle.api.realtime;

import com.zynckle.api.security.AuthService;
import com.zynckle.api.security.CurrentUser;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.BinaryWebSocketHandler;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * /collab/{documentId}?token=… — live co-editing for the y-websocket client.
 *
 * Java has no Yjs implementation, so the server never decodes document contents. Yjs updates
 * are commutative and idempotent, which makes a log-and-relay server correct: every update a
 * client sends is appended to the room log and relayed to the other peers; a joining client
 * receives the log as individual update messages followed by an empty sync-step-2, which
 * marks it synced. When the log grows large, the server asks a connected peer for its full
 * state and replaces the log with that snapshot plus later updates. A room left empty for
 * a while is dropped, and the next editor re-seeds it from the document's saved HTML.
 *
 * Wire format (y-protocols): varUint messageType; 0 = sync (varUint step, varUint8Array
 * payload; step 0 = state vector, 1 = full update, 2 = incremental update), 1 = awareness
 * (varUint8Array), 3 = query awareness.
 */
public class CollabSocketHandler extends BinaryWebSocketHandler {
    private static final int SYNC = 0, AWARENESS = 1, QUERY_AWARENESS = 3;
    private static final int STEP1 = 0, STEP2 = 1, UPDATE = 2;
    private static final long COMPACT_AT_BYTES = 2L * 1024 * 1024;
    private static final long MAX_LOG_BYTES = 16L * 1024 * 1024;
    private static final long IDLE_MS = 10 * 60_000;
    /** Yjs v1 encoding of an update with no structs and an empty delete set. */
    private static final byte[] EMPTY_UPDATE = {0, 0};

    private static final class Room {
        final List<byte[]> log = new ArrayList<>();
        long bytes;
        long emptySince;
        final Map<String, WebSocketSession> peers = new ConcurrentHashMap<>();
        final Map<String, byte[]> awareness = new ConcurrentHashMap<>();
        /** Peer asked for a full snapshot, and the log length at the moment we asked. */
        String compactFrom;
        int compactMark;
    }

    private final AuthService auth;
    private final JdbcTemplate jdbc;
    private final Map<String, Room> rooms = new ConcurrentHashMap<>();

    public CollabSocketHandler(AuthService auth, JdbcTemplate jdbc) {
        this.auth = auth;
        this.jdbc = jdbc;
    }

    private static String documentId(WebSocketSession session) {
        String path = session.getUri() == null ? "" : session.getUri().getPath();
        return path.substring(path.lastIndexOf('/') + 1);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession raw) throws Exception {
        raw.setBinaryMessageSizeLimit(4 * 1024 * 1024);
        Optional<CurrentUser> user = auth.resolve(EventSocketHandler.token(raw));
        String docId = documentId(raw);
        if (user.isEmpty() || jdbc.queryForList("SELECT id FROM document WHERE id = ? AND workspace_id = ?", docId, user.get().workspaceId()).isEmpty()) {
            raw.close(new CloseStatus(4403, "No access to this document"));
            return;
        }
        WebSocketSession session = new ConcurrentWebSocketSessionDecorator(raw, 5_000, 8 * 1024 * 1024);
        raw.getAttributes().put("readOnly", !user.get().canEdit());
        raw.getAttributes().put("room", docId);
        Room room = rooms.computeIfAbsent(docId, k -> new Room());
        List<byte[]> backlog;
        synchronized (room) {
            if (room.peers.isEmpty() && room.emptySince > 0 && System.currentTimeMillis() - room.emptySince > IDLE_MS) { room.log.clear(); room.bytes = 0; }
            room.peers.put(raw.getId(), session);
            backlog = new ArrayList<>(room.log);
        }
        // Ask the client for its state, then replay everything the room has seen and mark it synced.
        send(session, syncMessage(STEP1, new byte[] {0}));
        for (byte[] update : backlog) send(session, syncMessage(UPDATE, update));
        send(session, syncMessage(STEP2, EMPTY_UPDATE));
        for (byte[] state : room.awareness.values()) send(session, state);
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession raw, BinaryMessage message) {
        Room room = rooms.get(String.valueOf(raw.getAttributes().get("room")));
        if (room == null) return;
        byte[] data = new byte[message.getPayload().remaining()];
        message.getPayload().get(data);
        Reader in = new Reader(data);
        try {
            int type = in.varUint();
            if (type == SYNC) {
                int step = in.varUint();
                if (step == STEP1) return; // the room log was already replayed on join
                byte[] update = in.varBytes();
                if (Boolean.TRUE.equals(raw.getAttributes().get("readOnly")) || update.length <= 2) return; // viewers cannot edit
                WebSocketSession askForSnapshot = null;
                synchronized (room) {
                    if (step == STEP2 && raw.getId().equals(room.compactFrom)) {
                        // Compaction: the peer's full state covers everything relayed to it before we asked.
                        List<byte[]> tail = new ArrayList<>(room.log.subList(Math.min(room.compactMark, room.log.size()), room.log.size()));
                        room.log.clear();
                        room.log.add(update);
                        room.log.addAll(tail);
                        room.bytes = room.log.stream().mapToLong(u -> u.length).sum();
                        room.compactFrom = null;
                        return; // peers already have this state
                    }
                    room.log.add(update);
                    room.bytes += update.length;
                    if (room.bytes > MAX_LOG_BYTES && room.peers.size() <= 1) { room.log.clear(); room.bytes = 0; }
                    else if (room.bytes > COMPACT_AT_BYTES && room.compactFrom == null) {
                        room.compactFrom = raw.getId();
                        room.compactMark = room.log.size();
                        askForSnapshot = room.peers.get(raw.getId());
                    }
                }
                // An empty state vector asks the peer for its complete document.
                if (askForSnapshot != null) send(askForSnapshot, syncMessage(STEP1, new byte[] {0}));
                byte[] relay = syncMessage(UPDATE, update);
                for (Map.Entry<String, WebSocketSession> peer : room.peers.entrySet()) if (!peer.getKey().equals(raw.getId())) send(peer.getValue(), relay);
            } else if (type == AWARENESS) {
                room.awareness.put(raw.getId(), data);
                for (Map.Entry<String, WebSocketSession> peer : room.peers.entrySet()) if (!peer.getKey().equals(raw.getId())) send(peer.getValue(), data);
            } else if (type == QUERY_AWARENESS) {
                WebSocketSession self = room.peers.get(raw.getId());
                if (self != null) for (byte[] state : room.awareness.values()) send(self, state);
            }
        } catch (RuntimeException ignored) { /* malformed frame */ }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession raw, CloseStatus status) {
        Room room = rooms.get(String.valueOf(raw.getAttributes().get("room")));
        if (room == null) return;
        room.awareness.remove(raw.getId());
        synchronized (room) {
            room.peers.remove(raw.getId());
            if (raw.getId().equals(room.compactFrom)) room.compactFrom = null;
            if (room.peers.isEmpty()) room.emptySince = System.currentTimeMillis();
        }
    }

    /** Forget a room, e.g. after a document version is restored outside the editor. */
    public void reset(String documentId) { rooms.remove(documentId); }

    private static void send(WebSocketSession session, byte[] data) {
        try { if (session.isOpen()) session.sendMessage(new BinaryMessage(data)); } catch (IOException | IllegalStateException ignored) { /* peer gone */ }
    }

    // ---- lib0 encoding --------------------------------------------------------------

    static byte[] syncMessage(int step, byte[] payload) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(payload.length + 8);
        writeVarUint(out, SYNC);
        writeVarUint(out, step);
        writeVarUint(out, payload.length);
        out.writeBytes(payload);
        return out.toByteArray();
    }

    static void writeVarUint(ByteArrayOutputStream out, long value) {
        while (value > 0x7f) { out.write((int) (0x80 | (value & 0x7f))); value >>>= 7; }
        out.write((int) value);
    }

    static final class Reader {
        private final byte[] data;
        private int pos;

        Reader(byte[] data) { this.data = data; }

        int varUint() {
            long value = 0;
            int shift = 0;
            while (true) {
                if (pos >= data.length) throw new IllegalArgumentException("truncated");
                int b = data[pos++] & 0xff;
                value |= (long) (b & 0x7f) << shift;
                if (b < 0x80) return (int) value;
                shift += 7;
                if (shift > 35) throw new IllegalArgumentException("varUint too long");
            }
        }

        byte[] varBytes() {
            int len = varUint();
            if (len < 0 || pos + len > data.length) throw new IllegalArgumentException("truncated");
            byte[] out = Arrays.copyOfRange(data, pos, pos + len);
            pos += len;
            return out;
        }
    }
}
