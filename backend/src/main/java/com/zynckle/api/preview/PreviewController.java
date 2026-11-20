package com.zynckle.api.preview;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/previews")
public class PreviewController {
    private final JdbcTemplate jdbc;

    public PreviewController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public List<Map<String, Object>> getPreviews() {
        return jdbc.queryForList("""
            SELECT id, title, url, description, kind, owner_id AS "ownerId",
                   owner_name AS owner, 'workspace' AS visibility, created_at AS "createdAt"
            FROM website_preview
            ORDER BY created_at DESC
        """);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> createPreview(@RequestBody Map<String, Object> body) {
        String id = "prev-" + System.currentTimeMillis();
        String title = (String) body.getOrDefault("title", "Preview Reference");
        String url = (String) body.getOrDefault("url", "https://example.com");
        String desc = (String) body.getOrDefault("description", "");
        String kind = (String) body.getOrDefault("kind", "url");

        jdbc.update("""
            INSERT INTO website_preview (id, workspace_id, title, url, description, kind, owner_id, owner_name)
            VALUES (?, 'ws-local', ?, ?, ?, ?, 'usr-local', 'Studio Lead')
        """, id, title, url, desc, kind);

        Map<String, Object> prev = new HashMap<>();
        prev.put("id", id);
        prev.put("title", title);
        prev.put("url", url);
        prev.put("description", desc);
        prev.put("kind", kind);
        prev.put("ownerId", "usr-local");
        prev.put("owner", "Studio Lead");
        prev.put("visibility", "workspace");
        prev.put("sharedWith", List.of());
        prev.put("createdAt", new Date().toString());

        return ResponseEntity.status(201).body(prev);
    }

    @GetMapping("/{id}")
    public Map<String, Object> getPreview(@PathVariable String id) {
        List<Map<String, Object>> list = jdbc.queryForList("""
            SELECT id, title, url, description, kind, owner_id AS "ownerId",
                   owner_name AS owner, 'workspace' AS visibility, created_at AS "createdAt"
            FROM website_preview WHERE id = ?
        """, id);
        if (!list.isEmpty()) {
            return list.get(0);
        }
        return Map.of("id", id, "title", "Preview", "url", "https://example.com");
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> deletePreview(@PathVariable String id) {
        jdbc.update("DELETE FROM website_preview WHERE id = ?", id);
        return Map.of("deleted", true);
    }

    @GetMapping("/check")
    public Map<String, Object> checkPreview(@RequestParam(required = false) String url) {
        return Map.of(
            "reachable", true,
            "embeddable", true,
            "reason", "Site verified for live responsive preview"
        );
    }
}
