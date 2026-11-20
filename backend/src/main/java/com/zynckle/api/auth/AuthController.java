package com.zynckle.api.auth;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final JdbcTemplate jdbc;

    public AuthController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostMapping("/register")
    public ResponseEntity<Map<String, Object>> register(@RequestBody Map<String, Object> body) {
        String name = (String) body.getOrDefault("name", "Studio Lead");
        String email = ((String) body.getOrDefault("email", "lead@zynckle.local")).toLowerCase().trim();
        String userId = "usr-" + System.currentTimeMillis();
        String workspaceId = "ws-" + System.currentTimeMillis();
        String wsName = (String) body.getOrDefault("workspaceName", name + "'s studio");

        jdbc.update("""
            INSERT INTO app_user (id, email, password_hash, display_name, role)
            VALUES (?, ?, ?, ?, ?)
        """, userId, email, "$2a$10$demo", name, "OWNER");

        jdbc.update("""
            INSERT INTO workspace (id, name, owner_id)
            VALUES (?, ?, ?)
        """, workspaceId, wsName, userId);

        jdbc.update("""
            INSERT INTO workspace_member (workspace_id, user_id, role)
            VALUES (?, ?, ?)
        """, workspaceId, userId, "OWNER");

        Map<String, Object> user = Map.of(
            "id", userId,
            "name", name,
            "email", email,
            "role", "OWNER"
        );
        Map<String, Object> ws = Map.of(
            "id", workspaceId,
            "name", wsName
        );

        return ResponseEntity.status(201).body(Map.of(
            "token", "zynckle-token-" + UUID.randomUUID(),
            "user", user,
            "workspace", ws,
            "emailDelivery", false
        ));
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, Object> body) {
        String email = ((String) body.getOrDefault("email", "lead@zynckle.local")).toLowerCase().trim();
        List<Map<String, Object>> users = jdbc.queryForList("SELECT id, email, display_name AS name, role FROM app_user WHERE email = ?", email);
        Map<String, Object> user;
        if (!users.isEmpty()) {
            user = users.get(0);
        } else {
            user = Map.of(
                "id", "usr-local",
                "email", email,
                "name", "Studio Lead",
                "role", "OWNER"
            );
        }
        return Map.of(
            "token", "zynckle-token-" + UUID.randomUUID(),
            "user", user
        );
    }

    @PostMapping("/logout")
    public Map<String, Object> logout() {
        return Map.of("ok", true);
    }

    @GetMapping("/me")
    public Map<String, Object> me() {
        List<Map<String, Object>> users = jdbc.queryForList("SELECT id, email, display_name AS name, title, bio, role, preferences, notification_prefs FROM app_user LIMIT 1");
        if (!users.isEmpty()) {
            Map<String, Object> u = users.get(0);
            return Map.of(
                "id", u.get("id"),
                "name", u.get("name"),
                "email", u.get("email"),
                "title", u.get("title") != null ? u.get("title") : "Product Architect",
                "bio", u.get("bio") != null ? u.get("bio") : "",
                "role", u.get("role") != null ? u.get("role") : "OWNER",
                "emailVerified", true,
                "hasPassword", true,
                "workspace", Map.of("id", "ws-local", "name", "Zynckle Studio"),
                "preferences", Map.of("theme", "dark", "reducedMotion", false)
            );
        }
        return Map.of(
            "id", "usr-local",
            "name", "Studio Lead",
            "email", "lead@zynckle.local",
            "title", "Product Architect",
            "bio", "Designing high-precision interfaces",
            "role", "OWNER",
            "emailVerified", true,
            "hasPassword", true,
            "workspace", Map.of("id", "ws-local", "name", "Zynckle Studio"),
            "preferences", Map.of("theme", "dark")
        );
    }

    @PatchMapping("/profile")
    public Map<String, Object> updateProfile(@RequestBody Map<String, Object> body) {
        String name = (String) body.get("name");
        String title = (String) body.get("title");
        String bio = (String) body.get("bio");

        if (name != null) jdbc.update("UPDATE app_user SET display_name = ? WHERE id = 'usr-local'", name);
        if (title != null) jdbc.update("UPDATE app_user SET title = ? WHERE id = 'usr-local'", title);
        if (bio != null) jdbc.update("UPDATE app_user SET bio = ? WHERE id = 'usr-local'", bio);

        return me();
    }

    @PatchMapping("/password")
    public Map<String, Object> updatePassword(@RequestBody Map<String, Object> body) {
        return Map.of("changed", true);
    }

    @PatchMapping("/preferences")
    public Map<String, Object> updatePreferences(@RequestBody Map<String, Object> body) {
        Map<String, Object> prefs = new HashMap<>();
        prefs.put("theme", body.getOrDefault("theme", "dark"));
        if (body.containsKey("reducedMotion")) prefs.put("reducedMotion", body.get("reducedMotion"));
        if (body.containsKey("aiProvider")) prefs.put("aiProvider", body.get("aiProvider"));
        if (body.containsKey("aiModel")) prefs.put("aiModel", body.get("aiModel"));
        return prefs;
    }

    @PatchMapping("/notification-prefs")
    public Map<String, Object> updateNotificationPrefs(@RequestBody Map<String, Object> body) {
        return body;
    }

    @GetMapping("/providers")
    public Map<String, Object> providers() {
        return Map.of("password", true, "google", false, "emailDelivery", false);
    }

    @GetMapping("/sessions")
    public List<Map<String, Object>> sessions() {
        return List.of(Map.of(
            "id", "sess-active",
            "createdAt", new Date().toString(),
            "lastSeenAt", new Date().toString(),
            "userAgent", "Zynckle Studio Desktop Client",
            "ip", "127.0.0.1",
            "current", true
        ));
    }

    @DeleteMapping("/sessions/{sid}")
    public Map<String, Object> deleteSession(@PathVariable String sid) {
        return Map.of("revoked", true);
    }

    @PostMapping("/sessions/revoke-others")
    public Map<String, Object> revokeOthers() {
        return Map.of("revoked", 0);
    }

    @PostMapping("/forgot")
    public Map<String, Object> forgot(@RequestBody Map<String, Object> body) {
        return Map.of("sent", true, "emailDelivery", false, "devMode", true);
    }

    @PostMapping("/reset")
    public Map<String, Object> reset(@RequestBody Map<String, Object> body) {
        return Map.of("token", "zynckle-token-" + UUID.randomUUID());
    }

    @PostMapping("/verify")
    public Map<String, Object> verify(@RequestBody Map<String, Object> body) {
        return Map.of("verified", true, "email", "lead@zynckle.local");
    }

    @PostMapping("/verify/resend")
    public Map<String, Object> verifyResend() {
        return Map.of("sent", true, "verified", true);
    }
}
