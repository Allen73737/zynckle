package com.zynckle.api.realtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zynckle.api.security.AuthService;
import com.zynckle.api.security.CurrentUser;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Optional;

/** /ws?token=… — authenticated workspace events and presence. */
public class EventSocketHandler extends TextWebSocketHandler {
    private final AuthService auth;
    private final RealtimeHub hub;
    private final ObjectMapper json;

    public EventSocketHandler(AuthService auth, RealtimeHub hub, ObjectMapper json) {
        this.auth = auth;
        this.hub = hub;
        this.json = json;
    }

    /** The session from ?token= (API clients) or, for browsers, the HttpOnly session cookie. */
    static String token(WebSocketSession session) {
        String query = session.getUri() == null ? null : session.getUri().getRawQuery();
        if (query != null) {
            for (String part : query.split("&")) {
                if (part.startsWith("token=") && part.length() > 6) return java.net.URLDecoder.decode(part.substring(6), java.nio.charset.StandardCharsets.UTF_8);
            }
        }
        return com.zynckle.api.security.SessionCookies.readHeader(session.getHandshakeHeaders().get("Cookie"));
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        Optional<CurrentUser> user = auth.resolve(token(session));
        if (user.isEmpty()) { session.close(new CloseStatus(4401, "Sign in required")); return; }
        session.getAttributes().put("user", user.get());
        hub.join(session, user.get());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        try {
            JsonNode node = json.readTree(message.getPayload());
            if ("presence".equals(node.path("type").asText())) hub.moved(session, node.path("location").asText("/"));
        } catch (Exception ignored) { /* malformed frames are ignored */ }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) { hub.leave(session); }
}
