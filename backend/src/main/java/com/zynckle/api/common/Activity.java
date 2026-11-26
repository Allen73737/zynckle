package com.zynckle.api.common;

import com.zynckle.api.integration.Mailer;
import com.zynckle.api.integration.SlackNotifier;
import com.zynckle.api.realtime.RealtimeHub;
import com.zynckle.api.security.CurrentUser;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Workspace activity feed, audit trail and per-user notifications. */
@Component
public class Activity {
    private final JdbcTemplate jdbc;
    private final RealtimeHub hub;
    private final SlackNotifier slack;
    private final Mailer mailer;
    /** Notification kinds worth an email; the rest stay in-app. */
    private static final java.util.Set<String> EMAIL_KINDS = java.util.Set.of("mention", "task", "deadline", "invite", "team");

    public Activity(JdbcTemplate jdbc, RealtimeHub hub, SlackNotifier slack, Mailer mailer) {
        this.jdbc = jdbc;
        this.hub = hub;
        this.slack = slack;
        this.mailer = mailer;
    }

    public void log(CurrentUser me, String verb, String entityType, String summary) { log(me, verb, entityType, summary, false, null); }

    public void log(CurrentUser me, String verb, String entityType, String summary, boolean audit, String projectId) {
        String text = cut(summary, 500);
        String id = UUID.randomUUID().toString();
        jdbc.update("""
            INSERT INTO activity_log (id, workspace_id, actor_id, actor_name, actor_avatar, verb, entity_type, summary, audit, project_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            id, me.workspaceId(), me.userId(), me.name(), me.initials(), verb, entityType, text, audit, projectId);
        if (audit) return; // audit entries stay off the live feed
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", id); item.put("verb", verb); item.put("entityType", entityType); item.put("summary", text);
        item.put("projectId", projectId); item.put("audit", false); item.put("createdAt", Instant.now().toString());
        item.put("actor", Map.of("id", me.userId(), "name", me.name(), "email", me.email(), "avatar", me.initials()));
        hub.publish(me.workspaceId(), "activity", item, null);
        slack.post(me.workspaceId(), "*" + me.name() + "* " + verb + (text.isBlank() ? "" : " _" + text + "_"));
    }

    /** Notify the given users (never the actor), honouring each recipient's preferences for that kind. */
    public void notify(CurrentUser me, Collection<String> userIds, String kind, String title, String body, String link) {
        for (String userId : userIds) {
            if (userId == null || userId.equals(me.userId())) continue;
            String prefs = jdbc.queryForList("SELECT notification_prefs FROM app_user WHERE id = ?", String.class, userId).stream().findFirst().orElse(null);
            if (prefs != null && prefs.replace(" ", "").contains("\"" + kind + "\":false")) continue;
            String id = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO notification (id, user_id, workspace_id, kind, title, body, link) VALUES (?, ?, ?, ?, ?, ?, ?)",
                id, userId, me.workspaceId(), kind, cut(title, 240), cut(body, 4000), link);
            Map<String, Object> n = new LinkedHashMap<>();
            n.put("id", id); n.put("kind", kind); n.put("title", cut(title, 240)); n.put("body", cut(body, 4000));
            n.put("link", link == null ? "" : link); n.put("read", false); n.put("createdAt", Instant.now().toString()); n.put("workspace", me.workspaceName());
            hub.toUser(userId, "notification", n);
            if (EMAIL_KINDS.contains(kind) && mailer.configured()) {
                String email = jdbc.queryForList("SELECT email FROM app_user WHERE id = ?", String.class, userId).stream().findFirst().orElse(null);
                mailer.send(email, cut(title, 200), cut(body, 2000) + (link == null || link.isBlank() ? "" : "\n\nOpen in Zynckle: " + mailer.link(link)));
            }
        }
    }

    private static String cut(String value, int max) { return value == null ? "" : value.substring(0, Math.min(max, value.length())); }
}
