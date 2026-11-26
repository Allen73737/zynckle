package com.zynckle.api.preview;

import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.common.Validate;
import com.zynckle.api.security.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * Website previews: an external URL, or a static site served from a Zynckle code project.
 * Visible to the whole workspace, or privately to the owner plus chosen members.
 */
@RestController
@RequestMapping("/api/previews")
public class PreviewController {
    private final JdbcTemplate jdbc;
    private final Activity activity;
    private final SiteCheck siteCheck;
    private final com.zynckle.api.common.RateLimiter limiter;

    public PreviewController(JdbcTemplate jdbc, Activity activity, SiteCheck siteCheck, com.zynckle.api.common.RateLimiter limiter) {
        this.jdbc = jdbc;
        this.activity = activity;
        this.siteCheck = siteCheck;
        this.limiter = limiter;
    }

    private static final String SELECT = """
        SELECT p.id, p.title, p.url, p.description, p.kind, p.owner_id AS "ownerId", p.owner_name AS owner,
               COALESCE(p.visibility, 'workspace') AS visibility, p.shared_with, p.project_id AS "projectId",
               pr.name AS project, p.code_project_id AS "codeProjectId", p.created_at AS "createdAt"
        FROM website_preview p LEFT JOIN project pr ON pr.id = p.project_id
        WHERE p.workspace_id = ?""";

    private static List<String> ids(Object value) {
        String s = value == null ? "" : String.valueOf(value);
        return s.isBlank() ? List.of() : List.of(s.split(","));
    }

    static boolean canSee(Map<String, Object> row, CurrentUser me) {
        return !"private".equals(row.get("visibility")) || me.userId().equals(row.get("ownerId")) || ids(row.get("shared_with")).contains(me.userId());
    }

    private static Map<String, Object> view(Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>(row);
        if (row.get("createdAt") instanceof java.sql.Timestamp t) out.put("createdAt", t.toInstant().toString());
        out.remove("shared_with");
        out.put("sharedWith", ids(row.get("shared_with")));
        return out;
    }

    private Map<String, Object> find(CurrentUser me, String id) {
        return jdbc.queryForList(SELECT + " AND p.id = ?", me.workspaceId(), id).stream().filter(r -> canSee(r, me)).findFirst().map(PreviewController::view)
            .orElseThrow(() -> new ApiException(404, "Preview not found"));
    }

    private String project(CurrentUser me, Object id) {
        if (id == null || String.valueOf(id).isBlank()) return null;
        if (jdbc.queryForList("SELECT id FROM project WHERE id = ? AND workspace_id = ?", id, me.workspaceId()).isEmpty()) throw new ApiException(400, "Project not found");
        return String.valueOf(id);
    }

    private static String httpUrl(Map<String, Object> body) {
        String url = Validate.str(body, "url", "URL", 1, 2000);
        if (!url.matches("(?i)^https?://.+")) throw new ApiException(400, "Enter a full http:// or https:// address");
        return url;
    }

    @GetMapping
    public List<Map<String, Object>> getPreviews(CurrentUser me) {
        return jdbc.queryForList(SELECT + " ORDER BY p.created_at DESC", me.workspaceId()).stream().filter(r -> canSee(r, me)).map(PreviewController::view).toList();
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> createPreview(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        String id = UUID.randomUUID().toString();
        String title = Validate.str(body, "title", "Title", 1, 120);
        String description = Objects.toString(Validate.optional(body, "description", "Description", 1000), "");
        String kind = "code-site".equals(body.get("kind")) ? "code-site" : "url";
        String codeProjectId = null;
        String url;
        if ("code-site".equals(kind)) {
            codeProjectId = String.valueOf(body.getOrDefault("codeProjectId", ""));
            if (jdbc.queryForList("SELECT id FROM code_project WHERE id = ? AND workspace_id = ?", codeProjectId, me.workspaceId()).isEmpty()) throw new ApiException(400, "Choose a code project from this workspace");
            url = "/code/" + codeProjectId; // served through a short-lived /sites link when opened
        } else url = httpUrl(body);
        jdbc.update("INSERT INTO website_preview (id, workspace_id, title, url, description, kind, owner_id, owner_name, project_id, code_project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            id, me.workspaceId(), title, url, description, kind, me.userId(), me.name(), project(me, body.get("projectId")), codeProjectId);
        activity.log(me, "added preview", "preview", title);
        return ResponseEntity.status(201).body(find(me, id));
    }

    @GetMapping("/{id}")
    public Map<String, Object> getPreview(CurrentUser me, @PathVariable String id) { return find(me, id); }

    /** Edit details, or (owner/admin only) who can see it. */
    @PatchMapping("/{id}")
    public Map<String, Object> updatePreview(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        Map<String, Object> p = find(me, id);
        if (body.containsKey("title")) jdbc.update("UPDATE website_preview SET title = ? WHERE id = ?", Validate.str(body, "title", "Title", 1, 120), id);
        if (body.containsKey("description")) jdbc.update("UPDATE website_preview SET description = ? WHERE id = ?", Objects.toString(Validate.optional(body, "description", "Description", 1000), ""), id);
        if (body.containsKey("projectId")) jdbc.update("UPDATE website_preview SET project_id = ? WHERE id = ?", project(me, body.get("projectId")), id);
        if (body.containsKey("url") && "url".equals(p.get("kind"))) jdbc.update("UPDATE website_preview SET url = ? WHERE id = ?", httpUrl(body), id);
        if (body.containsKey("visibility") || body.containsKey("sharedWith")) {
            if (!me.userId().equals(p.get("ownerId")) && !me.isAdmin()) throw new ApiException(403, "Only the owner or a workspace admin can change who sees this preview");
            String visibility = "private".equals(body.get("visibility")) ? "private" : "workspace";
            List<String> members = jdbc.queryForList("SELECT user_id FROM workspace_member WHERE workspace_id = ?", String.class, me.workspaceId());
            List<String> shared = body.get("sharedWith") instanceof List<?> list && "private".equals(visibility)
                ? list.stream().map(String::valueOf).filter(members::contains).distinct().toList() : List.of();
            jdbc.update("UPDATE website_preview SET visibility = ?, shared_with = ? WHERE id = ?", visibility, String.join(",", shared), id);
            // A private preview must not stay reachable through public links.
            if ("private".equals(visibility)) jdbc.update("DELETE FROM share_link WHERE preview_id = ?", id);
        }
        return find(me, id);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> deletePreview(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        Map<String, Object> preview = find(me, id);
        if (!me.userId().equals(preview.get("ownerId")) && !me.isAdmin()) throw new ApiException(403, "Only the owner or a workspace admin can delete this preview");
        jdbc.update("DELETE FROM share_link WHERE preview_id = ?", id);
        jdbc.update("DELETE FROM website_preview WHERE id = ? AND workspace_id = ?", id, me.workspaceId());
        return Map.of("deleted", true);
    }

    /** Reachability and framing check. The frontend posts {url}; GET ?url= also works. */
    @RequestMapping(value = "/check", method = {RequestMethod.GET, RequestMethod.POST})
    public Map<String, Object> checkPreview(CurrentUser me, @RequestParam(required = false) String url, @RequestBody(required = false) Map<String, Object> body) {
        limiter.check("preview-check:" + me.userId(), 30, 60_000);
        return siteCheck.check(url != null ? url : body == null ? null : Objects.toString(body.get("url"), null));
    }
}
