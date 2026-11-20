package com.zynckle.api.task;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {
    private final JdbcTemplate jdbc;

    public TaskController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public List<Map<String, Object>> getTasks() {
        return jdbc.queryForList("""
            SELECT t.id, t.project_id AS "projectId", t.title, t.description, t.status, t.priority,
                   t.due_date AS date, t.due_date AS due, t.done, t.assignee_id AS "assigneeId",
                   COALESCE(p.name, 'General') AS project
            FROM task t LEFT JOIN project p ON p.id = t.project_id
            ORDER BY t.created_at DESC
        """);
    }

    @GetMapping("/{id}")
    public Map<String, Object> getTask(@PathVariable String id) {
        List<Map<String, Object>> list = jdbc.queryForList("""
            SELECT t.id, t.project_id AS "projectId", t.title, t.description, t.status, t.priority,
                   t.due_date AS date, t.due_date AS due, t.done, t.assignee_id AS "assigneeId",
                   COALESCE(p.name, 'General') AS project
            FROM task t LEFT JOIN project p ON p.id = t.project_id
            WHERE t.id = ?
        """, id);
        if (!list.isEmpty()) {
            return list.get(0);
        }
        return Map.of("id", id, "title", "Task", "status", "To do", "priority", "Normal", "done", false);
    }

    @PatchMapping("/{id}")
    public Map<String, Object> updateTask(@PathVariable String id, @RequestBody Map<String, Object> body) {
        if (body.containsKey("title")) jdbc.update("UPDATE task SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", body.get("title"), id);
        if (body.containsKey("description")) jdbc.update("UPDATE task SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", body.get("description"), id);
        if (body.containsKey("status")) {
            String status = (String) body.get("status");
            boolean done = "Done".equalsIgnoreCase(status);
            jdbc.update("UPDATE task SET status = ?, done = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", status, done, id);
        }
        if (body.containsKey("priority")) jdbc.update("UPDATE task SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", body.get("priority"), id);
        if (body.containsKey("done")) {
            boolean done = Boolean.TRUE.equals(body.get("done"));
            String status = done ? "Done" : "In Progress";
            jdbc.update("UPDATE task SET done = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", done, status, id);
        }
        if (body.containsKey("date")) jdbc.update("UPDATE task SET due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", body.get("date"), id);

        return getTask(id);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> deleteTask(@PathVariable String id) {
        jdbc.update("DELETE FROM task WHERE id = ?", id);
        jdbc.update("DELETE FROM task_comment WHERE task_id = ?", id);
        return Map.of("deleted", true);
    }

    @GetMapping("/{id}/comments")
    public List<Map<String, Object>> getComments(@PathVariable String id) {
        return jdbc.queryForList("""
            SELECT id, author_name AS author, body, created_at AS "createdAt", TRUE AS mine
            FROM task_comment WHERE task_id = ? ORDER BY created_at ASC
        """, id);
    }

    @PostMapping("/{id}/comments")
    public Map<String, Object> addComment(@PathVariable String id, @RequestBody Map<String, Object> body) {
        String cId = "c-" + System.currentTimeMillis();
        String text = (String) body.getOrDefault("body", "");
        jdbc.update("INSERT INTO task_comment (id, task_id, author_id, author_name, body) VALUES (?, ?, 'usr-local', 'Studio Lead', ?)", cId, id, text);
        return Map.of(
            "id", cId,
            "author", "Studio Lead",
            "body", text,
            "createdAt", new Date().toString(),
            "mine", true
        );
    }
}
