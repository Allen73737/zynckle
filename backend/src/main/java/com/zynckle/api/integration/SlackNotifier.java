package com.zynckle.api.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/** Posts to a workspace's Slack incoming webhook. Best effort and asynchronous. */
@Component
public class SlackNotifier {
    private static final Logger log = LoggerFactory.getLogger(SlackNotifier.class);
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public SlackNotifier(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public void post(String workspaceId, String text) {
        String url;
        try {
            url = jdbc.queryForList("SELECT config FROM workspace_integration WHERE workspace_id = ? AND kind = 'slack'", String.class, workspaceId).stream().findFirst().orElse(null);
        } catch (RuntimeException e) {
            return; // table not created yet during startup
        }
        if (url == null) return;
        try {
            http.sendAsync(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(8)).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("text", text)))).build(), HttpResponse.BodyHandlers.discarding());
        } catch (Exception e) {
            log.debug("Slack post skipped: {}", e.getMessage());
        }
    }
}
