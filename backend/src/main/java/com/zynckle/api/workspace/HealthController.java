package com.zynckle.api.workspace;

import com.zynckle.api.ai.AiClient;
import com.zynckle.api.realtime.RealtimeHub;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/** Reports what is actually configured and reachable, not what the product would like to be. */
@RestController
public class HealthController {
    private final JdbcTemplate jdbc;
    private final AiClient ai;
    private final RealtimeHub hub;
    private final Environment env;

    public HealthController(JdbcTemplate jdbc, AiClient ai, RealtimeHub hub, Environment env) {
        this.jdbc = jdbc;
        this.ai = ai;
        this.hub = hub;
        this.env = env;
    }

    @GetMapping("/api/health")
    public Map<String, Object> health() {
        boolean database;
        try { database = Integer.valueOf(1).equals(jdbc.queryForObject("SELECT 1", Integer.class)); } catch (RuntimeException e) { database = false; }
        String url = env.getProperty("spring.datasource.url", "");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", database ? "ok" : "degraded");
        out.put("service", "zynckle-api");
        out.put("runtime", "Java " + System.getProperty("java.version"));
        out.put("framework", "Spring Boot");
        out.put("persistence", url.startsWith("jdbc:postgresql") ? "postgresql" : url.startsWith("jdbc:h2") ? "embedded-h2" : "jdbc");
        out.put("database", database);
        out.put("storage", "local");
        out.put("ai", Boolean.TRUE.equals(ai.status().get("available")));
        out.put("realtime", true);
        out.put("connections", hub.connections());
        return out;
    }
}
