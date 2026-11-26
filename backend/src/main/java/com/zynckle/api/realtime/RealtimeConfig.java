package com.zynckle.api.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zynckle.api.security.AuthService;
import com.zynckle.api.security.SessionCookies;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Both sockets authenticate with the HttpOnly session cookie (browsers) or ?token= (API clients).
 * Because browsers attach cookies to cross-site WebSocket handshakes too, the Origin must be the app's own.
 */
@Configuration
@EnableWebSocket
public class RealtimeConfig implements WebSocketConfigurer {
    private final AuthService auth;
    private final RealtimeHub hub;
    private final ObjectMapper json;
    private final JdbcTemplate jdbc;
    private final SessionCookies cookies;

    public RealtimeConfig(AuthService auth, RealtimeHub hub, ObjectMapper json, JdbcTemplate jdbc, SessionCookies cookies) {
        this.cookies = cookies;
        this.auth = auth;
        this.hub = hub;
        this.json = json;
        this.jdbc = jdbc;
    }

    @Bean
    public CollabSocketHandler collabSocketHandler() { return new CollabSocketHandler(auth, jdbc); }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        HandshakeInterceptor origin = new HandshakeInterceptor() {
            @Override
            public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler, Map<String, Object> attributes) {
                // Only the real Host header counts: X-Forwarded-Host is client-controllable unless a proxy
                // overwrites it. nginx and the Vite dev proxy both pass the browser's Host through unchanged.
                String host = request.getHeaders().getFirst("Host");
                if (cookies.allowsOrigin(request.getHeaders().getOrigin(), host)) return true;
                response.setStatusCode(HttpStatus.FORBIDDEN);
                return false;
            }
            @Override
            public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler, Exception exception) { }
        };
        // Origin is checked by the interceptor above (configured origins or same-origin), not by a static list.
        registry.addHandler(new EventSocketHandler(auth, hub, json), "/ws").addInterceptors(origin).setAllowedOriginPatterns("*");
        registry.addHandler(collabSocketHandler(), "/collab/*").addInterceptors(origin).setAllowedOriginPatterns("*");
    }
}
