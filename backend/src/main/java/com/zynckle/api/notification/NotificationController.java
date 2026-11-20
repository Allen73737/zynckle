package com.zynckle.api.notification;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api")
public class NotificationController {
    private final JdbcTemplate jdbc;

    public NotificationController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/notifications")
    public List<Map<String, Object>> getNotifications(@RequestParam(required = false) String unread) {
        return jdbc.queryForList("""
            SELECT id, user_id AS "userId", kind, title, body, read, created_at AS "createdAt"
            FROM notification
            ORDER BY created_at DESC
        """);
    }

    @PostMapping("/notifications/{id}/read")
    public Map<String, Object> markRead(@PathVariable String id) {
        jdbc.update("UPDATE notification SET read = TRUE WHERE id = ?", id);
        return Map.of("read", true);
    }

    @GetMapping("/activity")
    public List<Map<String, Object>> getActivity() {
        List<Map<String, Object>> list = jdbc.queryForList("""
            SELECT id, actor_id AS "actorId", actor_name AS "actorName",
                   actor_avatar AS "actorAvatar", verb, entity_type AS "entityType",
                   summary, created_at AS "createdAt"
            FROM activity_log
            ORDER BY created_at DESC LIMIT 50
        """);

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : list) {
            Map<String, Object> item = new HashMap<>();
            item.put("id", row.get("id"));
            item.put("verb", row.get("verb"));
            item.put("entityType", row.get("entityType"));
            item.put("summary", row.get("summary"));
            item.put("createdAt", row.get("createdAt"));
            item.put("actor", Map.of(
                "id", row.get("actorId") != null ? row.get("actorId") : "usr-local",
                "name", row.get("actorName") != null ? row.get("actorName") : "Studio Lead",
                "email", "lead@zynckle.local",
                "avatar", row.get("actorAvatar") != null ? row.get("actorAvatar") : "SL"
            ));
            result.add(item);
        }
        return result;
    }
}
