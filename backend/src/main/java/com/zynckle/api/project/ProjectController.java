package com.zynckle.api.project;

import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.common.Validate;
import com.zynckle.api.realtime.RealtimeHub;
import com.zynckle.api.security.CurrentUser;
import com.zynckle.api.task.TaskViews;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.sql.Timestamp;
import java.util.*;

/** Projects in the caller's workspace, with progress computed from their tasks. */
@RestController
@RequestMapping("/api/projects")
public class ProjectController {
    private static final String[] COLORS = {"color-amber", "color-sage", "color-sky", "color-rose", "color-violet"};
    private final JdbcTemplate jdbc;
    private final Activity activity;
    private final RealtimeHub hub;
    private final com.zynckle.api.task.TaskFeatures features;

    public ProjectController(JdbcTemplate jdbc, Activity activity, RealtimeHub hub, com.zynckle.api.task.TaskFeatures features) {
        this.jdbc = jdbc;
        this.activity = activity;
        this.hub = hub;
        this.features = features;
    }

    private static final String SELECT = """
        SELECT p.*, (SELECT COUNT(*) FROM task t WHERE t.project_id = p.id) AS task_count,
               (SELECT COUNT(*) FROM task t WHERE t.project_id = p.id AND (t.done = TRUE OR t.status = 'Done')) AS done_count,
               (SELECT COUNT(*) FROM workspace_member m WHERE m.workspace_id = p.workspace_id) AS member_count
        FROM project p WHERE p.workspace_id = ?""";

    private static Map<String, Object> view(Map<String, Object> p) {
        int tasks = ((Number) p.get("task_count")).intValue();
        int done = ((Number) p.get("done_count")).intValue();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", p.get("id"));
        out.put("name", p.get("name"));
        out.put("description", Objects.toString(p.get("description"), ""));
        out.put("status", p.get("status"));
        out.put("due", Objects.toString(p.get("due_date"), "Not set"));
        out.put("color", COLORS[Math.floorMod(String.valueOf(p.get("id")).hashCode(), COLORS.length)]);
        out.put("progress", tasks == 0 ? 0 : Math.round(done * 100f / tasks));
        out.put("taskCount", tasks);
        out.put("doneCount", done);
        out.put("members", ((Number) p.get("member_count")).intValue());
        out.put("ownerId", p.get("created_by"));
        out.put("tags", List.of());
        out.put("createdAt", p.get("created_at") instanceof Timestamp t ? t.toInstant().toString() : null);
        out.put("updatedAt", p.get("updated_at") instanceof Timestamp t ? t.toInstant().toString() : null);
        return out;
    }

    private Map<String, Object> find(CurrentUser me, String id) {
        return jdbc.queryForList(SELECT + " AND p.id = ?", me.workspaceId(), id).stream().findFirst().map(ProjectController::view)
            .orElseThrow(() -> new ApiException(404, "Project not found"));
    }

    @GetMapping
    public List<Map<String, Object>> list(CurrentUser me) {
        return jdbc.queryForList(SELECT + " ORDER BY p.updated_at DESC", me.workspaceId()).stream().map(ProjectController::view).toList();
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        String id = UUID.randomUUID().toString();
        String name = Validate.str(body, "name", "Project name", 1, 160);
        String description = Objects.toString(Validate.optional(body, "description", "Description", 2000), "");
        String status = Objects.toString(Validate.optional(body, "status", "Status", 24), "Planning");
        String due = Objects.toString(Validate.optional(body, "due", "Deadline", 64), "Not set");
        jdbc.update("INSERT INTO project (id, workspace_id, name, description, status, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
            id, me.workspaceId(), name, description, status, due.isBlank() ? "Not set" : due, me.userId());
        activity.log(me, "created project", "project", name, false, id);
        Map<String, Object> created = find(me, id);
        hub.publish(me.workspaceId(), "project.changed", created, null);
        return ResponseEntity.status(201).body(created);
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(CurrentUser me, @PathVariable String id) { return find(me, id); }

    @PatchMapping("/{id}")
    public Map<String, Object> update(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        find(me, id);
        if (body.containsKey("name")) jdbc.update("UPDATE project SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", Validate.str(body, "name", "Project name", 1, 160), id);
        String description = Validate.optional(body, "description", "Description", 2000);
        if (description != null) jdbc.update("UPDATE project SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", description, id);
        String status = Validate.optional(body, "status", "Status", 24);
        if (status != null) jdbc.update("UPDATE project SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", status, id);
        if (body.containsKey("due")) {
            String due = body.get("due") == null ? "Not set" : Validate.str(body, "due", "Deadline", 0, 64);
            jdbc.update("UPDATE project SET due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", due.isBlank() ? "Not set" : due, id);
        }
        Map<String, Object> saved = find(me, id);
        activity.log(me, "updated project", "project", String.valueOf(saved.get("name")), false, id);
        hub.publish(me.workspaceId(), "project.changed", saved, null);
        return saved;
    }

    @DeleteMapping("/{id}")
    @Transactional
    public Map<String, Object> delete(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        Map<String, Object> project = find(me, id);
        if (!me.userId().equals(project.get("ownerId")) && !me.isAdmin()) throw new ApiException(403, "Only the project creator or a workspace admin can delete it");
        jdbc.update("DELETE FROM task_comment WHERE task_id IN (SELECT id FROM task WHERE project_id = ?)", id);
        jdbc.update("DELETE FROM task WHERE project_id = ?", id);
        jdbc.update("DELETE FROM project WHERE id = ? AND workspace_id = ?", id, me.workspaceId());
        activity.log(me, "deleted project", "project", String.valueOf(project.get("name")), true, null);
        hub.publish(me.workspaceId(), "project.deleted", Map.of("id", id), null);
        return Map.of("deleted", true);
    }

    @GetMapping("/{id}/tasks")
    public List<Map<String, Object>> tasks(CurrentUser me, @PathVariable String id) {
        find(me, id);
        return TaskViews.list(jdbc, me, " AND t.project_id = ?", id);
    }

    /** Reviewed AI plans arrive here: up to 50 tasks in one request. */
    @PostMapping("/{id}/tasks/bulk")
    @Transactional
    @SuppressWarnings("unchecked")
    public ResponseEntity<List<Map<String, Object>>> createTasks(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        Map<String, Object> project = find(me, id);
        if (!(body.get("tasks") instanceof List<?> list) || list.isEmpty() || list.size() > 50) throw new ApiException(400, "Provide between 1 and 50 tasks");
        List<Map<String, Object>> inputs = list.stream().filter(Map.class::isInstance).map(o -> (Map<String, Object>) o).toList();
        List<Map<String, Object>> created = features.createMany(me, id, inputs);
        activity.log(me, "added " + created.size() + " tasks to", "project", String.valueOf(project.get("name")), false, id);
        return ResponseEntity.status(201).body(created);
    }

    /** CSV import (Notion, Trello, Linear and Asana all export CSV). The body is the CSV text. */
    @PostMapping(value = "/{id}/import", consumes = "*/*")
    @Transactional
    public Map<String, Object> importCsv(CurrentUser me, @PathVariable String id, @RequestBody(required = false) String csv) {
        me.requireEdit();
        find(me, id);
        return features.importCsv(me, id, csv);
    }

    @PostMapping("/{id}/tasks")
    public ResponseEntity<Map<String, Object>> createTask(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        Map<String, Object> project = find(me, id);
        String taskId = UUID.randomUUID().toString();
        String title = Validate.str(body, "title", "Task title", 1, 240);
        String description = Objects.toString(Validate.optional(body, "description", "Description", 4000), "");
        String status = body.containsKey("status") ? TaskViews.status(body.get("status")) : "To do";
        String priority = body.containsKey("priority") ? Validate.oneOf(body.get("priority"), TaskViews.PRIORITIES, "Priority") : "Normal";
        String date = Objects.toString(Validate.optional(body, "date", "Due date", 64), "No date");
        String assignee = body.containsKey("assigneeId") ? TaskViews.assignee(jdbc, me, body.get("assigneeId")) : null;
        boolean done = "Done".equals(status) || Boolean.TRUE.equals(body.get("done"));
        String recurrence = com.zynckle.api.task.TaskFeatures.recurrence(body.get("recurrence"));
        jdbc.update("INSERT INTO task (id, project_id, title, description, status, priority, due_date, done, assignee_id, created_by, recurrence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            taskId, id, title, description, done ? "Done" : status, priority, date.isBlank() ? "No date" : date, done, assignee, me.userId(), recurrence);
        jdbc.update("UPDATE project SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", id);
        activity.log(me, "created task", "task", title, false, id);
        if (assignee != null) activity.notify(me, List.of(assignee), "task", "Task assigned to you", title + " · " + project.get("name"), "/projects/" + id + "?task=" + taskId);
        Map<String, Object> created = TaskViews.find(jdbc, me, taskId);
        hub.publish(me.workspaceId(), "task.changed", created, null);
        return ResponseEntity.status(201).body(created);
    }
}
