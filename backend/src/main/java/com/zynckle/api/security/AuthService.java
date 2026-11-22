package com.zynckle.api.security;

import com.zynckle.api.ai.AiSettings;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Passwords (bcrypt), sessions and one-time tokens. Only SHA-256 hashes of tokens are stored,
 * so a leaked database cannot be replayed as live sessions or reset links.
 */
@Service
public class AuthService {
    private static final Duration SESSION_TTL = Duration.ofDays(14);
    private final JdbcTemplate jdbc;
    private final AiSettings settings;
    private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder(11);
    private final SecureRandom random = new SecureRandom();

    public AuthService(JdbcTemplate jdbc, AiSettings settings) {
        this.jdbc = jdbc;
        this.settings = settings;
    }

    public String hashPassword(String password) { return bcrypt.encode(password); }

    /** Constant-time check; a placeholder or empty hash never matches. */
    public boolean verifyPassword(String hash, String password) {
        if (hash == null || hash.length() != 60 || password == null) return false;
        try { return bcrypt.matches(password, hash); } catch (IllegalArgumentException e) { return false; }
    }

    public static boolean isUsableHash(String hash) { return hash != null && hash.length() == 60 && hash.startsWith("$2"); }

    public String randomToken(int bytes) {
        byte[] value = new byte[bytes];
        random.nextBytes(value);
        return HexFormat.of().formatHex(value);
    }

    public static String sha256(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    // ---- Sessions -----------------------------------------------------------------

    public String createSession(String userId, HttpServletRequest request) {
        String token = randomToken(32);
        String agent = Optional.ofNullable(request.getHeader("User-Agent")).orElse("");
        jdbc.update("INSERT INTO user_session (id, user_id, token_hash, user_agent, ip, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            randomToken(8), userId, sha256(token), agent.substring(0, Math.min(200, agent.length())), request.getRemoteAddr(), Timestamp.from(Instant.now().plus(SESSION_TTL)));
        return token;
    }

    /** Resolve a bearer token to the user and their active workspace, repairing stale selections. */
    public Optional<CurrentUser> resolve(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT s.id AS session_id, s.last_seen_at, u.id AS user_id, u.display_name, u.email, u.active_workspace_id
            FROM user_session s JOIN app_user u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP""", sha256(token));
        if (rows.isEmpty()) return Optional.empty();
        Map<String, Object> row = rows.get(0);
        String userId = (String) row.get("user_id");
        Map<String, Object> member = membership(userId, (String) row.get("active_workspace_id"));
        if (member == null) {
            List<Map<String, Object>> any = jdbc.queryForList("SELECT m.workspace_id, m.role, w.name FROM workspace_member m JOIN workspace w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY m.joined_at LIMIT 1", userId);
            if (any.isEmpty()) {
                String workspaceId = createWorkspace(userId, "Personal");
                member = Map.of("workspace_id", workspaceId, "role", "OWNER", "name", "Personal");
            } else member = any.get(0);
            jdbc.update("UPDATE app_user SET active_workspace_id = ? WHERE id = ?", member.get("workspace_id"), userId);
        }
        Object lastSeen = row.get("last_seen_at");
        if (!(lastSeen instanceof Timestamp ts) || ts.toInstant().isBefore(Instant.now().minus(Duration.ofMinutes(5)))) {
            jdbc.update("UPDATE user_session SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?", row.get("session_id"));
        }
        return Optional.of(new CurrentUser(userId, (String) row.get("display_name"), (String) row.get("email"),
            (String) member.get("workspace_id"), (String) member.get("name"), (String) member.get("role"), (String) row.get("session_id")));
    }

    public Map<String, Object> membership(String userId, String workspaceId) {
        if (workspaceId == null) return null;
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT m.workspace_id, m.role, w.name FROM workspace_member m JOIN workspace w ON w.id = m.workspace_id WHERE m.user_id = ? AND m.workspace_id = ?", userId, workspaceId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public String createWorkspace(String userId, String name) {
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO workspace (id, name, owner_id) VALUES (?, ?, ?)", id, name, userId);
        jdbc.update("INSERT INTO workspace_member (workspace_id, user_id, role) VALUES (?, ?, 'OWNER')", id, userId);
        jdbc.update("UPDATE app_user SET active_workspace_id = ? WHERE id = ?", id, userId);
        return id;
    }

    public void revokeToken(String token) { jdbc.update("DELETE FROM user_session WHERE token_hash = ?", sha256(token)); }

    public int revokeOthers(String userId, String keepSessionId) { return jdbc.update("DELETE FROM user_session WHERE user_id = ? AND id <> ?", userId, keepSessionId); }

    public void revokeAll(String userId) { jdbc.update("DELETE FROM user_session WHERE user_id = ?", userId); }

    // ---- One-time tokens (password reset, email verification) ----

    public String issueToken(String kind, String userId, Duration ttl) {
        String token = randomToken(24);
        jdbc.update("DELETE FROM one_time_token WHERE kind = ? AND user_id = ?", kind, userId);
        jdbc.update("DELETE FROM one_time_token WHERE expires_at < CURRENT_TIMESTAMP");
        jdbc.update("INSERT INTO one_time_token (token_hash, kind, user_id, expires_at) VALUES (?, ?, ?, ?)", sha256(token), kind, userId, Timestamp.from(Instant.now().plus(ttl)));
        return token;
    }

    /** Consume a token exactly once; returns the user id when it was valid and unexpired. */
    public Optional<String> consumeToken(String kind, Object token) {
        if (!(token instanceof String t) || t.isBlank()) return Optional.empty();
        String hash = sha256(t);
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT user_id, expires_at FROM one_time_token WHERE token_hash = ? AND kind = ?", hash, kind);
        if (rows.isEmpty()) return Optional.empty();
        jdbc.update("DELETE FROM one_time_token WHERE token_hash = ?", hash);
        Timestamp expires = (Timestamp) rows.get(0).get("expires_at");
        return expires.toInstant().isAfter(Instant.now()) ? Optional.of((String) rows.get(0).get("user_id")) : Optional.empty();
    }

    /** Links are only echoed in API responses during development; production relies on email. */
    public boolean exposeDevLinks() { return !"false".equalsIgnoreCase(settings.get("ZYNCKLE_EXPOSE_DEV_LINKS", "true")) && !"production".equalsIgnoreCase(settings.get("NODE_ENV")); }

    public String publicUrl() { return settings.publicUrl().replaceAll("/$", ""); }
}
