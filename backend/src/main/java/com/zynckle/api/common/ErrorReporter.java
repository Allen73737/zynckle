package com.zynckle.api.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zynckle.api.ai.AiSettings;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Self-hosted error tracking. Every unexpected server error and every error the browser reports
 * is logged with a short fingerprint. When ALERT_WEBHOOK_URL is set (a Slack, Discord or any
 * incoming webhook that accepts {"text": "..."}), the first occurrence of each fingerprint in a
 * 10-minute window is also posted there, so a failure is noticed without flooding the channel.
 */
@Component
public class ErrorReporter {
    private static final Logger log = LoggerFactory.getLogger(ErrorReporter.class);
    private static final Duration ALERT_WINDOW = Duration.ofMinutes(10);

    private final String webhook;
    private final String service;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final Map<String, Instant> lastAlert = new ConcurrentHashMap<>();
    private final Deque<Instant> recent = new ArrayDeque<>();

    public ErrorReporter(AiSettings settings, ObjectMapper json) {
        this.webhook = settings.get("ALERT_WEBHOOK_URL", "");
        this.service = settings.get("ZYNCKLE_PUBLIC_URL", "zynckle");
        this.json = json;
    }

    public boolean alertsConfigured() { return !webhook.isBlank(); }

    /** Server-side exception that was not an expected ApiException. */
    public void server(String where, Throwable error) {
        String fingerprint = fingerprint("server", where + ":" + error.getClass().getName());
        log.error("[error {}] {}", fingerprint, where, error);
        record(fingerprint, "Server error in " + where + ": " + error.getClass().getSimpleName() + (error.getMessage() == null ? "" : " — " + truncate(error.getMessage(), 300)));
    }

    /** Error reported by a browser (window.onerror / unhandled rejection), already size-limited. */
    public void client(String message, String source, String page, String userAgent) {
        String fingerprint = fingerprint("client", message + "|" + source);
        log.warn("[client-error {}] {} at {} on {} ({})", fingerprint, message, source, page, userAgent);
        record(fingerprint, "Browser error on " + page + ": " + message + (source.isBlank() ? "" : " (" + source + ")"));
    }

    /** Errors recorded in the last hour, for /api/health. */
    public synchronized int lastHour() {
        Instant cutoff = Instant.now().minus(Duration.ofHours(1));
        while (!recent.isEmpty() && recent.peekFirst().isBefore(cutoff)) recent.pollFirst();
        return recent.size();
    }

    private void record(String fingerprint, String text) {
        synchronized (this) { recent.addLast(Instant.now()); if (recent.size() > 10_000) recent.pollFirst(); }
        if (webhook.isBlank()) return;
        Instant now = Instant.now();
        Instant previous = lastAlert.get(fingerprint);
        if (previous != null && previous.plus(ALERT_WINDOW).isAfter(now)) return;
        lastAlert.put(fingerprint, now);
        if (lastAlert.size() > 1000) lastAlert.entrySet().removeIf(e -> e.getValue().plus(ALERT_WINDOW).isBefore(now));
        try {
            String body = json.writeValueAsString(Map.of("text", "⚠️ Zynckle (" + service + ") [" + fingerprint + "] " + truncate(text, 1500), "content", "⚠️ Zynckle [" + fingerprint + "] " + truncate(text, 1500)));
            http.sendAsync(HttpRequest.newBuilder(URI.create(webhook)).timeout(Duration.ofSeconds(10)).header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.discarding())
                .exceptionally(e -> { log.warn("Alert webhook failed: {}", e.getMessage()); return null; });
        } catch (Exception e) {
            log.warn("Alert webhook failed: {}", e.getMessage());
        }
    }

    private static String fingerprint(String kind, String key) {
        return kind.charAt(0) + Integer.toHexString(key.hashCode() & 0xfffffff);
    }

    static String truncate(String s, int max) { return s == null ? "" : s.length() <= max ? s : s.substring(0, max) + "…"; }
}
