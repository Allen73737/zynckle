package com.zynckle.api.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zynckle.api.ai.AiClient;
import com.zynckle.api.ai.AiSettings;
import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.realtime.RealtimeHub;
import com.zynckle.api.security.AuthService;
import com.zynckle.api.security.CurrentUser;
import com.zynckle.api.task.TaskViews;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Honest integration status plus two workspace integrations:
 * Slack (an incoming-webhook URL that receives workspace activity) and GitHub (a signed
 * webhook that links pull requests to tasks and moves them along as PRs open and merge).
 */
@RestController
public class IntegrationsController {
    private static final Pattern SLACK_URL = Pattern.compile("^https://hooks\\.slack\\.com/services/[A-Za-z0-9/_-]{10,200}$");
    /** A Zynckle task link in a PR title or body, e.g. https://app/projects/p?task=<uuid>, or "task:<uuid>". */
    private static final Pattern TASK_REF = Pattern.compile("(?:task[=:])([0-9a-fA-F-]{8,64})");

    private final JdbcTemplate jdbc;
    private final AiClient ai;
    private final AiSettings settings;
    private final Mailer mailer;
    private final AuthService auth;
    private final Activity activity;
    private final RealtimeHub hub;
    private final ObjectMapper json;
    private final SlackNotifier slack;

    public IntegrationsController(JdbcTemplate jdbc, AiClient ai, AiSettings settings, Mailer mailer, AuthService auth, Activity activity, RealtimeHub hub, ObjectMapper json, SlackNotifier slack) {
        this.jdbc = jdbc;
        this.ai = ai;
        this.settings = settings;
        this.mailer = mailer;
        this.auth = auth;
        this.activity = activity;
        this.hub = hub;
        this.json = json;
        this.slack = slack;
    }

    private Optional<String> config(String workspaceId, String kind) {
        return jdbc.queryForList("SELECT config FROM workspace_integration WHERE workspace_id = ? AND kind = ?", String.class, workspaceId, kind).stream().findFirst();
    }

    private void saveConfig(String workspaceId, String kind, String value) {
        jdbc.update("DELETE FROM workspace_integration WHERE workspace_id = ? AND kind = ?", workspaceId, kind);
        if (value != null) jdbc.update("INSERT INTO workspace_integration (workspace_id, kind, config) VALUES (?, ?, ?)", workspaceId, kind, value);
    }

    private static Map<String, Object> item(String id, String name, String status, String detail, List<String> env) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id); out.put("name", name); out.put("status", status); out.put("detail", detail); out.put("env", env);
        return out;
    }

    @GetMapping("/api/integrations")
    public List<Map<String, Object>> list(CurrentUser me) {
        Map<String, Object> status = ai.status();
        boolean aiOn = Boolean.TRUE.equals(status.get("available"));
        boolean google = !settings.get("GOOGLE_CLIENT_ID").isBlank() && !settings.get("GOOGLE_CLIENT_SECRET").isBlank();
        boolean slack = config(me.workspaceId(), "slack").isPresent();
        boolean github = config(me.workspaceId(), "github").isPresent();
        return List.of(
            item("ai", "AI providers", aiOn ? "connected" : "not-configured", aiOn ? status.get("provider") + " is the default provider" : "Set GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY or CUSTOM_AI_URL", List.of("AI_PROVIDER", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "CUSTOM_AI_URL")),
            item("email", "Email delivery", mailer.configured() ? "connected" : "not-configured", mailer.configured() ? "Invites, password resets, verification links and assignment emails are sent by SMTP" : "Links are written to the API log instead of emailed. Set SMTP_HOST to send email.", List.of("SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM")),
            item("google", "Google sign-in", google ? "connected" : "not-configured", google ? "Users can sign in with Google" : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (redirect URI: <public URL>/api/auth/google/callback)", List.of("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")),
            item("slack", "Slack", slack ? "connected" : "available", slack ? "Workspace activity is posted to your Slack channel" : "Paste a Slack incoming-webhook URL below to post workspace activity", List.of()),
            item("github", "GitHub", github ? "connected" : "available", github ? "Pull requests that mention a task link move it to In review, and to Done when merged" : "Import public repositories in Code; enable the webhook below to link pull requests to tasks", List.of()),
            item("storage", "File storage", "local", "Files are stored on the API host disk under data/uploads", List.of()));
    }

    // ---- Workspace settings (admins) ------------------------------------------------

    @GetMapping("/api/integrations/settings")
    public Map<String, Object> settings(CurrentUser me) {
        me.requireAdmin();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("slack", config(me.workspaceId(), "slack").map(url -> Map.of("connected", true, "url", url.replaceAll("(.{40}).+", "$1…"))).orElse(Map.of("connected", false)));
        out.put("github", config(me.workspaceId(), "github").map(s -> Map.of("connected", true, "webhookUrl", "/api/integrations/github/" + me.workspaceId() + "/webhook")).orElse(Map.of("connected", false)));
        return out;
    }

    @PutMapping("/api/integrations/slack")
    public Map<String, Object> slack(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireAdmin();
        String url = Objects.toString(body.get("url"), "").trim();
        if (url.isEmpty()) { saveConfig(me.workspaceId(), "slack", null); return Map.of("connected", false); }
        if (!SLACK_URL.matcher(url).matches()) throw new ApiException(400, "Use a Slack incoming-webhook URL (https://hooks.slack.com/services/…)");
        saveConfig(me.workspaceId(), "slack", url);
        slack.post(me.workspaceId(), "Zynckle is now connected to this channel for *" + me.workspaceName() + "*.");
        activity.log(me, "connected Slack", "integration", "Slack", true, null);
        return Map.of("connected", true);
    }

    /** Generates a new webhook secret; it is shown once so it can be pasted into GitHub. */
    @PostMapping("/api/integrations/github")
    public Map<String, Object> github(CurrentUser me, @RequestBody(required = false) Map<String, Object> body) {
        me.requireAdmin();
        if (body != null && Boolean.FALSE.equals(body.get("enabled"))) { saveConfig(me.workspaceId(), "github", null); return Map.of("connected", false); }
        String secret = auth.randomToken(24);
        saveConfig(me.workspaceId(), "github", secret);
        activity.log(me, "enabled the GitHub webhook", "integration", "GitHub", true, null);
        return Map.of("connected", true, "secret", secret, "webhookUrl", "/api/integrations/github/" + me.workspaceId() + "/webhook", "contentType", "application/json", "events", List.of("pull_request"));
    }

    // ---- GitHub webhook (public, signed) ------------------------------------------------

    @PostMapping(value = "/api/integrations/github/{workspaceId}/webhook", consumes = "*/*")
    public Map<String, Object> githubWebhook(@PathVariable String workspaceId, @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature,
                                             @RequestHeader(value = "X-GitHub-Event", required = false) String event, @RequestBody(required = false) byte[] body) throws Exception {
        String secret = config(workspaceId, "github").orElseThrow(() -> new ApiException(404, "GitHub webhook is not enabled for this workspace"));
        byte[] payload = body == null ? new byte[0] : body;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String expected = "sha256=" + HexFormat.of().formatHex(mac.doFinal(payload));
        if (signature == null || !MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), signature.getBytes(StandardCharsets.UTF_8))) throw new ApiException(401, "Invalid signature");
        if ("ping".equals(event)) return Map.of("ok", true);
        if (!"pull_request".equals(event)) return Map.of("ignored", event);
        JsonNode root = json.readTree(payload);
        JsonNode pr = root.path("pull_request");
        String action = root.path("action").asText();
        boolean merged = pr.path("merged").asBoolean();
        String target = "closed".equals(action) && merged ? "Done" : List.of("opened", "reopened", "ready_for_review").contains(action) ? "In review" : null;
        if (target == null) return Map.of("ignored", action);
        Set<String> refs = new LinkedHashSet<>();
        Matcher m = TASK_REF.matcher(pr.path("title").asText() + "\n" + pr.path("body").asText(""));
        while (m.find()) refs.add(m.group(1));
        String owner = jdbc.queryForObject("SELECT owner_id FROM workspace WHERE id = ?", String.class, workspaceId);
        String workspaceName = jdbc.queryForObject("SELECT name FROM workspace WHERE id = ?", String.class, workspaceId);
        CurrentUser github = new CurrentUser(owner, "GitHub", "", workspaceId, workspaceName, "OWNER", "");
        int moved = 0;
        for (String ref : refs) {
            List<Map<String, Object>> tasks = jdbc.queryForList("SELECT t.id, t.title, t.project_id FROM task t JOIN project p ON p.id = t.project_id WHERE p.workspace_id = ? AND t.id LIKE ?", workspaceId, ref + "%");
            if (tasks.size() != 1) continue; // ambiguous or unknown references are ignored
            Map<String, Object> t = tasks.get(0);
            jdbc.update("UPDATE task SET status = ?, done = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", target, "Done".equals(target), t.get("id"));
            String note = (merged ? "Merged" : "Opened") + " pull request #" + pr.path("number").asInt() + ": " + pr.path("title").asText() + " " + pr.path("html_url").asText();
            jdbc.update("INSERT INTO task_comment (id, task_id, author_id, author_name, body) VALUES (?, ?, NULL, 'GitHub', ?)", UUID.randomUUID().toString(), t.get("id"), note.substring(0, Math.min(5000, note.length())));
            activity.log(github, merged ? "merged a pull request for" : "opened a pull request for", "task", String.valueOf(t.get("title")), false, (String) t.get("project_id"));
            hub.publish(workspaceId, "task.changed", TaskViews.find(jdbc, github, (String) t.get("id")), null);
            moved++;
        }
        return Map.of("ok", true, "tasksUpdated", moved);
    }
}
