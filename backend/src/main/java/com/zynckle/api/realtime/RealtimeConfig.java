package com.zynckle.api.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zynckle.api.security.AuthService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/** Both sockets authenticate with the session token in the query string (browsers cannot set headers). */
@Configuration
@EnableWebSocket
public class RealtimeConfig implements WebSocketConfigurer {
    private final AuthService auth;
    private final RealtimeHub hub;
    private final ObjectMapper json;
    private final JdbcTemplate jdbc;

    public RealtimeConfig(AuthService auth, RealtimeHub hub, ObjectMapper json, JdbcTemplate jdbc) {
        this.auth = auth;
        this.hub = hub;
        this.json = json;
        this.jdbc = jdbc;
    }

    @Bean
    public CollabSocketHandler collabSocketHandler() { return new CollabSocketHandler(auth, jdbc); }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(new EventSocketHandler(auth, hub, json), "/ws").setAllowedOriginPatterns("*");
        registry.addHandler(collabSocketHandler(), "/collab/*").setAllowedOriginPatterns("*");
    }
}
