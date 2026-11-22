package com.zynckle.api.task;

import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.common.Validate;
import com.zynckle.api.security.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.sql.Timestamp;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Tasks and their comment threads, scoped to the caller's workspace. */
@RestController
@RequestMapping("/api/tasks")
public class TaskController {
    private static final Pattern MENTION = Pattern.compile("@([\\p{L}][\\p{L}.'-]*)");
    private final JdbcTemplate jdbc;
    private final Activity activity;

    public TaskController(JdbcTemplate jdbc, Activity activity) {
        this.jdbc = jdbc;
        this.activity = activity;
    }

    @GetMapping
    public List<Map<String, Object>> list(CurrentUser me) { return TaskViews.list(jdbc, me, ""); }

    @GetMapping("/{id}")
    public Map<String, Object> get(CurrentUser me, @PathVariable String id) { return TaskViews.find(jdbc, me, id); }

    @PatchMapping("/{id}")
    public Map<String, Object> update(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        Map<String, Object> before = TaskViews.find(jdbc, me, id);
        if (body.containsKey("title")) jdbc.update("UPDATE task SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", Validate.str(body, "title", "Task title", 1, 240), id);
        String description = Validate.optional(body, "description", "Description", 4000);
        if (description != null) jdbc.update("UPDATE task SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", description, id);
        if (body.containsKey("status")) {
            String status = TaskViews.status(body.get("status"));
            jdbc.update("UPDATE task SET status = ?, done = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", status, "Done".equals(status), id);
        }
        if (body.containsKey("priority")) jdbc.update("UPDATE task SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", Validate.oneOf(body.get("priority"), TaskViews.PRIORITIES, "Priority"), id);
        if (body.get("done") instanceof Boolean done) {
            jdbc.update("UPDATE task SET done = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", done, done ? "Done" : "To do", id);
        }
        if (body.containsKey("date")) {
            String date = body.get("date") == null ? "No date" : Validate.str(body, "date", "Due date", 0, 64);
            jdbc.update("UPDATE task SET due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", date.isBlank() ? "No date" : date, id);
        }
        if (body.containsKey("assigneeId")) {
            String assignee = TaskViews.assignee(jdbc, me, body.get("assigneeId"));
            jdbc.update("UPDATE task SET assignee_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", assignee, id);
            if (assignee != null && !assignee.equals(before.get("assigneeId"))) {
                activity.notify(me, List.of(assignee), "task", "Task assigned to you", String.valueOf(before.get("title")), "/projects/" + before.get("projectId") + "?task=" + id);
            }
        }
        Map<String, Object> saved = TaskViews.find(jdbc, me, id);
        if (!Objects.equals(before.get("status"), saved.get("status"))) {
            activity.log(me, "Done".equals(saved.get("status")) ? "completed task" : "moved task to " + saved.get("status"), "task", String.valueOf(saved.get("title")), false, (String) saved.get("projectId"));
        }
        jdbc.update("UPDATE project SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", saved.get("projectId"));
        return saved;
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        Map<String, Object> task = TaskViews.find(jdbc, me, id);
        jdbc.update("DELETE FROM task_comment WHERE task_id = ?", id);
        jdbc.update("DELETE FROM task WHERE id = ?", id);
        activity.log(me, "deleted task", "task", String.valueOf(task.get("title")), false, (String) task.get("projectId"));
        return Map.of("deleted", true);
    }

    @GetMapping("/{id}/comments")
    public List<Map<String, Object>> comments(CurrentUser me, @PathVariable String id) {
        TaskViews.find(jdbc, me, id);
        return jdbc.queryForList("SELECT * FROM task_comment WHERE task_id = ? ORDER BY created_at ASC", id).stream().map(c -> comment(me, c)).toList();
    }

    private static Map<String, Object> comment(CurrentUser me, Map<String, Object> c) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", c.get("id"));
        out.put("author", c.get("author_name"));
        out.put("authorId", c.get("author_id"));
        out.put("body", c.get("body"));
        out.put("createdAt", c.get("created_at") instanceof Timestamp t ? t.toInstant().toString() : null);
        out.put("mine", me.userId().equals(c.get("author_id")));
        return out;
    }

    @PostMapping("/{id}/comments")
    public ResponseEntity<Map<String, Object>> addComment(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        Map<String, Object> task = TaskViews.find(jdbc, me, id);
        String text = Validate.str(body, "body", "Comment", 1, 5000);
        String commentId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO task_comment (id, task_id, author_id, author_name, body) VALUES (?, ?, ?, ?, ?)", commentId, id, me.userId(), me.name(), text);
        String link = "/projects/" + task.get("projectId") + "?task=" + id;
        Set<String> mentioned = mentions(me, text);
        if (!mentioned.isEmpty()) activity.notify(me, mentioned, "mention", me.name() + " mentioned you", task.get("title") + ": " + text.substring(0, Math.min(140, text.length())), link);
        Set<String> watchers = new LinkedHashSet<>();
        Object assignee = task.get("assigneeId");
        if (assignee != null) watchers.add(String.valueOf(assignee));
        watchers.addAll(jdbc.queryForList("SELECT DISTINCT author_id FROM task_comment WHERE task_id = ? AND author_id IS NOT NULL", String.class, id));
        watchers.removeAll(mentioned);
        activity.notify(me, watchers, "comment", "New comment on a task", me.name() + " on " + task.get("title"), link);
        activity.log(me, "commented on", "task", String.valueOf(task.get("title")), false, (String) task.get("projectId"));
        Map<String, Object> created = jdbc.queryForList("SELECT * FROM task_comment WHERE id = ?", commentId).get(0);
        return ResponseEntity.status(201).body(comment(me, created));
    }

    /** "@Ada", "@ada.lovelace" (email handle) or a first name, matched against workspace members. */
    private Set<String> mentions(CurrentUser me, String text) {
        Set<String> handles = new HashSet<>();
        Matcher m = MENTION.matcher(text);
        while (m.find()) handles.add(m.group(1).toLowerCase());
        if (handles.isEmpty()) return Set.of();
        Set<String> found = new LinkedHashSet<>();
        for (Map<String, Object> u : jdbc.queryForList("SELECT u.id, u.display_name, u.email FROM workspace_member w JOIN app_user u ON u.id = w.user_id WHERE w.workspace_id = ?", me.workspaceId())) {
            String full = String.valueOf(u.get("display_name")).toLowerCase();
            String first = full.split("\\s+")[0];
            String handle = String.valueOf(u.get("email")).split("@")[0].toLowerCase();
            if (handles.contains(first) || handles.contains(handle) || handles.contains(full.replace(' ', '.'))) found.add((String) u.get("id"));
        }
        return found;
    }

    /** Guard used by other modules that accept a task id. */
    public static void requireTask(JdbcTemplate jdbc, CurrentUser me, String taskId) {
        if (jdbc.queryForList(TaskViews.SELECT + " AND t.id = ?", me.workspaceId(), taskId).isEmpty()) throw new ApiException(404, "Task not found");
    }
}
