package com.zynckle.api.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zynckle.api.security.CurrentUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Workspace event bus for the /ws socket. Controllers publish JSON events; each connected
 * session receives only events for its own workspace, optionally narrowed to an audience
 * (e.g. the owner and collaborators of a private file). Also tracks who is online where.
 */
@Component
public class RealtimeHub {
    private static final Logger log = LoggerFactory.getLogger(RealtimeHub.class);

    record Client(WebSocketSession session, CurrentUser user, String[] location) {}

    private final ObjectMapper json;
    private final Map<String, Client> clients = new ConcurrentHashMap<>();

    public RealtimeHub(ObjectMapper json) { this.json = json; }

    void join(WebSocketSession raw, CurrentUser user) {
        // Decorator serialises concurrent sends, which a raw session does not allow.
        WebSocketSession session = new ConcurrentWebSocketSessionDecorator(raw, 5_000, 512 * 1024);
        clients.put(raw.getId(), new Client(session, user, new String[] {"/"}));
        broadcastPresence(user.workspaceId());
    }

    void leave(WebSocketSession raw) {
        Client client = clients.remove(raw.getId());
        if (client != null) broadcastPresence(client.user().workspaceId());
    }

    void moved(WebSocketSession raw, String location) {
        Client client = clients.get(raw.getId());
        if (client == null) return;
        client.location()[0] = location == null ? "/" : location.substring(0, Math.min(200, location.length()));
        broadcastPresence(client.user().workspaceId());
    }

    /** People online in a workspace, one entry per user (their most recent location). */
    public List<Map<String, Object>> presence(String workspaceId) {
        Map<String, Map<String, Object>> byUser = new LinkedHashMap<>();
        for (Client c : clients.values()) {
            if (!c.user().workspaceId().equals(workspaceId)) continue;
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", c.user().userId()); p.put("name", c.user().name()); p.put("email", c.user().email());
            p.put("avatar", c.user().initials()); p.put("location", c.location()[0]);
            byUser.put(c.user().userId(), p);
        }
        return new ArrayList<>(byUser.values());
    }

    private void broadcastPresence(String workspaceId) { publish(workspaceId, "presence", presence(workspaceId), null); }

    /** Send an event to every session in the workspace, or only to the given users. */
    public void publish(String workspaceId, String type, Object data, Collection<String> audience) {
        String payload;
        try { payload = json.writeValueAsString(Map.of("type", type, "data", data == null ? Map.of() : data)); }
        catch (IOException e) { log.warn("Could not serialise realtime event {}", type); return; }
        for (Client c : clients.values()) {
            if (!c.user().workspaceId().equals(workspaceId)) continue;
            if (audience != null && !audience.contains(c.user().userId())) continue;
            send(c, payload);
        }
    }

    /** Send an event to one user wherever they are connected (e.g. a notification). */
    public void toUser(String userId, String type, Object data) {
        String payload;
        try { payload = json.writeValueAsString(Map.of("type", type, "data", data == null ? Map.of() : data)); }
        catch (IOException e) { return; }
        for (Client c : clients.values()) if (c.user().userId().equals(userId)) send(c, payload);
    }

    private void send(Client c, String payload) {
        try { if (c.session().isOpen()) c.session().sendMessage(new TextMessage(payload)); }
        catch (IOException | IllegalStateException e) { clients.remove(c.session().getId()); }
    }

    public int connections() { return clients.size(); }
}
