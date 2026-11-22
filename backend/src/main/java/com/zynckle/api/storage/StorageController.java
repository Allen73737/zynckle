package com.zynckle.api.storage;

import com.zynckle.api.ai.AiSettings;
import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.common.Validate;
import com.zynckle.api.security.CurrentUser;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.util.*;

/**
 * Drive: uploads, folders, sharing and storage usage. Private files are visible to their
 * owner and the members they were shared with; everything else to the whole workspace.
 */
@RestController
@RequestMapping("/api")
public class StorageController {
    private final JdbcTemplate jdbc;
    private final BlobStore blobs;
    private final Activity activity;
    private final long maxUpload;
    private final long quota;

    public StorageController(JdbcTemplate jdbc, BlobStore blobs, Activity activity, AiSettings settings) {
        this.jdbc = jdbc;
        this.blobs = blobs;
        this.activity = activity;
        this.maxUpload = settings.getInt("MAX_UPLOAD_MB", 25) * 1_048_576L;
        this.quota = settings.getInt("WORKSPACE_QUOTA_MB", 1024) * 1_048_576L;
    }

    // ---- Helpers --------------------------------------------------------------------

    static List<String> sharedWith(Object value) {
        String s = value == null ? "" : String.valueOf(value);
        return s.isBlank() ? List.of() : List.of(s.split(","));
    }

    static boolean canSee(Map<String, Object> f, CurrentUser me) {
        return !"private".equals(f.get("visibility")) || me.userId().equals(f.get("owner_id")) || sharedWith(f.get("shared_with")).contains(me.userId());
    }

    private Map<String, Object> find(CurrentUser me, String id) {
        Map<String, Object> f = jdbc.queryForList("SELECT * FROM drive_file WHERE id = ? AND workspace_id = ?", id, me.workspaceId()).stream().findFirst().orElse(null);
        if (f == null || !canSee(f, me)) throw new ApiException(404, "File not found");
        return f;
    }

    private Map<String, Object> view(Map<String, Object> f) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", f.get("id")); out.put("name", f.get("name")); out.put("folderId", f.get("folder_id")); out.put("ownerId", f.get("owner_id"));
        out.put("mimeType", f.get("mime_type")); out.put("sizeBytes", ((Number) f.get("size_bytes")).longValue());
        out.put("visibility", f.get("visibility")); out.put("sharedWith", sharedWith(f.get("shared_with")));
        out.put("owner", jdbc.queryForList("SELECT display_name FROM app_user WHERE id = ?", String.class, f.get("owner_id")).stream().findFirst().orElse("Former member"));
        out.put("createdAt", f.get("created_at") instanceof Timestamp t ? t.toInstant().toString() : null);
        out.put("updatedAt", f.get("updated_at") instanceof Timestamp t ? t.toInstant().toString() : null);
        return out;
    }

    /** Bytes used by Drive files plus code files and their versions. */
    public long usage(String workspaceId) {
        Long drive = jdbc.queryForObject("SELECT COALESCE(SUM(size_bytes), 0) FROM drive_file WHERE workspace_id = ?", Long.class, workspaceId);
        return drive + codeUsage(workspaceId);
    }

    private long codeUsage(String workspaceId) {
        Long code = jdbc.queryForObject("SELECT COALESCE(SUM(size_bytes), 0) FROM code_file WHERE workspace_id = ?", Long.class, workspaceId);
        Long versions = jdbc.queryForObject("SELECT COALESCE(SUM(v.size_bytes), 0) FROM code_file_version v JOIN code_file f ON f.id = v.code_file_id WHERE f.workspace_id = ?", Long.class, workspaceId);
        return code + versions;
    }

    public void assertQuota(String workspaceId, long adding) {
        if (usage(workspaceId) + adding > quota) throw new ApiException(413, "This workspace has reached its " + quota / 1_048_576 + " MB storage quota");
    }

    private Map<String, Object> store(CurrentUser me, String name, byte[] bytes, String folderId) {
        me.requireEdit();
        String ext = FileTypes.extension(name);
        if (FileTypes.BLOCKED.contains(ext)) throw new ApiException(415, "." + ext + " files are not allowed");
        if (bytes.length > maxUpload) throw new ApiException(413, "Files are limited to " + maxUpload / 1_048_576 + " MB");
        assertQuota(me.workspaceId(), bytes.length);
        if (folderId != null && jdbc.queryForList("SELECT id FROM drive_folder WHERE id = ? AND workspace_id = ?", folderId, me.workspaceId()).isEmpty()) throw new ApiException(400, "Folder not found");
        String id = UUID.randomUUID().toString();
        String key = "files/" + me.workspaceId() + "/" + id;
        blobs.put(key, bytes);
        jdbc.update("INSERT INTO drive_file (id, workspace_id, folder_id, owner_id, name, mime_type, size_bytes, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            id, me.workspaceId(), folderId, me.userId(), name, FileTypes.mime(name), bytes.length, key);
        activity.log(me, "uploaded", "file", name);
        return view(find(me, id));
    }

    private static String header(String value) {
        try { return value == null ? "" : URLDecoder.decode(value, StandardCharsets.UTF_8); } catch (IllegalArgumentException e) { throw new ApiException(400, "File name is invalid"); }
    }

    private static String disposition(String type, String name) {
        return type + "; filename*=UTF-8''" + URLEncoder.encode(name, StandardCharsets.UTF_8).replace("+", "%20");
    }

    // ---- Files ------------------------------------------------------------------------

    @GetMapping("/files")
    public List<Map<String, Object>> list(CurrentUser me) {
        return jdbc.queryForList("SELECT * FROM drive_file WHERE workspace_id = ? ORDER BY created_at DESC", me.workspaceId())
            .stream().filter(f -> canSee(f, me)).map(this::view).toList();
    }

    /** Streaming binary upload: the body is the raw file; name and folder travel in headers. */
    @PostMapping(value = "/files/upload", consumes = "*/*")
    public ResponseEntity<Map<String, Object>> upload(CurrentUser me, @RequestHeader(value = "x-file-name", required = false) String name,
                                                      @RequestHeader(value = "x-folder-id", required = false) String folderId, @RequestBody(required = false) byte[] body) {
        String folder = folderId == null || folderId.isBlank() ? null : folderId;
        return ResponseEntity.status(201).body(store(me, FileTypes.validName(header(name)), body == null ? new byte[0] : body, folder));
    }

    /** Small JSON uploads: text content or base64. */
    @PostMapping(value = "/files", consumes = "application/json")
    public ResponseEntity<Map<String, Object>> create(CurrentUser me, @RequestBody Map<String, Object> body) {
        String name = FileTypes.validName(String.valueOf(body.getOrDefault("name", "")));
        byte[] bytes;
        if (body.get("contentBase64") instanceof String b64) {
            try { bytes = Base64.getDecoder().decode(b64); } catch (IllegalArgumentException e) { throw new ApiException(400, "File data is invalid"); }
        } else if (body.get("content") instanceof String text) bytes = text.getBytes(StandardCharsets.UTF_8);
        else throw new ApiException(400, "File content is required");
        return ResponseEntity.status(201).body(store(me, name, bytes, body.get("folderId") instanceof String f && !f.isBlank() ? f : null));
    }

    @GetMapping("/files/{id}")
    public Map<String, Object> get(CurrentUser me, @PathVariable String id) {
        Map<String, Object> f = find(me, id);
        Map<String, Object> out = view(f);
        long size = ((Number) f.get("size_bytes")).longValue();
        if (FileTypes.isText(String.valueOf(f.get("mime_type"))) && size <= 1_500_000) out.put("content", new String(blobs.get((String) f.get("storage_key")), StandardCharsets.UTF_8));
        else out.put("url", blobs.signedPath("/api/files/" + id + "/content", "file:" + id, 600));
        return out;
    }

    @GetMapping("/files/{id}/url")
    public Map<String, Object> url(CurrentUser me, @PathVariable String id) {
        find(me, id);
        return Map.of("url", blobs.signedPath("/api/files/" + id + "/content", "file:" + id, 600), "expiresIn", 600);
    }

    /** Signed, short-lived URL usable by &lt;img&gt;, &lt;video&gt; and &lt;iframe&gt;; served sandboxed. */
    @GetMapping("/files/{id}/content")
    public ResponseEntity<byte[]> content(@PathVariable String id, @RequestParam(required = false) String exp, @RequestParam(required = false) String sig,
                                          @RequestParam(required = false) String download) {
        if (!blobs.verify("file:" + id, exp, sig)) throw new ApiException(403, "This file link has expired");
        Map<String, Object> f = jdbc.queryForList("SELECT * FROM drive_file WHERE id = ?", id).stream().findFirst().orElseThrow(() -> new ApiException(404, "File not found"));
        String mime = String.valueOf(f.get("mime_type"));
        boolean inline = mime.matches("^(image/(png|jpeg|gif|webp|svg\\+xml)|video/.*|audio/.*|application/pdf|text/plain)$") && !"1".equals(download);
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_TYPE, mime.startsWith("text/") ? mime + ";charset=utf-8" : mime)
            .header(HttpHeaders.CONTENT_DISPOSITION, disposition(inline ? "inline" : "attachment", String.valueOf(f.get("name"))))
            .header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'")
            .header("X-Content-Type-Options", "nosniff")
            .header(HttpHeaders.CACHE_CONTROL, "private, max-age=300")
            .body(blobs.get((String) f.get("storage_key")));
    }

    @GetMapping("/files/{id}/download")
    public ResponseEntity<byte[]> download(CurrentUser me, @PathVariable String id) {
        Map<String, Object> f = find(me, id);
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, "application/octet-stream")
            .header(HttpHeaders.CONTENT_DISPOSITION, disposition("attachment", String.valueOf(f.get("name"))))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store").body(blobs.get((String) f.get("storage_key")));
    }

    @PatchMapping("/files/{id}")
    public Map<String, Object> update(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        Map<String, Object> f = find(me, id);
        if (body.containsKey("name")) {
            String name = FileTypes.validName(String.valueOf(body.get("name")));
            if (FileTypes.BLOCKED.contains(FileTypes.extension(name))) throw new ApiException(415, "That file extension is not allowed");
            jdbc.update("UPDATE drive_file SET name = ?, mime_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", name, FileTypes.mime(name), id);
        }
        if (body.containsKey("folderId")) {
            String folderId = body.get("folderId") instanceof String s && !s.isBlank() ? s : null;
            if (folderId != null && jdbc.queryForList("SELECT id FROM drive_folder WHERE id = ? AND workspace_id = ?", folderId, me.workspaceId()).isEmpty()) throw new ApiException(400, "Folder not found");
            jdbc.update("UPDATE drive_file SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", folderId, id);
        }
        if (body.containsKey("visibility") || body.containsKey("sharedWith")) {
            if (!me.userId().equals(f.get("owner_id")) && !me.isAdmin()) throw new ApiException(403, "Only the owner or a workspace admin can change sharing");
            if (body.containsKey("visibility")) jdbc.update("UPDATE drive_file SET visibility = ? WHERE id = ?", "private".equals(body.get("visibility")) ? "private" : "workspace", id);
            if (body.get("sharedWith") instanceof List<?> ids) {
                List<String> members = jdbc.queryForList("SELECT user_id FROM workspace_member WHERE workspace_id = ?", String.class, me.workspaceId());
                List<String> next = ids.stream().map(String::valueOf).filter(members::contains).filter(x -> !x.equals(f.get("owner_id"))).distinct().limit(200).toList();
                List<String> added = next.stream().filter(x -> !sharedWith(f.get("shared_with")).contains(x)).toList();
                jdbc.update("UPDATE drive_file SET shared_with = ? WHERE id = ?", String.join(",", next), id);
                activity.notify(me, added, "file", me.name() + " shared a file with you", String.valueOf(f.get("name")), "/drive?file=" + id);
            }
            activity.log(me, "changed sharing for", "file", String.valueOf(f.get("name")), true, null);
        }
        return view(find(me, id));
    }

    @DeleteMapping("/files/{id}")
    public Map<String, Object> delete(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        Map<String, Object> f = find(me, id);
        if ("private".equals(f.get("visibility")) && !me.userId().equals(f.get("owner_id")) && !me.isAdmin()) throw new ApiException(403, "Only the owner or a workspace admin can delete this file");
        blobs.delete((String) f.get("storage_key"));
        jdbc.update("DELETE FROM drive_file WHERE id = ?", id);
        activity.log(me, "deleted", "file", String.valueOf(f.get("name")));
        return Map.of("deleted", true);
    }

    @GetMapping("/storage/usage")
    public Map<String, Object> storageUsage(CurrentUser me) {
        Map<String, Long> byType = new LinkedHashMap<>();
        List<Map<String, Object>> files = jdbc.queryForList("SELECT mime_type, size_bytes FROM drive_file WHERE workspace_id = ?", me.workspaceId());
        for (Map<String, Object> f : files) {
            String mime = String.valueOf(f.get("mime_type"));
            String group = mime.startsWith("image/") ? "Images" : mime.startsWith("video/") || mime.startsWith("audio/") ? "Media"
                : mime.equals("application/pdf") || mime.contains("officedocument") ? "Documents" : mime.contains("zip") ? "Archives" : FileTypes.isText(mime) ? "Text & source" : "Other";
            byType.merge(group, ((Number) f.get("size_bytes")).longValue(), Long::sum);
        }
        long code = codeUsage(me.workspaceId());
        if (code > 0) byType.put("Code projects", code);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("usedBytes", usage(me.workspaceId())); out.put("quotaBytes", quota); out.put("fileCount", files.size());
        out.put("byType", byType); out.put("driver", "local"); out.put("maxUploadBytes", maxUpload);
        return out;
    }

    // ---- Folders --------------------------------------------------------------------

    private Map<String, Object> folder(CurrentUser me, String id) {
        return jdbc.queryForList("SELECT * FROM drive_folder WHERE id = ? AND workspace_id = ?", id, me.workspaceId()).stream().findFirst().orElseThrow(() -> new ApiException(404, "Folder not found"));
    }

    private static Map<String, Object> folderView(Map<String, Object> f) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", f.get("id")); out.put("name", f.get("name")); out.put("parentId", f.get("parent_id")); out.put("ownerId", f.get("owner_id"));
        out.put("createdAt", f.get("created_at") instanceof Timestamp t ? t.toInstant().toString() : null);
        return out;
    }

    private void assertUniqueName(CurrentUser me, String parentId, String name, String exceptId) {
        boolean clash = jdbc.queryForList("SELECT id, name, parent_id FROM drive_folder WHERE workspace_id = ?", me.workspaceId()).stream()
            .anyMatch(f -> Objects.equals(f.get("parent_id"), parentId) && !Objects.equals(f.get("id"), exceptId) && String.valueOf(f.get("name")).equalsIgnoreCase(name));
        if (clash) throw new ApiException(409, "A folder with this name already exists here");
    }

    @GetMapping("/folders")
    public List<Map<String, Object>> folders(CurrentUser me) {
        return jdbc.queryForList("SELECT * FROM drive_folder WHERE workspace_id = ? ORDER BY name", me.workspaceId()).stream().map(StorageController::folderView).toList();
    }

    @PostMapping("/folders")
    public ResponseEntity<Map<String, Object>> createFolder(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        String name = Validate.str(body, "name", "Folder name", 1, 80);
        String parentId = body.get("parentId") instanceof String p && !p.isBlank() ? p : null;
        if (parentId != null) folder(me, parentId);
        assertUniqueName(me, parentId, name, null);
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO drive_folder (id, workspace_id, parent_id, name, owner_id) VALUES (?, ?, ?, ?, ?)", id, me.workspaceId(), parentId, name, me.userId());
        return ResponseEntity.status(201).body(folderView(folder(me, id)));
    }

    @PatchMapping("/folders/{id}")
    public Map<String, Object> updateFolder(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        Map<String, Object> current = folder(me, id);
        if (body.containsKey("name")) {
            String name = Validate.str(body, "name", "Folder name", 1, 80);
            assertUniqueName(me, (String) current.get("parent_id"), name, id);
            jdbc.update("UPDATE drive_folder SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", name, id);
        }
        if (body.containsKey("parentId")) {
            String parentId = body.get("parentId") instanceof String p && !p.isBlank() ? p : null;
            // Walk up from the new parent: a folder cannot be moved into itself or its own descendant.
            for (String cursor = parentId; cursor != null; cursor = (String) folder(me, cursor).get("parent_id")) {
                if (cursor.equals(id)) throw new ApiException(400, "A folder cannot be moved into itself");
            }
            jdbc.update("UPDATE drive_folder SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", parentId, id);
        }
        return folderView(folder(me, id));
    }

    @DeleteMapping("/folders/{id}")
    public Map<String, Object> deleteFolder(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        Object parent = folder(me, id).get("parent_id");
        jdbc.update("UPDATE drive_folder SET parent_id = ? WHERE parent_id = ? AND workspace_id = ?", parent, id, me.workspaceId());
        jdbc.update("UPDATE drive_file SET folder_id = ? WHERE folder_id = ? AND workspace_id = ?", parent, id, me.workspaceId());
        jdbc.update("DELETE FROM drive_folder WHERE id = ?", id);
        return Map.of("deleted", true, "contentsMoved", true);
    }
}
