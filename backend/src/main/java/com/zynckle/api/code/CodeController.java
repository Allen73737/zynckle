package com.zynckle.api.code;

import com.zynckle.api.ai.AiSettings;
import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.common.RateLimiter;
import com.zynckle.api.common.Validate;
import com.zynckle.api.security.CurrentUser;
import com.zynckle.api.storage.BlobStore;
import com.zynckle.api.storage.FileTypes;
import com.zynckle.api.storage.StorageController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Code projects: upload files or ZIPs, import public GitHub repositories, browse with
 * versions, search, download, and preview static sites in a sandbox.
 */
@RestController
public class CodeController {
    private static final int MAX_FILE = 1_000_000;
    private static final int MAX_FILES = 3000;
    private static final int VERSION_LIMIT = 10;
    private static final Pattern GITHUB = Pattern.compile("^https://github\\.com/([\\w.-]{1,100})/([\\w.-]{1,100}?)(?:\\.git)?/?(?:tree/([\\w./-]{1,100}))?$");

    private final JdbcTemplate jdbc;
    private final BlobStore blobs;
    private final Activity activity;
    private final StorageController storage;
    private final RateLimiter limiter;
    private final long maxZip;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build();

    public CodeController(JdbcTemplate jdbc, BlobStore blobs, Activity activity, StorageController storage, RateLimiter limiter, AiSettings settings) {
        this.jdbc = jdbc;
        this.blobs = blobs;
        this.activity = activity;
        this.storage = storage;
        this.limiter = limiter;
        this.maxZip = settings.getInt("MAX_ZIP_MB", 40) * 1_048_576L;
    }

    private static String iso(Object value) { return value instanceof Timestamp t ? t.toInstant().toString() : null; }

    // ---- Lookups and views --------------------------------------------------------------

    private Map<String, Object> project(CurrentUser me, String id) {
        return jdbc.queryForList("SELECT * FROM code_project WHERE id = ? AND workspace_id = ?", id, me.workspaceId()).stream().findFirst()
            .orElseThrow(() -> new ApiException(404, "Code project not found"));
    }

    private Map<String, Object> file(CurrentUser me, String id) {
        return jdbc.queryForList("SELECT * FROM code_file WHERE id = ? AND workspace_id = ?", id, me.workspaceId()).stream().findFirst()
            .orElseThrow(() -> new ApiException(404, "File not found"));
    }

    private Map<String, Object> projectView(Map<String, Object> p) {
        List<Map<String, Object>> files = jdbc.queryForList("SELECT path, language, size_bytes FROM code_file WHERE code_project_id = ?", p.get("id"));
        Map<String, Long> languages = new TreeMap<>();
        long size = 0;
        boolean site = false;
        for (Map<String, Object> f : files) {
            long bytes = ((Number) f.get("size_bytes")).longValue();
            size += bytes;
            String language = Objects.toString(f.get("language"), "Text");
            if (!language.equals("Text") && !language.equals("Binary")) languages.merge(language, bytes, Long::sum);
            if (String.valueOf(f.get("path")).matches("(?i)(.*/)?index\\.html?")) site = true;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", p.get("id")); out.put("name", p.get("name")); out.put("description", Objects.toString(p.get("description"), ""));
        out.put("projectId", p.get("project_id")); out.put("repoUrl", Objects.toString(p.get("repo_url"), "")); out.put("branch", p.get("branch"));
        out.put("ownerId", p.get("owner_id")); out.put("visibility", "workspace"); out.put("sharedWith", List.of()); out.put("sharedWithUsers", List.of());
        out.put("owner", jdbc.queryForList("SELECT display_name FROM app_user WHERE id = ?", String.class, p.get("owner_id")).stream().findFirst().orElse("Former member"));
        out.put("fileCount", files.size()); out.put("sizeBytes", size); out.put("languages", languages); out.put("hasSite", site);
        out.put("createdAt", iso(p.get("created_at"))); out.put("updatedAt", iso(p.get("updated_at")));
        return out;
    }

    private Map<String, Object> fileMeta(Map<String, Object> f) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", f.get("id")); out.put("codeProjectId", f.get("code_project_id")); out.put("path", f.get("path"));
        out.put("language", f.get("language")); out.put("sizeBytes", ((Number) f.get("size_bytes")).longValue()); out.put("binary", Boolean.TRUE.equals(f.get("is_binary")));
        out.put("updatedAt", iso(f.get("updated_at"))); out.put("createdAt", iso(f.get("created_at"))); out.put("updatedBy", f.get("updated_by"));
        Integer versions = jdbc.queryForObject("SELECT COUNT(*) FROM code_file_version WHERE code_file_id = ?", Integer.class, f.get("id"));
        out.put("versionCount", versions == null ? 0 : versions);
        return out;
    }

    // ---- Writes ------------------------------------------------------------------------

    /** Add or replace one file; replacing keeps the previous content as a version (last 10). */
    private boolean upsert(CurrentUser me, String projectId, String path, byte[] bytes) {
        boolean binary = FileTypes.looksBinary(path, bytes);
        String key = "code/" + me.workspaceId() + "/" + UUID.randomUUID();
        blobs.put(key, bytes);
        String language = FileTypes.LANGUAGES.getOrDefault(FileTypes.extension(path), binary ? "Binary" : "Text");
        List<Map<String, Object>> existing = jdbc.queryForList("SELECT * FROM code_file WHERE code_project_id = ? AND path = ?", projectId, path);
        if (!existing.isEmpty()) {
            Map<String, Object> old = existing.get(0);
            jdbc.update("INSERT INTO code_file_version (id, code_file_id, storage_key, size_bytes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                UUID.randomUUID().toString(), old.get("id"), old.get("storage_key"), old.get("size_bytes"), old.get("updated_by"), old.get("updated_at"));
            List<Map<String, Object>> versions = jdbc.queryForList("SELECT id, storage_key FROM code_file_version WHERE code_file_id = ? ORDER BY created_at DESC, updated_at DESC", old.get("id"));
            for (Map<String, Object> v : versions.subList(Math.min(VERSION_LIMIT, versions.size()), versions.size())) {
                blobs.delete((String) v.get("storage_key"));
                jdbc.update("DELETE FROM code_file_version WHERE id = ?", v.get("id"));
            }
            jdbc.update("UPDATE code_file SET storage_key = ?, size_bytes = ?, is_binary = ?, language = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                key, bytes.length, binary, language, me.userId(), old.get("id"));
            return true;
        }
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM code_file WHERE code_project_id = ?", Integer.class, projectId);
        if (count != null && count >= MAX_FILES) throw new ApiException(413, "Code projects are limited to " + MAX_FILES + " files");
        jdbc.update("INSERT INTO code_file (id, code_project_id, workspace_id, path, language, size_bytes, is_binary, storage_key, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            UUID.randomUUID().toString(), projectId, me.workspaceId(), path, language, bytes.length, binary, key, me.userId());
        return false;
    }

    private record Entry(String name, byte[] data) {}

    /** Read a ZIP defensively: path traversal, absolute paths and oversized entries are skipped, totals capped. */
    private List<Entry> readZip(byte[] archive, List<String> skipped) {
        List<Entry> entries = new ArrayList<>();
        long total = 0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String raw = entry.getName();
                String path = FileTypes.normalisePath(raw);
                if (path == null || raw.startsWith("/") || raw.contains("..") || path.startsWith("__MACOSX/")) { skipped.add(raw); continue; }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int n;
                boolean tooBig = false;
                while ((n = zip.read(buffer)) > 0) {
                    if (out.size() + n > MAX_FILE) { tooBig = true; break; }
                    out.write(buffer, 0, n);
                }
                if (tooBig) { skipped.add(raw + " (over 1 MB)"); continue; }
                total += out.size();
                if (total > maxZip * 3) throw new ApiException(413, "The archive expands to more than the allowed size");
                entries.add(new Entry(path, out.toByteArray()));
                if (entries.size() > MAX_FILES) throw new ApiException(413, "Archives are limited to " + MAX_FILES + " files");
            }
        } catch (IOException e) {
            throw new ApiException(400, "That file is not a valid ZIP archive");
        }
        if (entries.isEmpty() && skipped.isEmpty()) throw new ApiException(400, "The archive is empty or not a valid ZIP file");
        return entries;
    }

    private Map<String, Object> importArchive(CurrentUser me, String projectId, byte[] archive, boolean stripRoot) {
        List<String> skipped = new ArrayList<>();
        List<Entry> entries = readZip(archive, skipped);
        // GitHub archives wrap everything in a single "repo-branch/" folder.
        Set<String> roots = new HashSet<>();
        for (Entry e : entries) roots.add(e.name().split("/")[0]);
        boolean strip = (stripRoot || roots.size() == 1) && entries.stream().allMatch(e -> e.name().contains("/"));
        storage.assertQuota(me.workspaceId(), entries.stream().mapToLong(e -> e.data().length).sum());
        int added = 0, replaced = 0;
        for (Entry e : entries) {
            String path = strip ? e.name().substring(e.name().indexOf('/') + 1) : e.name();
            if (path.isEmpty()) continue;
            if (upsert(me, projectId, path, e.data())) replaced++; else added++;
        }
        jdbc.update("UPDATE code_project SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", projectId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("added", added); out.put("replaced", replaced); out.put("skipped", skipped);
        return out;
    }

    private void deleteFileData(String fileId, String key) {
        blobs.delete(key);
        for (String v : jdbc.queryForList("SELECT storage_key FROM code_file_version WHERE code_file_id = ?", String.class, fileId)) blobs.delete(v);
        jdbc.update("DELETE FROM code_file_version WHERE code_file_id = ?", fileId);
        jdbc.update("DELETE FROM code_file WHERE id = ?", fileId);
    }

    // ---- Projects ---------------------------------------------------------------------

    @GetMapping("/api/code-projects")
    public List<Map<String, Object>> list(CurrentUser me) {
        return jdbc.queryForList("SELECT * FROM code_project WHERE workspace_id = ? ORDER BY updated_at DESC", me.workspaceId()).stream().map(this::projectView).toList();
    }

    @PostMapping("/api/code-projects")
    public ResponseEntity<Map<String, Object>> create(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        String id = UUID.randomUUID().toString();
        String name = Validate.str(body, "name", "Project name", 1, 100);
        String linked = body.get("projectId") instanceof String p && !jdbc.queryForList("SELECT id FROM project WHERE id = ? AND workspace_id = ?", p, me.workspaceId()).isEmpty() ? p : null;
        jdbc.update("INSERT INTO code_project (id, workspace_id, owner_id, name, description, project_id) VALUES (?, ?, ?, ?, ?, ?)",
            id, me.workspaceId(), me.userId(), name, Objects.toString(Validate.optional(body, "description", "Description", 2000), ""), linked);
        activity.log(me, "created code project", "code", name);
        return ResponseEntity.status(201).body(projectView(project(me, id)));
    }

    @PostMapping("/api/code-projects/import-github")
    @Transactional
    public ResponseEntity<Map<String, Object>> importGithub(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        limiter.check("github:" + me.userId(), 5, 300_000);
        Matcher m = GITHUB.matcher(String.valueOf(body.getOrDefault("url", "")).trim());
        if (!m.matches()) throw new ApiException(400, "Enter a public repository URL like https://github.com/owner/repo");
        String owner = m.group(1), repo = m.group(2);
        String branch = body.get("branch") instanceof String b && !b.isBlank() ? b.trim() : m.group(3) != null ? m.group(3) : "HEAD";
        if (!branch.matches("[\\w./-]{1,100}")) throw new ApiException(400, "Branch name is invalid");
        // Only codeload.github.com is contacted, so user input cannot point the server elsewhere.
        URI uri = URI.create("https://codeload.github.com/" + owner + "/" + repo + "/zip/" + ("HEAD".equals(branch) ? "HEAD" : "refs/heads/" + branch));
        byte[] archive;
        try {
            HttpResponse<InputStream> response = http.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(60)).GET().build(), HttpResponse.BodyHandlers.ofInputStream());
            if (response.statusCode() == 404) throw new ApiException(404, "Repository or branch not found (private repositories are not supported yet)");
            if (response.statusCode() != 200) throw new ApiException(502, "GitHub could not be reached");
            try (InputStream in = response.body()) {
                archive = in.readNBytes((int) Math.min(Integer.MAX_VALUE, maxZip + 1));
            }
            if (archive.length > maxZip) throw new ApiException(413, "This repository archive is too large to import");
        } catch (IOException e) {
            throw new ApiException(502, "GitHub could not be reached");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(502, "GitHub import was interrupted");
        }
        String id = UUID.randomUUID().toString();
        String name = body.get("name") instanceof String n && !n.isBlank() ? Validate.str(body, "name", "Project name", 1, 100) : repo;
        jdbc.update("INSERT INTO code_project (id, workspace_id, owner_id, name, description, repo_url, branch) VALUES (?, ?, ?, ?, ?, ?, ?)",
            id, me.workspaceId(), me.userId(), name, "Imported from github.com/" + owner + "/" + repo + ("HEAD".equals(branch) ? "" : " (" + branch + ")"), "https://github.com/" + owner + "/" + repo, branch);
        Map<String, Object> result = new LinkedHashMap<>(importArchive(me, id, archive, true));
        activity.log(me, "imported repository", "code", owner + "/" + repo);
        result.put("project", projectView(project(me, id)));
        return ResponseEntity.status(201).body(result);
    }

    @GetMapping("/api/code-projects/{id}")
    public Map<String, Object> get(CurrentUser me, @PathVariable String id) { return projectView(project(me, id)); }

    @PatchMapping("/api/code-projects/{id}")
    public Map<String, Object> update(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        project(me, id);
        if (body.containsKey("name")) jdbc.update("UPDATE code_project SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", Validate.str(body, "name", "Project name", 1, 100), id);
        String description = Validate.optional(body, "description", "Description", 2000);
        if (description != null) jdbc.update("UPDATE code_project SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", description, id);
        if (body.containsKey("projectId")) {
            String linked = body.get("projectId") instanceof String p && !jdbc.queryForList("SELECT id FROM project WHERE id = ? AND workspace_id = ?", p, me.workspaceId()).isEmpty() ? p : null;
            jdbc.update("UPDATE code_project SET project_id = ? WHERE id = ?", linked, id);
        }
        return projectView(project(me, id));
    }

    @DeleteMapping("/api/code-projects/{id}")
    @Transactional
    public Map<String, Object> delete(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        Map<String, Object> p = project(me, id);
        if (!me.userId().equals(p.get("owner_id")) && !me.isAdmin()) throw new ApiException(403, "Only the owner or a workspace admin can delete this code project");
        for (Map<String, Object> f : jdbc.queryForList("SELECT id, storage_key FROM code_file WHERE code_project_id = ?", id)) deleteFileData((String) f.get("id"), (String) f.get("storage_key"));
        jdbc.update("DELETE FROM code_project WHERE id = ?", id);
        activity.log(me, "deleted code project", "code", String.valueOf(p.get("name")), true, null);
        return Map.of("deleted", true);
    }

    // ---- Files --------------------------------------------------------------------------

    @GetMapping("/api/code-projects/{id}/files")
    public List<Map<String, Object>> files(CurrentUser me, @PathVariable String id) {
        project(me, id);
        return jdbc.queryForList("SELECT * FROM code_file WHERE code_project_id = ? ORDER BY path", id).stream().map(this::fileMeta).toList();
    }

    @PostMapping(value = "/api/code-projects/{id}/files", consumes = "*/*")
    public ResponseEntity<Map<String, Object>> uploadFile(CurrentUser me, @PathVariable String id, @RequestHeader(value = "x-file-path", required = false) String rawPath,
                                                          @RequestBody(required = false) byte[] body) {
        me.requireEdit();
        project(me, id);
        String path;
        try { path = FileTypes.normalisePath(rawPath == null ? null : URLDecoder.decode(rawPath, StandardCharsets.UTF_8)); } catch (IllegalArgumentException e) { path = null; }
        if (path == null) throw new ApiException(400, "File path is invalid");
        byte[] bytes = body == null ? new byte[0] : body;
        if (bytes.length > MAX_FILE) throw new ApiException(413, "Files are limited to 1 MB");
        storage.assertQuota(me.workspaceId(), bytes.length);
        boolean replaced = upsert(me, id, path, bytes);
        jdbc.update("UPDATE code_project SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", id);
        Map<String, Object> out = new LinkedHashMap<>(fileMeta(jdbc.queryForList("SELECT * FROM code_file WHERE code_project_id = ? AND path = ?", id, path).get(0)));
        out.put("replaced", replaced);
        return ResponseEntity.status(replaced ? 200 : 201).body(out);
    }

    @PostMapping(value = "/api/code-projects/{id}/zip", consumes = "*/*")
    @Transactional
    public Map<String, Object> uploadZip(CurrentUser me, @PathVariable String id, @RequestBody(required = false) byte[] body) {
        me.requireEdit();
        Map<String, Object> p = project(me, id);
        if (body == null || body.length == 0) throw new ApiException(400, "Upload a ZIP archive");
        if (body.length > maxZip) throw new ApiException(413, "ZIP archives are limited to " + maxZip / 1_048_576 + " MB");
        Map<String, Object> result = importArchive(me, id, body, false);
        activity.log(me, "imported " + ((int) result.get("added") + (int) result.get("replaced")) + " files into", "code", String.valueOf(p.get("name")));
        return result;
    }

    @GetMapping("/api/code-projects/{id}/search")
    public Map<String, Object> search(CurrentUser me, @PathVariable String id, @RequestParam(defaultValue = "") String q) {
        project(me, id);
        String query = q.trim();
        if (query.length() < 2) return Map.of("query", query, "results", List.of());
        String needle = query.toLowerCase(Locale.ROOT);
        List<Map<String, Object>> results = new ArrayList<>();
        long scanned = 0;
        for (Map<String, Object> f : jdbc.queryForList("SELECT * FROM code_file WHERE code_project_id = ? AND is_binary = FALSE ORDER BY path", id)) {
            String path = String.valueOf(f.get("path"));
            boolean pathHit = path.toLowerCase(Locale.ROOT).contains(needle);
            List<Map<String, Object>> matches = new ArrayList<>();
            long size = ((Number) f.get("size_bytes")).longValue();
            if (size <= MAX_FILE && scanned < 40_000_000) {
                scanned += size;
                String[] lines = new String(blobs.get((String) f.get("storage_key")), StandardCharsets.UTF_8).split("\\r?\\n");
                for (int i = 0; i < lines.length && matches.size() < 5; i++) {
                    if (lines[i].toLowerCase(Locale.ROOT).contains(needle)) {
                        String text = lines[i].trim();
                        matches.add(Map.of("line", i + 1, "text", text.substring(0, Math.min(200, text.length()))));
                    }
                }
            }
            if (pathHit || !matches.isEmpty()) results.add(Map.of("fileId", f.get("id"), "path", path, "pathHit", pathHit, "matches", matches));
            if (results.size() >= 60) break;
        }
        return Map.of("query", query, "results", results);
    }

    @GetMapping("/api/code-projects/{id}/download")
    public ResponseEntity<byte[]> download(CurrentUser me, @PathVariable String id) throws IOException {
        Map<String, Object> p = project(me, id);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            for (Map<String, Object> f : jdbc.queryForList("SELECT path, storage_key FROM code_file WHERE code_project_id = ? ORDER BY path", id)) {
                zip.putNextEntry(new ZipEntry(String.valueOf(f.get("path"))));
                zip.write(blobs.get((String) f.get("storage_key")));
                zip.closeEntry();
            }
        }
        String name = String.valueOf(p.get("name")).replaceAll("[^\\w.-]+", "-") + ".zip";
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, "application/zip")
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + URLEncoder.encode(name, StandardCharsets.UTF_8))
            .header(HttpHeaders.CACHE_CONTROL, "no-store").body(out.toByteArray());
    }

    @GetMapping("/api/code-files/{id}")
    public Map<String, Object> readFile(CurrentUser me, @PathVariable String id, @RequestParam(required = false) Integer version) {
        Map<String, Object> f = file(me, id);
        Map<String, Object> out = new LinkedHashMap<>(fileMeta(f));
        if (Boolean.TRUE.equals(f.get("is_binary"))) { out.put("content", null); return out; }
        String key = (String) f.get("storage_key");
        if (version != null) {
            List<String> versions = jdbc.queryForList("SELECT storage_key FROM code_file_version WHERE code_file_id = ? ORDER BY created_at DESC, updated_at DESC", String.class, id);
            if (version < 0 || version >= versions.size()) throw new ApiException(404, "Version not found");
            key = versions.get(version);
        }
        out.put("content", new String(blobs.get(key), StandardCharsets.UTF_8));
        out.put("version", version);
        return out;
    }

    @GetMapping("/api/code-files/{id}/versions")
    public List<Map<String, Object>> versions(CurrentUser me, @PathVariable String id) {
        Map<String, Object> f = file(me, id);
        List<Map<String, Object>> out = new ArrayList<>();
        Map<String, Object> current = new LinkedHashMap<>();
        current.put("index", null); current.put("current", true); current.put("sizeBytes", f.get("size_bytes")); current.put("updatedAt", iso(f.get("updated_at"))); current.put("author", authorName(f.get("updated_by")));
        out.add(current);
        List<Map<String, Object>> versions = jdbc.queryForList("SELECT * FROM code_file_version WHERE code_file_id = ? ORDER BY created_at DESC, updated_at DESC", id);
        for (int i = 0; i < versions.size(); i++) {
            Map<String, Object> v = versions.get(i);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("index", i); row.put("current", false); row.put("sizeBytes", v.get("size_bytes")); row.put("updatedAt", iso(v.get("updated_at"))); row.put("author", authorName(v.get("updated_by")));
            out.add(row);
        }
        return out;
    }

    private String authorName(Object userId) {
        return jdbc.queryForList("SELECT display_name FROM app_user WHERE id = ?", String.class, userId).stream().findFirst().orElse("Former member");
    }

    @GetMapping("/api/code-files/{id}/raw")
    public ResponseEntity<byte[]> raw(CurrentUser me, @PathVariable String id) {
        Map<String, Object> f = file(me, id);
        String name = String.valueOf(f.get("path")).replaceAll(".*/", "");
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, "application/octet-stream")
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + URLEncoder.encode(name, StandardCharsets.UTF_8)).body(blobs.get((String) f.get("storage_key")));
    }

    @PatchMapping("/api/code-files/{id}")
    public Map<String, Object> rename(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        Map<String, Object> f = file(me, id);
        String path = FileTypes.normalisePath(String.valueOf(body.getOrDefault("path", "")));
        if (path == null) throw new ApiException(400, "File path is invalid");
        if (!jdbc.queryForList("SELECT id FROM code_file WHERE code_project_id = ? AND path = ? AND id <> ?", f.get("code_project_id"), path, id).isEmpty()) throw new ApiException(409, "Another file already uses that path");
        jdbc.update("UPDATE code_file SET path = ?, language = ? WHERE id = ?", path, FileTypes.LANGUAGES.getOrDefault(FileTypes.extension(path), String.valueOf(f.get("language"))), id);
        return fileMeta(file(me, id));
    }

    @DeleteMapping("/api/code-files/{id}")
    public Map<String, Object> deleteFile(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        Map<String, Object> f = file(me, id);
        deleteFileData(id, (String) f.get("storage_key"));
        return Map.of("deleted", true);
    }

    // ---- Static site preview ------------------------------------------------------------

    @GetMapping("/api/code-projects/{id}/site")
    public Map<String, Object> site(CurrentUser me, @PathVariable String id) {
        project(me, id);
        String entry = jdbc.queryForList("SELECT path FROM code_file WHERE code_project_id = ?", String.class, id).stream()
            .filter(p -> p.matches("(?i)(.*/)?index\\.html?")).min(Comparator.comparingInt(p -> p.split("/").length))
            .orElseThrow(() -> new ApiException(404, "Add an index.html file to preview this project as a static site"));
        long exp = Instant.now().getEpochSecond() + 3600;
        String token = id + "." + exp + "." + blobs.sign("site:" + id + ":" + exp);
        String encoded = String.join("/", Arrays.stream(entry.split("/")).map(s -> URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20")).toList());
        return Map.of("url", "/sites/" + token + "/" + encoded, "expiresIn", 3600, "entry", entry);
    }

    /**
     * Site files are served under a signed path so relative asset URLs keep working. The
     * response is sandboxed (opaque origin), so scripts in the site cannot reach the API.
     */
    @GetMapping("/sites/{token}/**")
    public ResponseEntity<byte[]> serveSite(@PathVariable String token, HttpServletRequest request) {
        String[] parts = token.split("\\.");
        if (parts.length != 3 || !blobs.verify("site:" + parts[0], parts[1], parts[2])) throw new ApiException(403, "This preview link has expired");
        String prefix = "/sites/" + token + "/";
        String uri = request.getRequestURI();
        String rest = uri.length() > prefix.length() ? URLDecoder.decode(uri.substring(prefix.length()), StandardCharsets.UTF_8) : "index.html";
        String path = FileTypes.normalisePath(rest);
        Map<String, Object> f = path == null ? null : jdbc.queryForList("SELECT * FROM code_file WHERE code_project_id = ? AND (path = ? OR path = ?)", parts[0], path, path + "/index.html").stream().findFirst().orElse(null);
        if (f == null) return ResponseEntity.status(404).header(HttpHeaders.CONTENT_TYPE, "text/plain;charset=utf-8").header("Content-Security-Policy", "sandbox").body("Not found in this code project".getBytes(StandardCharsets.UTF_8));
        String mime = FileTypes.mime(String.valueOf(f.get("path")));
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_TYPE, mime.startsWith("text/") ? mime + ";charset=utf-8" : mime)
            .header("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups; default-src 'self' 'unsafe-inline' data: blob: https:; connect-src https:")
            .header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "no-referrer").header(HttpHeaders.CACHE_CONTROL, "private, max-age=60")
            .body(blobs.get((String) f.get("storage_key")));
    }
}
