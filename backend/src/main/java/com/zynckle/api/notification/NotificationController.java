package com.zynckle.api.notification;

import com.zynckle.api.security.CurrentUser;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.sql.Timestamp;
import java.util.*;

/** Per-user notifications. The activity feed lives in WorkspaceController. */
@RestController
@RequestMapping("/api")
public class NotificationController {
    private final JdbcTemplate jdbc;

    public NotificationController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/notifications")
    public List<Map<String, Object>> getNotifications(CurrentUser me, @RequestParam(required = false) String unread) {
        String filter = unread != null ? " AND read = FALSE" : "";
        return jdbc.queryForList("SELECT * FROM notification WHERE user_id = ?" + filter + " ORDER BY created_at DESC LIMIT 100", me.userId()).stream().map(n -> {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", n.get("id")); out.put("kind", n.get("kind")); out.put("title", n.get("title")); out.put("body", n.get("body"));
            out.put("link", Objects.toString(n.get("link"), "")); out.put("read", Boolean.TRUE.equals(n.get("read")));
            out.put("createdAt", n.get("created_at") instanceof Timestamp t ? t.toInstant().toString() : null);
            return out;
        }).toList();
    }

    @PostMapping("/notifications/{id}/read")
    public Map<String, Object> markRead(CurrentUser me, @PathVariable String id) {
        jdbc.update("UPDATE notification SET read = TRUE WHERE id = ? AND user_id = ?", id, me.userId());
        return Map.of("read", true);
    }

    @DeleteMapping("/notifications/{id}")
    public Map<String, Object> delete(CurrentUser me, @PathVariable String id) {
        jdbc.update("DELETE FROM notification WHERE id = ? AND user_id = ?", id, me.userId());
        return Map.of("deleted", true);
    }

    @PostMapping("/notifications/read-all")
    public Map<String, Object> markAllRead(CurrentUser me) {
        return Map.of("updated", jdbc.update("UPDATE notification SET read = TRUE WHERE user_id = ? AND read = FALSE", me.userId()));
    }
}
