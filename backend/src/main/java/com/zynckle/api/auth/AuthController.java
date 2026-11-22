package com.zynckle.api.auth;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.common.RateLimiter;
import com.zynckle.api.common.Validate;
import com.zynckle.api.security.AuthService;
import com.zynckle.api.security.CurrentUser;
import com.zynckle.api.workspace.WorkspaceData;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.sql.Timestamp;
import java.time.Duration;
import java.util.*;

/**
 * Accounts: registration, sign-in, sessions, password reset and email verification.
 * No SMTP integration is configured, so links are logged and, in development, returned.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private static final Logger log = LoggerFactory.getLogger(AuthController.class);
    private static final List<String> NOTIFICATION_KINDS = List.of("task", "mention", "invite", "comment", "project", "file", "deadline", "team");
    /** The single-user build seeded this account; the first registration adopts it and its data. */
    private static final String LEGACY_USER = "usr-local";

    private final JdbcTemplate jdbc;
    private final AuthService auth;
    private final RateLimiter limiter;
    private final Activity activity;
    private final ObjectMapper json;

    public AuthController(JdbcTemplate jdbc, AuthService auth, RateLimiter limiter, Activity activity, ObjectMapper json) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.limiter = limiter;
        this.activity = activity;
        this.json = json;
    }

    private void authLimit(HttpServletRequest request) { limiter.check("auth:" + request.getRemoteAddr(), 12, 60_000); }

    private Map<String, Object> user(String userId) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM app_user WHERE id = ?", userId);
        if (rows.isEmpty()) throw new ApiException(404, "Account not found");
        return rows.get(0);
    }

    private Map<String, Object> readJson(Object value) {
        if (value == null) return new LinkedHashMap<>();
        try { return json.readValue(String.valueOf(value), new TypeReference<LinkedHashMap<String, Object>>() {}); } catch (IOException e) { return new LinkedHashMap<>(); }
    }

    private String writeJson(Object value) {
        try { return json.writeValueAsString(value); } catch (IOException e) { throw new IllegalStateException(e); }
    }

    private static Map<String, Object> publicUser(Map<String, Object> u) {
        String name = String.valueOf(u.get("display_name"));
        return Map.of("id", u.get("id"), "name", name, "email", u.get("email"), "avatar", CurrentUser.initials(name));
    }

    private Map<String, Object> notificationPrefs(Object stored) {
        Map<String, Object> prefs = new LinkedHashMap<>();
        for (String kind : NOTIFICATION_KINDS) prefs.put(kind, true);
        prefs.putAll(readJson(stored));
        return prefs;
    }

    private Map<String, Object> me(CurrentUser me) {
        Map<String, Object> u = user(me.userId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", me.userId());
        out.put("name", u.get("display_name"));
        out.put("email", u.get("email"));
        out.put("title", Objects.toString(u.get("title"), ""));
        out.put("bio", Objects.toString(u.get("bio"), ""));
        out.put("emailVerified", Boolean.TRUE.equals(u.get("email_verified")));
        out.put("hasPassword", AuthService.isUsableHash((String) u.get("password_hash")));
        out.put("googleLinked", false);
        out.put("role", me.role());
        out.put("preferences", readJson(u.get("preferences")));
        out.put("notificationPrefs", notificationPrefs(u.get("notification_prefs")));
        out.put("createdAt", u.get("created_at") instanceof Timestamp t ? t.toInstant().toString() : null);
        out.put("workspace", Map.of("id", me.workspaceId(), "name", me.workspaceName()));
        return out;
    }

    private String startVerification(String userId, String email) {
        String token = auth.issueToken("verify", userId, Duration.ofDays(3));
        String path = "/verify-email?token=" + token;
        log.info("[zynckle] Email verification link for {}: {}{}", email, auth.publicUrl(), path);
        return auth.exposeDevLinks() ? auth.publicUrl() + path : null;
    }

    // ---- Public endpoints -------------------------------------------------------------

    @PostMapping("/register")
    @Transactional
    public ResponseEntity<Map<String, Object>> register(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        authLimit(request);
        String name = Validate.str(body, "name", "Name", 1, 100);
        String email = Validate.email(body, "email");
        Validate.password(body.get("password"));
        if (!jdbc.queryForList("SELECT id FROM app_user WHERE email = ? AND password_hash LIKE '$2%' AND LENGTH(password_hash) = 60", email).isEmpty()) {
            throw new ApiException(409, "An account with this email already exists");
        }
        String hash = auth.hashPassword((String) body.get("password"));
        String userId;
        String workspaceId;
        String workspaceName;
        List<Map<String, Object>> legacy = jdbc.queryForList("SELECT password_hash FROM app_user WHERE id = ?", LEGACY_USER);
        boolean adoptLegacy = !legacy.isEmpty() && !AuthService.isUsableHash((String) legacy.get(0).get("password_hash"));
        if (adoptLegacy) {
            // Keep everything created before sign-in existed: this account becomes its owner.
            userId = LEGACY_USER;
            jdbc.update("DELETE FROM app_user WHERE email = ? AND id <> ?", email, LEGACY_USER);
            jdbc.update("UPDATE app_user SET email = ?, display_name = ?, password_hash = ?, email_verified = FALSE WHERE id = ?", email, name, hash, userId);
            Map<String, Object> ws = jdbc.queryForList("SELECT w.id, w.name FROM workspace w JOIN workspace_member m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY m.joined_at LIMIT 1", userId)
                .stream().findFirst().orElse(null);
            if (ws == null) { workspaceName = firstName(name) + "'s studio"; workspaceId = auth.createWorkspace(userId, workspaceName); }
            else { workspaceId = (String) ws.get("id"); workspaceName = (String) ws.get("name"); jdbc.update("UPDATE app_user SET active_workspace_id = ? WHERE id = ?", workspaceId, userId); }
        } else {
            if (!jdbc.queryForList("SELECT id FROM app_user WHERE email = ?", email).isEmpty()) throw new ApiException(409, "An account with this email already exists");
            userId = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO app_user (id, email, password_hash, display_name, email_verified, preferences, notification_prefs) VALUES (?, ?, ?, ?, FALSE, ?, '{}')",
                userId, email, hash, name, "{\"theme\":\"system\"}");
            workspaceName = body.get("workspaceName") instanceof String w && !w.isBlank() ? Validate.str(body, "workspaceName", "Workspace name", 1, 80) : firstName(name) + "'s studio";
            workspaceId = auth.createWorkspace(userId, workspaceName);
        }
        String verifyUrl = startVerification(userId, email);
        String token = auth.createSession(userId, request);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("token", token);
        out.put("user", Map.of("id", userId, "name", name, "email", email, "avatar", CurrentUser.initials(name)));
        out.put("workspace", Map.of("id", workspaceId, "name", workspaceName));
        out.put("verifyUrl", verifyUrl);
        out.put("emailDelivery", false);
        out.put("adoptedExistingWorkspace", adoptLegacy);
        return ResponseEntity.status(201).body(out);
    }

    private static String firstName(String name) { return name.trim().split("\\s+")[0]; }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        authLimit(request);
        String email = String.valueOf(body.getOrDefault("email", "")).trim().toLowerCase();
        limiter.check("login:" + email, 8, 300_000);
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM app_user WHERE email = ?", email);
        String password = String.valueOf(body.getOrDefault("password", ""));
        if (rows.isEmpty() || !auth.verifyPassword((String) rows.get(0).get("password_hash"), password)) throw new ApiException(401, "Email or password is incorrect");
        Map<String, Object> u = rows.get(0);
        return Map.of("token", auth.createSession((String) u.get("id"), request), "user", publicUser(u));
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(@RequestHeader(value = "Authorization", required = false) String header) {
        if (header != null && header.regionMatches(true, 0, "Bearer ", 0, 7)) auth.revokeToken(header.substring(7).trim());
        return Map.of("ok", true);
    }

    @PostMapping("/forgot")
    public Map<String, Object> forgot(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        authLimit(request);
        String email = String.valueOf(body.getOrDefault("email", "")).trim().toLowerCase();
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT id FROM app_user WHERE email = ?", email);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sent", true);
        out.put("emailDelivery", false);
        out.put("devMode", auth.exposeDevLinks());
        if (!rows.isEmpty()) {
            String token = auth.issueToken("reset", (String) rows.get(0).get("id"), Duration.ofHours(1));
            String path = "/reset-password?token=" + token;
            log.info("[zynckle] Password reset link for {}: {}{}", email, auth.publicUrl(), path);
            if (auth.exposeDevLinks()) out.put("resetUrl", auth.publicUrl() + path);
        }
        // Same response shape whether or not the account exists, to avoid account enumeration.
        return out;
    }

    @PostMapping("/reset")
    public Map<String, Object> reset(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        authLimit(request);
        String userId = auth.consumeToken("reset", body.get("token")).orElseThrow(() -> new ApiException(400, "This reset link is invalid or has expired. Request a new one."));
        Validate.password(body.get("password"));
        jdbc.update("UPDATE app_user SET password_hash = ?, email_verified = TRUE WHERE id = ?", auth.hashPassword((String) body.get("password")), userId);
        auth.revokeAll(userId);
        return Map.of("token", auth.createSession(userId, request));
    }

    @PostMapping("/verify")
    public Map<String, Object> verify(@RequestBody Map<String, Object> body) {
        String userId = auth.consumeToken("verify", body.get("token")).orElseThrow(() -> new ApiException(400, "This verification link is invalid or has expired"));
        jdbc.update("UPDATE app_user SET email_verified = TRUE WHERE id = ?", userId);
        return Map.of("verified", true, "email", user(userId).get("email"));
    }

    @GetMapping("/providers")
    public Map<String, Object> providers() { return Map.of("password", true, "google", false, "emailDelivery", false); }

    // ---- Signed-in account endpoints -------------------------------------------------------

    @GetMapping("/me")
    public Map<String, Object> current(CurrentUser me) { return me(me); }

    @PostMapping("/verify/resend")
    public Map<String, Object> resend(CurrentUser me) {
        limiter.check("verify:" + me.userId(), 3, 600_000);
        if (Boolean.TRUE.equals(user(me.userId()).get("email_verified"))) return Map.of("verified", true);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sent", true);
        out.put("emailDelivery", false);
        out.put("verifyUrl", startVerification(me.userId(), me.email()));
        return out;
    }

    @PatchMapping("/profile")
    public Map<String, Object> profile(CurrentUser me, @RequestBody Map<String, Object> body) {
        if (body.containsKey("name")) jdbc.update("UPDATE app_user SET display_name = ? WHERE id = ?", Validate.str(body, "name", "Name", 1, 100), me.userId());
        String title = Validate.optional(body, "title", "Title", 80);
        if (title != null) jdbc.update("UPDATE app_user SET title = ? WHERE id = ?", title, me.userId());
        String bio = Validate.optional(body, "bio", "Bio", 400);
        if (bio != null) jdbc.update("UPDATE app_user SET bio = ? WHERE id = ?", bio, me.userId());
        String verifyUrl = null;
        if (body.containsKey("email")) {
            String email = Validate.email(body, "email");
            if (!email.equals(me.email())) {
                if (!jdbc.queryForList("SELECT id FROM app_user WHERE email = ? AND id <> ?", email, me.userId()).isEmpty()) throw new ApiException(409, "That email address is already in use");
                jdbc.update("UPDATE app_user SET email = ?, email_verified = FALSE WHERE id = ?", email, me.userId());
                verifyUrl = startVerification(me.userId(), email);
            }
        }
        Map<String, Object> out = me(me);
        out.put("verifyUrl", verifyUrl);
        return out;
    }

    @PatchMapping("/password")
    public Map<String, Object> password(CurrentUser me, @RequestBody Map<String, Object> body) {
        String hash = (String) user(me.userId()).get("password_hash");
        if (AuthService.isUsableHash(hash) && !auth.verifyPassword(hash, String.valueOf(body.getOrDefault("currentPassword", "")))) throw new ApiException(401, "Current password is incorrect");
        Validate.password(body.get("newPassword"));
        jdbc.update("UPDATE app_user SET password_hash = ? WHERE id = ?", auth.hashPassword((String) body.get("newPassword")), me.userId());
        auth.revokeOthers(me.userId(), me.sessionId());
        activity.log(me, "changed their password", "account", "Password changed", true, null);
        return Map.of("changed", true);
    }

    @PatchMapping("/preferences")
    public Map<String, Object> preferences(CurrentUser me, @RequestBody Map<String, Object> body) {
        Map<String, Object> prefs = readJson(user(me.userId()).get("preferences"));
        if (body.containsKey("theme")) prefs.put("theme", Validate.oneOf(body.get("theme"), List.of("light", "dark", "system"), "Theme"));
        if (body.containsKey("aiProvider")) prefs.put("aiProvider", List.of("groq", "gemini", "openrouter", "custom", "").contains(String.valueOf(body.get("aiProvider"))) ? body.get("aiProvider") : "");
        if (body.containsKey("aiModel")) prefs.put("aiModel", String.valueOf(body.get("aiModel")).matches("[\\w.:/-]{0,100}") ? body.get("aiModel") : "");
        if (body.containsKey("aiWorkspaceContext")) prefs.put("aiWorkspaceContext", Boolean.TRUE.equals(body.get("aiWorkspaceContext")));
        if (body.containsKey("reducedMotion")) prefs.put("reducedMotion", Boolean.TRUE.equals(body.get("reducedMotion")));
        jdbc.update("UPDATE app_user SET preferences = ? WHERE id = ?", writeJson(prefs), me.userId());
        return prefs;
    }

    @PatchMapping("/notification-prefs")
    public Map<String, Object> notificationPrefs(CurrentUser me, @RequestBody Map<String, Object> body) {
        Map<String, Object> prefs = notificationPrefs(user(me.userId()).get("notification_prefs"));
        for (String kind : NOTIFICATION_KINDS) if (body.get(kind) instanceof Boolean b) prefs.put(kind, b);
        jdbc.update("UPDATE app_user SET notification_prefs = ? WHERE id = ?", writeJson(prefs), me.userId());
        return prefs;
    }

    @GetMapping("/sessions")
    public List<Map<String, Object>> sessions(CurrentUser me) {
        return jdbc.query("SELECT * FROM user_session WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP ORDER BY last_seen_at DESC", (rs, i) -> {
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("id", rs.getString("id"));
            s.put("createdAt", rs.getTimestamp("created_at").toInstant().toString());
            s.put("lastSeenAt", rs.getTimestamp("last_seen_at").toInstant().toString());
            s.put("userAgent", rs.getString("user_agent"));
            s.put("ip", rs.getString("ip"));
            s.put("current", rs.getString("id").equals(me.sessionId()));
            return s;
        }, me.userId());
    }

    @DeleteMapping("/sessions/{sid}")
    public Map<String, Object> revoke(CurrentUser me, @PathVariable String sid) {
        if (sid.equals(me.sessionId())) throw new ApiException(400, "Use sign out to end the current session");
        jdbc.update("DELETE FROM user_session WHERE id = ? AND user_id = ?", sid, me.userId());
        return Map.of("revoked", true);
    }

    @PostMapping("/sessions/revoke-others")
    public Map<String, Object> revokeOthers(CurrentUser me) { return Map.of("revoked", auth.revokeOthers(me.userId(), me.sessionId())); }

    /** Blocked while the user owns a workspace that has other members; solo workspaces go with the account. */
    @DeleteMapping("/account")
    @Transactional
    public Map<String, Object> deleteAccount(CurrentUser me, @RequestBody(required = false) Map<String, Object> body) {
        String hash = (String) user(me.userId()).get("password_hash");
        String password = body == null ? "" : String.valueOf(body.getOrDefault("password", ""));
        if (AuthService.isUsableHash(hash) && !auth.verifyPassword(hash, password)) throw new ApiException(401, "Enter your current password to confirm");
        List<String> blocked = jdbc.queryForList("""
            SELECT w.name FROM workspace w WHERE w.owner_id = ?
            AND EXISTS (SELECT 1 FROM workspace_member m WHERE m.workspace_id = w.id AND m.user_id <> ?)""", String.class, me.userId(), me.userId());
        if (!blocked.isEmpty()) throw new ApiException(409, "Transfer ownership of " + String.join(", ", blocked) + " before deleting your account");
        for (String workspaceId : jdbc.queryForList("SELECT id FROM workspace WHERE owner_id = ?", String.class, me.userId())) WorkspaceData.delete(jdbc, workspaceId);
        jdbc.update("DELETE FROM workspace_member WHERE user_id = ?", me.userId());
        jdbc.update("DELETE FROM notification WHERE user_id = ?", me.userId());
        jdbc.update("DELETE FROM ai_chat_message WHERE chat_id IN (SELECT id FROM ai_chat WHERE user_id = ?)", me.userId());
        jdbc.update("DELETE FROM ai_chat WHERE user_id = ?", me.userId());
        jdbc.update("DELETE FROM one_time_token WHERE user_id = ?", me.userId());
        jdbc.update("UPDATE task SET assignee_id = NULL WHERE assignee_id = ?", me.userId());
        auth.revokeAll(me.userId());
        jdbc.update("DELETE FROM app_user WHERE id = ?", me.userId());
        return Map.of("deleted", true);
    }
}
