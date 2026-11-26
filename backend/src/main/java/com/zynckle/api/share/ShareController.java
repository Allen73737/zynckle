package com.zynckle.api.share;

import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.common.RateLimiter;
import com.zynckle.api.document.DocumentsController;
import com.zynckle.api.security.AuthService;
import com.zynckle.api.security.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Read-only public links for documents. The token is random and only its hash is stored;
 * links can expire and be revoked, and stop working if the document becomes private.
 */
@RestController
public class ShareController {
    private final JdbcTemplate jdbc;
    private final AuthService auth;
    private final Activity activity;
    private final RateLimiter limiter;

    public ShareController(JdbcTemplate jdbc, AuthService auth, Activity activity, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.activity = activity;
        this.limiter = limiter;
    }

    private Map<String, Object> document(CurrentUser me, String id) {
        Map<String, Object> d = jdbc.queryForList("SELECT * FROM document WHERE id = ? AND workspace_id = ?", id, me.workspaceId()).stream().findFirst().orElse(null);
        if (d == null || !DocumentsController.canSee(d, me)) throw new ApiException(404, "Document not found");
        return d;
    }

    private static Map<String, Object> view(Map<String, Object> link) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", link.get("id"));
        out.put("createdAt", link.get("created_at") instanceof Timestamp t ? t.toInstant().toString() : null);
        out.put("expiresAt", link.get("expires_at") instanceof Timestamp t ? t.toInstant().toString() : null);
        out.put("views", link.get("views"));
        return out;
    }

    @GetMapping("/api/documents/{id}/share-links")
    public List<Map<String, Object>> list(CurrentUser me, @PathVariable String id) {
        document(me, id);
        return jdbc.queryForList("SELECT * FROM share_link WHERE document_id = ? ORDER BY created_at DESC", id).stream().map(ShareController::view).toList();
    }

    @PostMapping("/api/documents/{id}/share-links")
    public ResponseEntity<Map<String, Object>> create(CurrentUser me, @PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        me.requireEdit();
        Map<String, Object> d = document(me, id);
        if ("private".equals(d.get("visibility"))) throw new ApiException(409, "Make the document visible to the workspace before sharing it publicly");
        int days = body != null && body.get("expiresInDays") instanceof Number n ? Math.max(0, Math.min(365, n.intValue())) : 30;
        String token = auth.randomToken(24);
        String linkId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO share_link (id, token_hash, workspace_id, document_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            linkId, AuthService.sha256(token), me.workspaceId(), id, me.userId(), days == 0 ? null : Timestamp.from(Instant.now().plus(Duration.ofDays(days))));
        activity.log(me, "created a public link for", "document", String.valueOf(d.get("title")), true, null);
        Map<String, Object> out = new LinkedHashMap<>(view(jdbc.queryForList("SELECT * FROM share_link WHERE id = ?", linkId).get(0)));
        out.put("url", "/share/" + token); // shown once; only the hash is stored
        return ResponseEntity.status(201).body(out);
    }

    @DeleteMapping("/api/share-links/{linkId}")
    public Map<String, Object> revoke(CurrentUser me, @PathVariable String linkId) {
        me.requireEdit();
        Map<String, Object> link = jdbc.queryForList("SELECT * FROM share_link WHERE id = ? AND workspace_id = ?", linkId, me.workspaceId()).stream().findFirst()
            .orElseThrow(() -> new ApiException(404, "Link not found"));
        document(me, String.valueOf(link.get("document_id")));
        jdbc.update("DELETE FROM share_link WHERE id = ?", linkId);
        return Map.of("revoked", true);
    }

    /** Public, unauthenticated: the shared document as read-only HTML (sanitised again in the browser). */
    @GetMapping("/api/public/share/{token}")
    public Map<String, Object> open(@PathVariable String token, HttpServletRequest request) {
        limiter.check("share:" + request.getRemoteAddr(), 120, 60_000);
        Map<String, Object> link = jdbc.queryForList("SELECT * FROM share_link WHERE token_hash = ?", AuthService.sha256(token)).stream().findFirst()
            .orElseThrow(() -> new ApiException(404, "This link is invalid or was revoked"));
        if (link.get("expires_at") instanceof Timestamp t && t.toInstant().isBefore(Instant.now())) throw new ApiException(410, "This link has expired");
        Map<String, Object> d = jdbc.queryForList("SELECT d.*, w.name AS workspace_name FROM document d JOIN workspace w ON w.id = d.workspace_id WHERE d.id = ?", link.get("document_id"))
            .stream().findFirst().orElseThrow(() -> new ApiException(404, "The shared document no longer exists"));
        if ("private".equals(d.get("visibility"))) throw new ApiException(404, "This link is invalid or was revoked");
        jdbc.update("UPDATE share_link SET views = views + 1 WHERE id = ?", link.get("id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("title", d.get("title"));
        out.put("type", d.get("type"));
        out.put("content", DocumentsController.text(d.get("content")));
        out.put("workspace", d.get("workspace_name"));
        out.put("updated", d.get("updated_at") instanceof Timestamp t ? t.toInstant().toString() : null);
        return out;
    }
}
