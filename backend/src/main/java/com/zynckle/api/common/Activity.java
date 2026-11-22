package com.zynckle.api.common;

import com.zynckle.api.security.CurrentUser;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.UUID;

/** Workspace activity feed, audit trail and per-user notifications. */
@Component
public class Activity {
    private final JdbcTemplate jdbc;

    public Activity(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void log(CurrentUser me, String verb, String entityType, String summary) { log(me, verb, entityType, summary, false, null); }

    public void log(CurrentUser me, String verb, String entityType, String summary, boolean audit, String projectId) {
        String text = summary == null ? "" : summary;
        jdbc.update("""
            INSERT INTO activity_log (id, workspace_id, actor_id, actor_name, actor_avatar, verb, entity_type, summary, audit, project_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            UUID.randomUUID().toString(), me.workspaceId(), me.userId(), me.name(), me.initials(), verb, entityType,
            text.substring(0, Math.min(500, text.length())), audit, projectId);
    }

    /** Notify the given users (never the actor), honouring each recipient's preferences for that kind. */
    public void notify(CurrentUser me, Collection<String> userIds, String kind, String title, String body, String link) {
        for (String userId : userIds) {
            if (userId == null || userId.equals(me.userId())) continue;
            String prefs = jdbc.queryForList("SELECT notification_prefs FROM app_user WHERE id = ?", String.class, userId).stream().findFirst().orElse(null);
            if (prefs != null && prefs.replace(" ", "").contains("\"" + kind + "\":false")) continue;
            jdbc.update("INSERT INTO notification (id, user_id, workspace_id, kind, title, body, link) VALUES (?, ?, ?, ?, ?, ?, ?)",
                UUID.randomUUID().toString(), userId, me.workspaceId(), kind, cut(title, 240), cut(body, 4000), link);
        }
    }

    private static String cut(String value, int max) { return value == null ? "" : value.substring(0, Math.min(max, value.length())); }
}
