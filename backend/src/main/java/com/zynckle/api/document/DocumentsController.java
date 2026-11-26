package com.zynckle.api.document;

import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.common.Validate;
import com.zynckle.api.realtime.CollabSocketHandler;
import com.zynckle.api.realtime.RealtimeHub;
import com.zynckle.api.security.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Documents: folders, sharing, revisions and inline comments. Private documents are visible
 * to their owner and collaborators only; everything else to the whole workspace.
 */
@RestController
@RequestMapping("/api")
public class DocumentsController {
    private static final List<String> TYPES = List.of("rich-text", "latex", "plain-text", "markdown");
    private static final int VERSION_LIMIT = 30;
    private static final Duration AUTOSAVE_SNAPSHOT = Duration.ofMinutes(10);

    private final JdbcTemplate jdbc;
    private final Activity activity;
    private final RealtimeHub hub;
    private final CollabSocketHandler collab;

    public DocumentsController(JdbcTemplate jdbc, Activity activity, RealtimeHub hub, CollabSocketHandler collab) {
        this.jdbc = jdbc;
        this.activity = activity;
        this.hub = hub;
        this.collab = collab;
    }

    // ---- Helpers -------------------------------------------------------------------------

    public static String text(Object value) {
        if (value instanceof java.sql.Clob clob) {
            try { return clob.getSubString(1, (int) clob.length()); } catch (Exception e) { return ""; }
        }
        return value == null ? "" : String.valueOf(value);
    }

    private static String iso(Object value) { return value instanceof Timestamp t ? t.toInstant().toString() : value == null ? null : String.valueOf(value); }

    public static List<String> ids(Object value) {
        String s = value == null ? "" : String.valueOf(value);
        return s.isBlank() ? List.of() : List.of(s.split(","));
    }

    public static boolean canSee(Map<String, Object> d, CurrentUser me) {
        return !"private".equals(d.get("visibility")) || me.userId().equals(d.get("owner_id")) || ids(d.get("collaborator_ids")).contains(me.userId());
    }

    /** Who receives live events: everyone for shared documents, owner and collaborators for private ones. */
    private static List<String> audience(Map<String, Object> d) {
        if (!"private".equals(d.get("visibility"))) return null;
        List<String> out = new ArrayList<>(ids(d.get("collaborator_ids")));
        out.add(String.valueOf(d.get("owner_id")));
        return out;
    }

    private Map<String, Object> row(CurrentUser me, String id) {
        Map<String, Object> d = jdbc.queryForList("SELECT * FROM document WHERE id = ? AND workspace_id = ? AND type <> 'latex-template'", id, me.workspaceId()).stream().findFirst().orElse(null);
        if (d == null || !canSee(d, me)) throw new ApiException(404, "Document not found");
        return d;
    }

    private Map<String, Object> view(Map<String, Object> d) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", d.get("id")); out.put("title", d.get("title")); out.put("content", text(d.get("content"))); out.put("type", d.get("type"));
        out.put("folderId", d.get("folder_id")); out.put("projectId", d.get("project_id"));
        out.put("visibility", Objects.toString(d.get("visibility"), "workspace")); out.put("ownerId", d.get("owner_id"));
        out.put("owner", name(d.get("owner_id"))); out.put("collaboratorIds", ids(d.get("collaborator_ids")));
        out.put("collaborators", ids(d.get("collaborator_ids")).stream().map(uid -> Map.of("id", uid, "name", name(uid), "avatar", CurrentUser.initials(name(uid)))).toList());
        Integer comments = jdbc.queryForObject("SELECT COUNT(*) FROM doc_comment WHERE document_id = ? AND resolved = FALSE", Integer.class, d.get("id"));
        out.put("commentCount", comments == null ? 0 : comments);
        out.put("updated", iso(d.get("updated_at"))); out.put("updatedBy", d.get("updated_by")); out.put("createdAt", iso(d.get("created_at")));
        return out;
    }

    private String name(Object userId) {
        return jdbc.queryForList("SELECT display_name FROM app_user WHERE id = ?", String.class, userId).stream().findFirst().orElse("Former member");
    }

    private String folder(CurrentUser me, Object value) {
        if (!(value instanceof String id) || id.isBlank()) return null;
        if (jdbc.queryForList("SELECT id FROM doc_folder WHERE id = ? AND workspace_id = ?", id, me.workspaceId()).isEmpty()) throw new ApiException(400, "Folder not found");
        return id;
    }

    private String project(CurrentUser me, Object value) {
        if (!(value instanceof String id) || id.isBlank()) return null;
        return jdbc.queryForList("SELECT id FROM project WHERE id = ? AND workspace_id = ?", id, me.workspaceId()).isEmpty() ? null : id;
    }

    private void snapshot(String docId, String title, String content, String userId) {
        Integer last = jdbc.queryForObject("SELECT COALESCE(MAX(number), 0) FROM doc_version WHERE document_id = ?", Integer.class, docId);
        jdbc.update("INSERT INTO doc_version (id, document_id, number, title, content, created_by) VALUES (?, ?, ?, ?, ?, ?)",
            UUID.randomUUID().toString(), docId, (last == null ? 0 : last) + 1, title, content, userId);
        jdbc.update("DELETE FROM doc_version WHERE document_id = ? AND number <= ?", docId, (last == null ? 0 : last) + 1 - VERSION_LIMIT);
    }

    private void changed(CurrentUser me, Map<String, Object> d, boolean created) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("id", d.get("id")); data.put("title", d.get("title")); data.put("updated", iso(d.get("updated_at"))); data.put("updatedBy", me.userId());
        if (created) data.put("created", true);
        hub.publish(me.workspaceId(), "document.changed", data, audience(d));
    }

    // ---- Documents -------------------------------------------------------------------------

    @GetMapping("/documents")
    public List<Map<String, Object>> list(CurrentUser me) {
        return jdbc.queryForList("SELECT * FROM document WHERE workspace_id = ? AND type <> 'latex-template' ORDER BY updated_at DESC", me.workspaceId())
            .stream().filter(d -> canSee(d, me)).map(this::view).toList();
    }

    @GetMapping("/documents/{id}")
    public Map<String, Object> get(CurrentUser me, @PathVariable String id) { return view(row(me, id)); }

    /** Create, or save when the id of a document the caller can see is given. Saves snapshot a revision. */
    @PostMapping("/documents")
    @Transactional
    public Map<String, Object> save(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        String title = Validate.str(body, "title", "Document title", 1, 240);
        if (!(body.get("content") instanceof String content)) throw new ApiException(400, "Document content is required");
        if (content.getBytes(StandardCharsets.UTF_8).length > 2_000_000) throw new ApiException(413, "Document content is limited to 2 MB");
        String type = TYPES.contains(String.valueOf(body.get("type"))) ? String.valueOf(body.get("type")) : "rich-text";
        String id = body.get("id") instanceof String given && !given.isBlank() ? given : null;
        Map<String, Object> existing = id == null ? null : jdbc.queryForList("SELECT * FROM document WHERE id = ?", id).stream().findFirst().orElse(null);
        if (existing != null) {
            if (!me.workspaceId().equals(existing.get("workspace_id")) || !canSee(existing, me)) throw new ApiException(404, "Document not found");
            boolean differs = !title.equals(existing.get("title")) || !content.equals(text(existing.get("content")));
            if (differs) {
                jdbc.update("UPDATE document SET title = ?, content = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", title, content, me.userId(), id);
                boolean explicit = !Boolean.FALSE.equals(body.get("snapshot"));
                Timestamp last = jdbc.queryForList("SELECT MAX(created_at) FROM doc_version WHERE document_id = ?", Timestamp.class, id).stream().filter(Objects::nonNull).findFirst().orElse(null);
                // Autosaves keep at most one revision per 10 minutes; explicit saves always snapshot.
                if (explicit || last == null || last.toInstant().isBefore(Instant.now().minus(AUTOSAVE_SNAPSHOT))) snapshot(id, title, content, me.userId());
                if (explicit && !"private".equals(existing.get("visibility"))) activity.log(me, "saved document", "document", title);
                changed(me, row(me, id), false);
            }
            return view(row(me, id));
        }
        String newId = id != null && id.matches("[\\w-]{8,64}") ? id : UUID.randomUUID().toString();
        String visibility = "private".equals(body.get("visibility")) ? "private" : "workspace";
        jdbc.update("INSERT INTO document (id, workspace_id, title, content, type, owner_id, folder_id, project_id, visibility, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            newId, me.workspaceId(), title, content, type, me.userId(), folder(me, body.get("folderId")), project(me, body.get("projectId")), visibility, me.userId());
        snapshot(newId, title, content, me.userId());
        if (!"private".equals(visibility)) activity.log(me, "latex".equals(type) ? "created LaTeX document" : "created document", "document", title);
        changed(me, row(me, newId), true);
        return view(row(me, newId));
    }

    @PatchMapping("/documents/{id}")
    public Map<String, Object> patch(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        Map<String, Object> d = row(me, id);
        if (body.containsKey("title")) jdbc.update("UPDATE document SET title = ? WHERE id = ?", Validate.str(body, "title", "Document title", 1, 240), id);
        if (body.get("content") instanceof String content) jdbc.update("UPDATE document SET content = ?, updated_by = ? WHERE id = ?", content, me.userId(), id);
        if (body.containsKey("folderId")) jdbc.update("UPDATE document SET folder_id = ? WHERE id = ?", folder(me, body.get("folderId")), id);
        if (body.containsKey("projectId")) jdbc.update("UPDATE document SET project_id = ? WHERE id = ?", project(me, body.get("projectId")), id);
        if (body.containsKey("visibility") || body.containsKey("collaboratorIds")) {
            if (!me.userId().equals(d.get("owner_id")) && !me.isAdmin()) throw new ApiException(403, "Only the owner or a workspace admin can change sharing");
            if (body.containsKey("visibility")) jdbc.update("UPDATE document SET visibility = ? WHERE id = ?", "private".equals(body.get("visibility")) ? "private" : "workspace", id);
            if (body.get("collaboratorIds") instanceof List<?> list) {
                List<String> members = jdbc.queryForList("SELECT user_id FROM workspace_member WHERE workspace_id = ?", String.class, me.workspaceId());
                List<String> next = list.stream().map(String::valueOf).filter(members::contains).filter(x -> !x.equals(d.get("owner_id"))).distinct().limit(200).toList();
                List<String> added = next.stream().filter(x -> !ids(d.get("collaborator_ids")).contains(x)).toList();
                jdbc.update("UPDATE document SET collaborator_ids = ? WHERE id = ?", String.join(",", next), id);
                activity.notify(me, added, "file", me.name() + " shared a document with you", String.valueOf(d.get("title")), "/documents?doc=" + id);
            }
            activity.log(me, "changed sharing for", "document", String.valueOf(d.get("title")), true, null);
        }
        jdbc.update("UPDATE document SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", id);
        Map<String, Object> saved = jdbc.queryForList("SELECT * FROM document WHERE id = ?", id).get(0);
        changed(me, saved, false);
        if (!canSee(saved, me)) return Map.of("id", id, "hidden", true);
        return view(saved);
    }

    @DeleteMapping("/documents/{id}")
    @Transactional
    public Map<String, Object> delete(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        Map<String, Object> d = row(me, id);
        if (!me.userId().equals(d.get("owner_id")) && !me.isAdmin()) throw new ApiException(403, "Only the author or a workspace admin can delete this document");
        jdbc.update("DELETE FROM doc_version WHERE document_id = ?", id);
        jdbc.update("DELETE FROM share_link WHERE document_id = ?", id);
        jdbc.update("DELETE FROM doc_comment WHERE document_id = ?", id);
        jdbc.update("DELETE FROM document WHERE id = ?", id);
        collab.reset(id);
        activity.log(me, "deleted document", "document", String.valueOf(d.get("title")), true, null);
        hub.publish(me.workspaceId(), "document.deleted", Map.of("id", id), audience(d));
        return Map.of("deleted", true);
    }

    @GetMapping("/documents/{id}/versions")
    public List<Map<String, Object>> versions(CurrentUser me, @PathVariable String id) {
        row(me, id);
        return jdbc.queryForList("SELECT * FROM doc_version WHERE document_id = ? ORDER BY number DESC", id).stream().map(v -> {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", v.get("id")); out.put("title", v.get("title")); out.put("content", text(v.get("content"))); out.put("number", v.get("number"));
            out.put("createdAt", iso(v.get("created_at"))); out.put("author", name(v.get("created_by")));
            return out;
        }).toList();
    }

    // ---- Folders --------------------------------------------------------------------------

    @GetMapping("/doc-folders")
    public List<Map<String, Object>> folders(CurrentUser me) {
        return jdbc.queryForList("SELECT id, name FROM doc_folder WHERE workspace_id = ? ORDER BY name", me.workspaceId());
    }

    @PostMapping("/doc-folders")
    public ResponseEntity<Map<String, Object>> createFolder(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        String name = Validate.str(body, "name", "Folder name", 1, 80);
        if (jdbc.queryForList("SELECT name FROM doc_folder WHERE workspace_id = ?", String.class, me.workspaceId()).stream().anyMatch(name::equalsIgnoreCase)) throw new ApiException(409, "A folder with this name already exists");
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO doc_folder (id, workspace_id, name, owner_id) VALUES (?, ?, ?, ?)", id, me.workspaceId(), name, me.userId());
        return ResponseEntity.status(201).body(Map.of("id", id, "name", name));
    }

    @PatchMapping("/doc-folders/{id}")
    public Map<String, Object> renameFolder(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        String name = Validate.str(body, "name", "Folder name", 1, 80);
        if (jdbc.update("UPDATE doc_folder SET name = ? WHERE id = ? AND workspace_id = ?", name, id, me.workspaceId()) == 0) throw new ApiException(404, "Folder not found");
        return Map.of("id", id, "name", name);
    }

    @DeleteMapping("/doc-folders/{id}")
    public Map<String, Object> deleteFolder(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        if (jdbc.update("DELETE FROM doc_folder WHERE id = ? AND workspace_id = ?", id, me.workspaceId()) == 0) throw new ApiException(404, "Folder not found");
        jdbc.update("UPDATE document SET folder_id = NULL WHERE folder_id = ? AND workspace_id = ?", id, me.workspaceId());
        return Map.of("deleted", true);
    }

    // ---- Comments ---------------------------------------------------------------------------

    private Map<String, Object> commentView(CurrentUser me, Map<String, Object> c) {
        String author = name(c.get("author_id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", c.get("id")); out.put("body", c.get("body")); out.put("quote", Objects.toString(c.get("quote"), ""));
        out.put("resolved", Boolean.TRUE.equals(c.get("resolved"))); out.put("createdAt", iso(c.get("created_at")));
        out.put("author", Map.of("id", c.get("author_id"), "name", author, "avatar", CurrentUser.initials(author)));
        out.put("mine", me.userId().equals(c.get("author_id")));
        return out;
    }

    private Map<String, Object> comment(CurrentUser me, String id) {
        Map<String, Object> c = jdbc.queryForList("SELECT * FROM doc_comment WHERE id = ?", id).stream().findFirst().orElseThrow(() -> new ApiException(404, "Comment not found"));
        row(me, String.valueOf(c.get("document_id")));
        return c;
    }

    @GetMapping("/documents/{id}/comments")
    public List<Map<String, Object>> comments(CurrentUser me, @PathVariable String id) {
        row(me, id);
        return jdbc.queryForList("SELECT * FROM doc_comment WHERE document_id = ? ORDER BY created_at", id).stream().map(c -> commentView(me, c)).toList();
    }

    @PostMapping("/documents/{id}/comments")
    public ResponseEntity<Map<String, Object>> addComment(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        Map<String, Object> d = row(me, id);
        String text = Validate.str(body, "body", "Comment", 1, 4000);
        String quote = Objects.toString(Validate.optional(body, "quote", "Quote", 400), "");
        String commentId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO doc_comment (id, document_id, author_id, body, quote) VALUES (?, ?, ?, ?, ?)", commentId, id, me.userId(), text, quote);
        Set<String> notifyIds = new LinkedHashSet<>();
        notifyIds.add(String.valueOf(d.get("owner_id")));
        notifyIds.addAll(jdbc.queryForList("SELECT DISTINCT author_id FROM doc_comment WHERE document_id = ?", String.class, id));
        activity.notify(me, notifyIds, "comment", me.name() + " commented on " + d.get("title"), text.substring(0, Math.min(140, text.length())), "/documents?doc=" + id);
        hub.publish(me.workspaceId(), "doc-comment.changed", Map.of("documentId", id), audience(d));
        return ResponseEntity.status(201).body(commentView(me, comment(me, commentId)));
    }

    @PatchMapping("/doc-comments/{id}")
    public Map<String, Object> resolve(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        Map<String, Object> c = comment(me, id);
        if (body.get("resolved") instanceof Boolean resolved) jdbc.update("UPDATE doc_comment SET resolved = ? WHERE id = ?", resolved, id);
        if (body.get("body") instanceof String) {
            if (!me.userId().equals(c.get("author_id"))) throw new ApiException(403, "Only the author can edit this comment");
            jdbc.update("UPDATE doc_comment SET body = ? WHERE id = ?", Validate.str(body, "body", "Comment", 1, 4000), id);
        }
        hub.publish(me.workspaceId(), "doc-comment.changed", Map.of("documentId", c.get("document_id")), null);
        return commentView(me, comment(me, id));
    }

    @DeleteMapping("/doc-comments/{id}")
    public Map<String, Object> deleteComment(CurrentUser me, @PathVariable String id) {
        Map<String, Object> c = comment(me, id);
        if (!me.userId().equals(c.get("author_id")) && !me.isAdmin()) throw new ApiException(403, "Only the author or a workspace admin can delete this comment");
        jdbc.update("DELETE FROM doc_comment WHERE id = ?", id);
        hub.publish(me.workspaceId(), "doc-comment.changed", Map.of("documentId", c.get("document_id")), null);
        return Map.of("deleted", true);
    }
}
