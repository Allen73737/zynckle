package com.zynckle.api.workspace;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api")
public class WorkspaceController {
    private final JdbcTemplate jdbc;

    public WorkspaceController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/workspaces")
    public List<Map<String, Object>> workspaces() {
        List<Map<String, Object>> list = jdbc.queryForList("""
            SELECT w.id, w.name, w.description, w.owner_id AS "ownerId"
            FROM workspace w ORDER BY w.created_at ASC
        """);
        if (list.isEmpty()) {
            return List.of(Map.of(
                "id", "ws-local",
                "name", "Zynckle Studio",
                "role", "OWNER",
                "current", true,
                "members", 3
            ));
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (int i = 0; i < list.size(); i++) {
            Map<String, Object> row = new HashMap<>(list.get(i));
            row.put("role", "OWNER");
            row.put("current", i == 0);
            row.put("members", 3);
            result.add(row);
        }
        return result;
    }

    @PostMapping("/workspaces")
    public ResponseEntity<Map<String, Object>> createWorkspace(@RequestBody Map<String, Object> body) {
        String name = (String) body.getOrDefault("name", "New Studio");
        String wsId = "ws-" + System.currentTimeMillis();
        jdbc.update("INSERT INTO workspace (id, name, owner_id) VALUES (?, ?, ?)", wsId, name, "usr-local");
        jdbc.update("INSERT INTO workspace_member (workspace_id, user_id, role) VALUES (?, ?, ?)", wsId, "usr-local", "OWNER");
        return ResponseEntity.status(201).body(Map.of(
            "id", wsId,
            "name", name,
            "role", "OWNER",
            "current", true,
            "members", 1
        ));
    }

    @PostMapping("/workspaces/{id}/activate")
    public Map<String, Object> activate(@PathVariable String id) {
        List<Map<String, Object>> ws = jdbc.queryForList("SELECT id, name FROM workspace WHERE id = ?", id);
        if (!ws.isEmpty()) {
            return Map.of("id", ws.get(0).get("id"), "name", ws.get(0).get("name"), "role", "OWNER", "current", true);
        }
        return Map.of("id", id, "name", "Zynckle Studio", "role", "OWNER", "current", true);
    }

    @DeleteMapping("/workspaces/{id}")
    public Map<String, Object> deleteWorkspace(@PathVariable String id) {
        jdbc.update("DELETE FROM workspace WHERE id = ?", id);
        return Map.of("deleted", true);
    }

    @GetMapping("/workspace")
    public Map<String, Object> currentWorkspace() {
        List<Map<String, Object>> list = jdbc.queryForList("SELECT id, name, description FROM workspace LIMIT 1");
        if (!list.isEmpty()) {
            Map<String, Object> w = new HashMap<>(list.get(0));
            w.put("role", "OWNER");
            return w;
        }
        return Map.of("id", "ws-local", "name", "Zynckle Studio", "role", "OWNER");
    }

    @PatchMapping("/workspace")
    public Map<String, Object> updateWorkspace(@RequestBody Map<String, Object> body) {
        String name = (String) body.get("name");
        String desc = (String) body.get("description");
        if (name != null) jdbc.update("UPDATE workspace SET name = ? WHERE id = 'ws-local'", name);
        if (desc != null) jdbc.update("UPDATE workspace SET description = ? WHERE id = 'ws-local'", desc);
        return currentWorkspace();
    }

    @GetMapping("/team")
    public Map<String, Object> team() {
        return Map.of(
            "members", List.of(
                Map.of("id", "usr-local", "name", "Studio Lead", "email", "lead@zynckle.local", "avatar", "SL", "role", "OWNER", "title", "Product Architect"),
                Map.of("id", "usr-2", "name", "Sarah Chen", "email", "sarah@zynckle.local", "avatar", "SC", "role", "ADMIN", "title", "Design Lead"),
                Map.of("id", "usr-3", "name", "Marcus Vance", "email", "marcus@zynckle.local", "avatar", "MV", "role", "MEMBER", "title", "Fullstack Engineer")
            )
        );
    }

    @PostMapping("/team/invite")
    public Map<String, Object> inviteTeamMember(@RequestBody Map<String, Object> body) {
        return Map.of("invited", true, "email", body.get("email"));
    }

    @DeleteMapping("/team/{id}")
    public Map<String, Object> removeTeamMember(@PathVariable String id) {
        return Map.of("removed", true);
    }
}
