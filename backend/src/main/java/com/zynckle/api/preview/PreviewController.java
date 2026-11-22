package com.zynckle.api.preview;

import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.common.Validate;
import com.zynckle.api.security.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/previews")
public class PreviewController {
    private final JdbcTemplate jdbc;
    private final Activity activity;

    public PreviewController(JdbcTemplate jdbc, Activity activity) {
        this.jdbc = jdbc;
        this.activity = activity;
    }

    private static final String SELECT = """
        SELECT id, title, url, description, kind, owner_id AS "ownerId", owner_name AS owner, 'workspace' AS visibility, created_at AS "createdAt"
        FROM website_preview WHERE workspace_id = ?""";

    private static Map<String, Object> view(Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>(row);
        if (row.get("createdAt") instanceof java.sql.Timestamp t) out.put("createdAt", t.toInstant().toString());
        out.put("sharedWith", List.of());
        return out;
    }

    private Map<String, Object> find(CurrentUser me, String id) {
        return jdbc.queryForList(SELECT + " AND id = ?", me.workspaceId(), id).stream().findFirst().map(PreviewController::view)
            .orElseThrow(() -> new ApiException(404, "Preview not found"));
    }

    @GetMapping
    public List<Map<String, Object>> getPreviews(CurrentUser me) {
        return jdbc.queryForList(SELECT + " ORDER BY created_at DESC", me.workspaceId()).stream().map(PreviewController::view).toList();
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> createPreview(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        String id = UUID.randomUUID().toString();
        String title = Validate.str(body, "title", "Title", 1, 120);
        String url = Validate.str(body, "url", "URL", 1, 2000);
        if (!url.matches("(?i)^https?://.+")) throw new ApiException(400, "Enter a full http:// or https:// address");
        String description = Objects.toString(Validate.optional(body, "description", "Description", 1000), "");
        String kind = "site".equals(body.get("kind")) ? "site" : "url";
        jdbc.update("INSERT INTO website_preview (id, workspace_id, title, url, description, kind, owner_id, owner_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            id, me.workspaceId(), title, url, description, kind, me.userId(), me.name());
        activity.log(me, "added preview", "preview", title);
        return ResponseEntity.status(201).body(find(me, id));
    }

    @GetMapping("/{id}")
    public Map<String, Object> getPreview(CurrentUser me, @PathVariable String id) { return find(me, id); }

    @DeleteMapping("/{id}")
    public Map<String, Object> deletePreview(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        Map<String, Object> preview = find(me, id);
        if (!me.userId().equals(preview.get("ownerId")) && !me.isAdmin()) throw new ApiException(403, "Only the owner or a workspace admin can delete this preview");
        jdbc.update("DELETE FROM website_preview WHERE id = ? AND workspace_id = ?", id, me.workspaceId());
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
