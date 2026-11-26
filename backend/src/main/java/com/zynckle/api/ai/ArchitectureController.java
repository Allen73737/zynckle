package com.zynckle.api.ai;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.common.Validate;
import com.zynckle.api.security.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

/** Architecture designs, shared in the workspace. Sections are written by the assistant or edited by hand. */
@RestController
@RequestMapping("/api/ai/architectures")
public class ArchitectureController {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final Activity activity;

    public ArchitectureController(JdbcTemplate jdbc, ObjectMapper json, Activity activity) {
        this.jdbc = jdbc;
        this.json = json;
        this.activity = activity;
    }

    private static String iso(Object v) { return v instanceof Timestamp t ? t.toInstant().toString() : null; }

    private Map<String, Object> sections(Object raw) {
        if (raw == null) return new LinkedHashMap<>();
        try { return json.readValue(String.valueOf(raw), new TypeReference<LinkedHashMap<String, Object>>() {}); } catch (IOException e) { return new LinkedHashMap<>(); }
    }

    private Map<String, Object> row(CurrentUser me, String id) {
        return jdbc.queryForList("SELECT * FROM ai_architecture WHERE id = ? AND workspace_id = ?", id, me.workspaceId()).stream().findFirst()
            .orElseThrow(() -> new ApiException(404, "Architecture design not found"));
    }

    private String name(Object table, Object id) {
        return jdbc.queryForList("SELECT " + ("project".equals(table) ? "name FROM project" : "display_name FROM app_user") + " WHERE id = ?", String.class, id).stream().findFirst().orElse(null);
    }

    private Map<String, Object> view(Map<String, Object> a) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", a.get("id")); out.put("title", a.get("title")); out.put("description", Objects.toString(a.get("description"), ""));
        out.put("projectId", a.get("project_id")); out.put("project", a.get("project_id") == null ? null : name("project", a.get("project_id")));
        out.put("ownerId", a.get("owner_id"));
        String owner = Objects.toString(name("user", a.get("owner_id")), "Former member");
        out.put("owner", Map.of("id", a.get("owner_id"), "name", owner, "avatar", CurrentUser.initials(owner)));
        out.put("sections", sections(a.get("sections_json")));
        out.put("createdAt", iso(a.get("created_at"))); out.put("updatedAt", iso(a.get("updated_at")));
        return out;
    }

    private String project(CurrentUser me, Object value) {
        return value instanceof String id && !id.isBlank() && !jdbc.queryForList("SELECT id FROM project WHERE id = ? AND workspace_id = ?", id, me.workspaceId()).isEmpty() ? id : null;
    }

    @GetMapping
    public List<Map<String, Object>> list(CurrentUser me) {
        return jdbc.queryForList("SELECT * FROM ai_architecture WHERE workspace_id = ? ORDER BY updated_at DESC", me.workspaceId()).stream().map(a -> {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", a.get("id")); out.put("title", a.get("title"));
            out.put("project", a.get("project_id") == null ? null : name("project", a.get("project_id")));
            out.put("updatedAt", iso(a.get("updated_at"))); out.put("sectionCount", sections(a.get("sections_json")).size());
            out.put("owner", Objects.toString(name("user", a.get("owner_id")), "Former member"));
            return out;
        }).toList();
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        String id = UUID.randomUUID().toString();
        String title = Validate.str(body, "title", "Title", 1, 120);
        jdbc.update("INSERT INTO ai_architecture (id, workspace_id, owner_id, title, description, project_id, sections_json) VALUES (?, ?, ?, ?, ?, ?, '{}')",
            id, me.workspaceId(), me.userId(), title, Objects.toString(Validate.optional(body, "description", "Description", 8000), ""), project(me, body.get("projectId")));
        activity.log(me, "started architecture design", "architecture", title);
        return ResponseEntity.status(201).body(view(row(me, id)));
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(CurrentUser me, @PathVariable String id) { return view(row(me, id)); }

    @PatchMapping("/{id}")
    public Map<String, Object> update(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) throws IOException {
        me.requireEdit();
        Map<String, Object> a = row(me, id);
        if (body.containsKey("title")) jdbc.update("UPDATE ai_architecture SET title = ? WHERE id = ?", Validate.str(body, "title", "Title", 1, 120), id);
        String description = Validate.optional(body, "description", "Description", 8000);
        if (description != null) jdbc.update("UPDATE ai_architecture SET description = ? WHERE id = ?", description, id);
        if (body.containsKey("projectId")) jdbc.update("UPDATE ai_architecture SET project_id = ? WHERE id = ?", project(me, body.get("projectId")), id);
        if (body.get("sections") instanceof Map<?, ?> changes) {
            Map<String, Object> current = sections(a.get("sections_json"));
            for (Map.Entry<?, ?> e : changes.entrySet()) {
                String key = String.valueOf(e.getKey());
                if (!Prompts.ARCHITECTURE_SECTIONS.containsKey(key)) continue;
                if (e.getValue() == null) { current.remove(key); continue; }
                String content = String.valueOf(e.getValue());
                if (content.length() > 60_000) throw new ApiException(400, "Sections are limited to 60000 characters");
                current.put(key, Map.of("content", content, "updatedAt", Instant.now().toString(), "edited", true));
            }
            jdbc.update("UPDATE ai_architecture SET sections_json = ? WHERE id = ?", json.writeValueAsString(current), id);
        }
        jdbc.update("UPDATE ai_architecture SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", id);
        return view(row(me, id));
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        Map<String, Object> a = row(me, id);
        if (!me.userId().equals(a.get("owner_id")) && !me.isAdmin()) throw new ApiException(403, "Only the author or an admin can delete this design");
        jdbc.update("DELETE FROM ai_architecture WHERE id = ?", id);
        return Map.of("deleted", true);
    }

    /** Called when the assistant finishes streaming a section for a design. */
    public void saveGeneratedSection(CurrentUser me, String id, String section, String content, String model) {
        if (!me.canEdit() || !Prompts.ARCHITECTURE_SECTIONS.containsKey(section)) return;
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT sections_json FROM ai_architecture WHERE id = ? AND workspace_id = ?", id, me.workspaceId());
        if (rows.isEmpty()) return;
        Map<String, Object> current = sections(rows.get(0).get("sections_json"));
        current.put(section, Map.of("content", content, "updatedAt", Instant.now().toString(), "model", model));
        try { jdbc.update("UPDATE ai_architecture SET sections_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", json.writeValueAsString(current), id); }
        catch (IOException ignored) { /* section stays unsaved; the user can retry */ }
    }
}
