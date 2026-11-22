package com.zynckle.api.workspace;

import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.common.Validate;
import com.zynckle.api.security.AuthService;
import com.zynckle.api.security.CurrentUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/** Workspaces, membership, roles, invitations and the activity feed. Roles are enforced here. */
@RestController
@RequestMapping("/api")
public class WorkspaceController {
    private static final Logger log = LoggerFactory.getLogger(WorkspaceController.class);
    private static final List<String> GRANTABLE = List.of("ADMIN", "MEMBER", "VIEWER");

    private final JdbcTemplate jdbc;
    private final AuthService auth;
    private final Activity activity;

    public WorkspaceController(JdbcTemplate jdbc, AuthService auth, Activity activity) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.activity = activity;
    }

    private static String iso(Object value) { return value instanceof Timestamp t ? t.toInstant().toString() : value == null ? null : String.valueOf(value); }

    private Map<String, Object> workspace(String id) {
        return jdbc.queryForList("SELECT * FROM workspace WHERE id = ?", id).stream().findFirst().orElseThrow(() -> new ApiException(404, "Workspace not found"));
    }

    private Map<String, Object> member(String workspaceId, String userId) {
        return jdbc.queryForList("SELECT * FROM workspace_member WHERE workspace_id = ? AND user_id = ?", workspaceId, userId).stream().findFirst().orElse(null);
    }

    // ---- Workspaces -------------------------------------------------------------------------

    @GetMapping("/workspaces")
    public List<Map<String, Object>> workspaces(CurrentUser me) {
        return jdbc.queryForList("""
            SELECT w.id, w.name, w.owner_id, m.role, (SELECT COUNT(*) FROM workspace_member x WHERE x.workspace_id = w.id) AS members
            FROM workspace_member m JOIN workspace w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY m.joined_at""", me.userId())
            .stream().map(w -> {
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("id", w.get("id")); out.put("name", w.get("name")); out.put("role", w.get("role")); out.put("ownerId", w.get("owner_id"));
                out.put("current", me.workspaceId().equals(w.get("id"))); out.put("members", ((Number) w.get("members")).intValue());
                return out;
            }).toList();
    }

    @PostMapping("/workspaces")
    public ResponseEntity<Map<String, Object>> create(CurrentUser me, @RequestBody Map<String, Object> body) {
        String name = Validate.str(body, "name", "Workspace name", 1, 80);
        Integer owned = jdbc.queryForObject("SELECT COUNT(*) FROM workspace_member WHERE user_id = ? AND role = 'OWNER'", Integer.class, me.userId());
        if (owned != null && owned >= 20) throw new ApiException(400, "You can own up to 20 workspaces");
        String id = auth.createWorkspace(me.userId(), name);
        return ResponseEntity.status(201).body(Map.of("id", id, "name", name, "role", "OWNER", "current", true, "ownerId", me.userId()));
    }

    @PostMapping("/workspaces/{id}/activate")
    public Map<String, Object> activate(CurrentUser me, @PathVariable String id) {
        Map<String, Object> m = member(id, me.userId());
        if (m == null) throw new ApiException(403, "You are not a member of this workspace");
        jdbc.update("UPDATE app_user SET active_workspace_id = ? WHERE id = ?", id, me.userId());
        return Map.of("id", id, "name", workspace(id).get("name"), "role", m.get("role"), "current", true);
    }

    @DeleteMapping("/workspaces/{id}")
    @Transactional
    public Map<String, Object> delete(CurrentUser me, @PathVariable String id) {
        if (member(id, me.userId()) == null) throw new ApiException(404, "Workspace not found");
        if (!me.userId().equals(workspace(id).get("owner_id"))) throw new ApiException(403, "Only the workspace owner can delete it");
        Integer others = jdbc.queryForObject("SELECT COUNT(*) FROM workspace_member WHERE workspace_id = ? AND user_id <> ?", Integer.class, id, me.userId());
        if (others != null && others > 0) throw new ApiException(409, "Remove workspace members or transfer ownership before deleting this workspace");
        Integer elsewhere = jdbc.queryForObject("SELECT COUNT(*) FROM workspace_member WHERE user_id = ? AND workspace_id <> ?", Integer.class, me.userId(), id);
        if (elsewhere == null || elsewhere == 0) throw new ApiException(409, "Create another workspace before deleting your only workspace");
        WorkspaceData.delete(jdbc, id);
        return Map.of("deleted", true);
    }

    @GetMapping("/workspace")
    public Map<String, Object> current(CurrentUser me) {
        Map<String, Object> w = workspace(me.workspaceId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", w.get("id")); out.put("name", w.get("name")); out.put("description", Objects.toString(w.get("description"), ""));
        out.put("ownerId", w.get("owner_id")); out.put("role", me.role()); out.put("createdAt", iso(w.get("created_at")));
        return out;
    }

    @PatchMapping("/workspace")
    public Map<String, Object> update(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireAdmin();
        if (body.containsKey("name")) jdbc.update("UPDATE workspace SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", Validate.str(body, "name", "Workspace name", 1, 80), me.workspaceId());
        String description = Validate.optional(body, "description", "Description", 400);
        if (description != null) jdbc.update("UPDATE workspace SET description = ? WHERE id = ?", description, me.workspaceId());
        activity.log(me, "updated workspace settings", "workspace", me.workspaceName(), true, null);
        return current(me);
    }

    @PostMapping("/workspace/transfer")
    @Transactional
    public Map<String, Object> transfer(CurrentUser me, @RequestBody Map<String, Object> body) {
        if (!me.userId().equals(workspace(me.workspaceId()).get("owner_id"))) throw new ApiException(403, "Only the owner can transfer ownership");
        String target = String.valueOf(body.getOrDefault("userId", ""));
        if (target.equals(me.userId()) || member(me.workspaceId(), target) == null) throw new ApiException(400, "Choose another workspace member");
        jdbc.update("UPDATE workspace_member SET role = 'OWNER' WHERE workspace_id = ? AND user_id = ?", me.workspaceId(), target);
        jdbc.update("UPDATE workspace_member SET role = 'ADMIN' WHERE workspace_id = ? AND user_id = ?", me.workspaceId(), me.userId());
        jdbc.update("UPDATE workspace SET owner_id = ? WHERE id = ?", target, me.workspaceId());
        activity.log(me, "transferred ownership", "workspace", me.workspaceName(), true, null);
        activity.notify(me, List.of(target), "team", "You are now the workspace owner", me.workspaceName(), "/team");
        return Map.of("transferred", true);
    }

    @PostMapping("/workspace/leave")
    public Map<String, Object> leave(CurrentUser me) {
        if (me.userId().equals(workspace(me.workspaceId()).get("owner_id"))) throw new ApiException(409, "Transfer ownership before leaving this workspace");
        jdbc.update("DELETE FROM workspace_member WHERE workspace_id = ? AND user_id = ?", me.workspaceId(), me.userId());
        jdbc.update("UPDATE app_user SET active_workspace_id = NULL WHERE id = ?", me.userId());
        activity.log(me, "left the workspace", "workspace", me.workspaceName());
        return Map.of("left", true);
    }

    // ---- Team & invitations ----------------------------------------------------------------

    @GetMapping("/team")
    public Map<String, Object> team(CurrentUser me) {
        List<Map<String, Object>> members = jdbc.queryForList("""
            SELECT u.id, u.display_name, u.email, u.title, m.role, m.joined_at
            FROM workspace_member m JOIN app_user u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.joined_at""", me.workspaceId())
            .stream().map(r -> {
                Map<String, Object> out = new LinkedHashMap<>();
                String name = String.valueOf(r.get("display_name"));
                out.put("id", r.get("id")); out.put("name", name); out.put("email", r.get("email")); out.put("avatar", CurrentUser.initials(name));
                out.put("title", Objects.toString(r.get("title"), "")); out.put("role", r.get("role")); out.put("joinedAt", iso(r.get("joined_at")));
                return out;
            }).toList();
        List<Map<String, Object>> invites = !me.isAdmin() ? List.of() : jdbc.queryForList("""
            SELECT i.*, u.display_name AS invited_by_name FROM invitation i LEFT JOIN app_user u ON u.id = i.invited_by
            WHERE i.workspace_id = ? AND i.expires_at > CURRENT_TIMESTAMP ORDER BY i.created_at DESC""", me.workspaceId())
            .stream().map(i -> {
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("id", i.get("id")); out.put("email", i.get("email")); out.put("role", i.get("role"));
                out.put("createdAt", iso(i.get("created_at"))); out.put("expiresAt", iso(i.get("expires_at")));
                out.put("inviteUrl", i.get("invite_url")); out.put("invitedBy", i.get("invited_by_name"));
                return out;
            }).toList();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("members", members);
        out.put("invites", invites);
        out.put("role", me.role());
        out.put("ownerId", workspace(me.workspaceId()).get("owner_id"));
        out.put("currentUserId", me.userId());
        return out;
    }

    @PatchMapping("/team/members/{id}")
    public Map<String, Object> changeRole(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireAdmin();
        Map<String, Object> target = member(me.workspaceId(), id);
        if (target == null) throw new ApiException(404, "Workspace member not found");
        if ("OWNER".equals(target.get("role"))) throw new ApiException(403, "Use ownership transfer to change the owner");
        if ("ADMIN".equals(me.role()) && "ADMIN".equals(target.get("role"))) throw new ApiException(403, "Only the workspace owner can manage another admin");
        String role = Validate.oneOf(body.get("role"), GRANTABLE, "Role");
        if ("ADMIN".equals(me.role()) && "ADMIN".equals(role)) throw new ApiException(403, "Only the workspace owner can grant admin role");
        jdbc.update("UPDATE workspace_member SET role = ? WHERE workspace_id = ? AND user_id = ?", role, me.workspaceId(), id);
        activity.log(me, "changed role to " + role + " for", "member", nameOf(id), true, null);
        activity.notify(me, List.of(id), "team", "Your workspace role changed", me.workspaceName() + ": " + role.toLowerCase(), "/team");
        return Map.of("id", id, "role", role);
    }

    @DeleteMapping("/team/members/{id}")
    public Map<String, Object> removeMember(CurrentUser me, @PathVariable String id) {
        me.requireAdmin();
        Map<String, Object> target = member(me.workspaceId(), id);
        if (target == null) throw new ApiException(404, "Workspace member not found");
        if (id.equals(me.userId())) throw new ApiException(403, "Use “Leave workspace” to remove yourself");
        if ("OWNER".equals(target.get("role"))) throw new ApiException(403, "The workspace owner cannot be removed");
        if ("ADMIN".equals(me.role()) && "ADMIN".equals(target.get("role"))) throw new ApiException(403, "Only the workspace owner can remove an admin");
        jdbc.update("DELETE FROM workspace_member WHERE workspace_id = ? AND user_id = ?", me.workspaceId(), id);
        jdbc.update("UPDATE task SET assignee_id = NULL WHERE assignee_id = ? AND project_id IN (SELECT id FROM project WHERE workspace_id = ?)", id, me.workspaceId());
        jdbc.update("UPDATE app_user SET active_workspace_id = NULL WHERE id = ? AND active_workspace_id = ?", id, me.workspaceId());
        activity.log(me, "removed", "member", nameOf(id), true, null);
        return Map.of("removed", true);
    }

    private String nameOf(String userId) {
        return jdbc.queryForList("SELECT display_name FROM app_user WHERE id = ?", String.class, userId).stream().findFirst().orElse("Former member");
    }

    @PostMapping("/team/invitations")
    public ResponseEntity<Map<String, Object>> invite(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireAdmin();
        String email = Validate.email(body, "email");
        String role = GRANTABLE.contains(String.valueOf(body.get("role"))) ? String.valueOf(body.get("role")) : "MEMBER";
        if ("ADMIN".equals(role) && !"OWNER".equals(me.role())) throw new ApiException(403, "Only the owner can invite admins");
        List<String> existing = jdbc.queryForList("SELECT id FROM app_user WHERE email = ?", String.class, email);
        if (!existing.isEmpty() && member(me.workspaceId(), existing.get(0)) != null) throw new ApiException(409, "That person is already a member");
        jdbc.update("DELETE FROM invitation WHERE workspace_id = ? AND email = ?", me.workspaceId(), email);
        String token = auth.randomToken(24);
        String id = UUID.randomUUID().toString();
        String inviteUrl = "/team?invite=" + token;
        Timestamp expires = Timestamp.from(Instant.now().plus(Duration.ofDays(7)));
        jdbc.update("INSERT INTO invitation (id, workspace_id, email, role, token_hash, invite_url, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            id, me.workspaceId(), email, role, AuthService.sha256(token), inviteUrl, me.userId(), expires);
        if (!existing.isEmpty()) {
            jdbc.update("INSERT INTO notification (id, user_id, workspace_id, kind, title, body, link) VALUES (?, ?, ?, 'invite', ?, ?, ?)",
                UUID.randomUUID().toString(), existing.get(0), me.workspaceId(), "Invitation to join " + me.workspaceName(), me.name() + " invited you as " + role.toLowerCase() + ".", inviteUrl);
        }
        activity.log(me, "invited", "invite", email, true, null);
        log.info("[zynckle] Invite for {}: {}{}", email, auth.publicUrl(), inviteUrl);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id); out.put("email", email); out.put("role", role); out.put("inviteUrl", inviteUrl);
        out.put("createdAt", Instant.now().toString()); out.put("expiresAt", expires.toInstant().toString()); out.put("emailDelivery", false);
        return ResponseEntity.status(201).body(out);
    }

    @PostMapping("/team/invitations/accept")
    @Transactional
    public Map<String, Object> accept(CurrentUser me, @RequestBody Map<String, Object> body) {
        String hash = AuthService.sha256(String.valueOf(body.getOrDefault("token", "")));
        Map<String, Object> invite = jdbc.queryForList("SELECT * FROM invitation WHERE token_hash = ?", hash).stream().findFirst()
            .orElseThrow(() -> new ApiException(404, "This invite is invalid or was revoked"));
        if (((Timestamp) invite.get("expires_at")).toInstant().isBefore(Instant.now())) {
            jdbc.update("DELETE FROM invitation WHERE id = ?", invite.get("id"));
            throw new ApiException(410, "This invite has expired");
        }
        if (!String.valueOf(invite.get("email")).equalsIgnoreCase(me.email())) throw new ApiException(403, "This invite was sent to " + invite.get("email") + ". Sign in with that address to accept it.");
        String workspaceId = (String) invite.get("workspace_id");
        Map<String, Object> ws = workspace(workspaceId);
        Map<String, Object> existing = member(workspaceId, me.userId());
        if (existing == null) jdbc.update("INSERT INTO workspace_member (workspace_id, user_id, role) VALUES (?, ?, ?)", workspaceId, me.userId(), invite.get("role"));
        else if (!"OWNER".equals(existing.get("role"))) jdbc.update("UPDATE workspace_member SET role = ? WHERE workspace_id = ? AND user_id = ?", invite.get("role"), workspaceId, me.userId());
        jdbc.update("DELETE FROM invitation WHERE id = ?", invite.get("id"));
        jdbc.update("UPDATE app_user SET active_workspace_id = ? WHERE id = ?", workspaceId, me.userId());
        CurrentUser joined = new CurrentUser(me.userId(), me.name(), me.email(), workspaceId, String.valueOf(ws.get("name")), String.valueOf(invite.get("role")), me.sessionId());
        activity.log(joined, "joined the workspace", "member", me.name());
        List<String> others = jdbc.queryForList("SELECT user_id FROM workspace_member WHERE workspace_id = ?", String.class, workspaceId);
        activity.notify(joined, others, "team", "New teammate joined", me.name() + " joined " + ws.get("name"), "/team");
        return Map.of("workspace", Map.of("id", workspaceId, "name", ws.get("name")), "role", invite.get("role"));
    }

    @DeleteMapping("/team/invitations/{id}")
    public Map<String, Object> revokeInvite(CurrentUser me, @PathVariable String id) {
        me.requireAdmin();
        jdbc.update("DELETE FROM invitation WHERE id = ? AND workspace_id = ?", id, me.workspaceId());
        return Map.of("deleted", true);
    }

    // ---- Activity & audit ------------------------------------------------------------------------

    private List<Map<String, Object>> activityRows(String sql, Object... args) {
        return jdbc.queryForList(sql, args).stream().map(row -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", row.get("id")); item.put("verb", row.get("verb")); item.put("entityType", row.get("entity_type"));
            item.put("summary", row.get("summary")); item.put("projectId", row.get("project_id")); item.put("audit", Boolean.TRUE.equals(row.get("audit")));
            item.put("createdAt", iso(row.get("created_at")));
            String name = Objects.toString(row.get("actor_name"), "Former member");
            item.put("actor", Map.of("id", Objects.toString(row.get("actor_id"), ""), "name", name, "email", "", "avatar", Objects.toString(row.get("actor_avatar"), CurrentUser.initials(name))));
            return item;
        }).toList();
    }

    @GetMapping("/activity")
    public List<Map<String, Object>> activity(CurrentUser me, @RequestParam(required = false) String projectId, @RequestParam(defaultValue = "30") int limit) {
        int n = Math.max(1, Math.min(100, limit));
        // Audit entries are visible to admins and to the person who performed them.
        String visible = me.isAdmin() ? "" : " AND (COALESCE(audit, FALSE) = FALSE OR actor_id = ?)";
        List<Object> args = new ArrayList<>(List.of(me.workspaceId()));
        if (!me.isAdmin()) args.add(me.userId());
        String byProject = "";
        if (projectId != null && !projectId.isBlank()) { byProject = " AND project_id = ?"; args.add(projectId); }
        args.add(n);
        return activityRows("SELECT * FROM activity_log WHERE workspace_id = ?" + visible + byProject + " ORDER BY created_at DESC LIMIT ?", args.toArray());
    }

    @GetMapping("/audit")
    public List<Map<String, Object>> audit(CurrentUser me) {
        me.requireAdmin();
        return activityRows("SELECT * FROM activity_log WHERE workspace_id = ? AND audit = TRUE ORDER BY created_at DESC LIMIT 200", me.workspaceId());
    }
}
