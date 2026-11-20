package com.zynckle.api.project;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {
    private final JdbcTemplate jdbc;

    public ProjectController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public List<Map<String, Object>> getProjects() {
        List<Map<String, Object>> list = jdbc.queryForList("""
            SELECT id, name, description, status, due_date AS due, created_at, updated_at
            FROM project ORDER BY updated_at DESC
        """);
        List<Map<String, Object>> res = new ArrayList<>();
        for (Map<String, Object> p : list) {
            Map<String, Object> map = new HashMap<>(p);
            map.put("color", "color-amber");
            map.put("progress", 50);
            map.put("members", 3);
            map.put("tags", List.of());
            res.add(map);
        }
        return res;
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> createProject(@RequestBody Map<String, Object> body) {
        String id = "p-" + System.currentTimeMillis();
        String name = (String) body.getOrDefault("name", "New Project");
        String description = (String) body.getOrDefault("description", "");
        String status = (String) body.getOrDefault("status", "Planning");
        String due = (String) body.getOrDefault("due", "Not set");

        jdbc.update("""
            INSERT INTO project (id, workspace_id, name, description, status, due_date, created_by)
            VALUES (?, 'ws-local', ?, ?, ?, ?, 'usr-local')
        """, id, name, description, status, due);

        Map<String, Object> p = new HashMap<>();
        p.put("id", id);
        p.put("name", name);
        p.put("description", description);
        p.put("status", status);
        p.put("due", due);
        p.put("color", "color-amber");
        p.put("progress", 0);
        p.put("members", 1);
        p.put("tags", List.of());

        return ResponseEntity.status(201).body(p);
    }

    @GetMapping("/{id}")
    public Map<String, Object> getProject(@PathVariable String id) {
        List<Map<String, Object>> list = jdbc.queryForList("""
            SELECT id, name, description, status, due_date AS due, created_at, updated_at
            FROM project WHERE id = ?
        """, id);
        if (!list.isEmpty()) {
            Map<String, Object> map = new HashMap<>(list.get(0));
            map.put("color", "color-amber");
            map.put("progress", 50);
            map.put("members", 3);
            map.put("tags", List.of());
            return map;
        }
        return Map.of("id", id, "name", "Project", "status", "In Progress", "due", "Not set");
    }

    @PatchMapping("/{id}")
    public Map<String, Object> updateProject(@PathVariable String id, @RequestBody Map<String, Object> body) {
        if (body.containsKey("name")) jdbc.update("UPDATE project SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", body.get("name"), id);
        if (body.containsKey("description")) jdbc.update("UPDATE project SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", body.get("description"), id);
        if (body.containsKey("status")) jdbc.update("UPDATE project SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", body.get("status"), id);
        if (body.containsKey("due")) jdbc.update("UPDATE project SET due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", body.get("due"), id);

        return getProject(id);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> deleteProject(@PathVariable String id) {
        jdbc.update("DELETE FROM project WHERE id = ?", id);
        jdbc.update("DELETE FROM task WHERE project_id = ?", id);
        return Map.of("deleted", true);
    }

    @GetMapping("/{id}/tasks")
    public List<Map<String, Object>> getProjectTasks(@PathVariable String id) {
        return jdbc.queryForList("""
            SELECT t.id, t.project_id AS "projectId", t.title, t.description, t.status, t.priority,
                   t.due_date AS date, t.due_date AS due, t.done, t.assignee_id AS "assigneeId", p.name AS project
            FROM task t JOIN project p ON p.id = t.project_id
            WHERE t.project_id = ?
            ORDER BY t.created_at DESC
        """, id);
    }

    @PostMapping("/{id}/tasks")
    public ResponseEntity<Map<String, Object>> createTaskForProject(@PathVariable String id, @RequestBody Map<String, Object> body) {
        String taskId = "t-" + System.currentTimeMillis();
        String title = (String) body.getOrDefault("title", "New Task");
        String description = (String) body.getOrDefault("description", "");
        String status = (String) body.getOrDefault("status", "To do");
        String priority = (String) body.getOrDefault("priority", "Normal");
        String date = (String) body.getOrDefault("date", "No date");
        boolean done = "Done".equalsIgnoreCase(status) || Boolean.TRUE.equals(body.get("done"));

        jdbc.update("""
            INSERT INTO task (id, project_id, title, description, status, priority, due_date, done, assignee_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'usr-local')
        """, taskId, id, title, description, status, priority, date, done);

        Map<String, Object> task = new HashMap<>();
        task.put("id", taskId);
        task.put("projectId", id);
        task.put("title", title);
        task.put("description", description);
        task.put("status", status);
        task.put("priority", priority);
        task.put("date", date);
        task.put("due", date);
        task.put("done", done);
        task.put("assigneeId", "usr-local");

        return ResponseEntity.status(201).body(task);
    }
}
