package com.zynckle.api.task;

import com.zynckle.api.common.ApiException;
import com.zynckle.api.security.CurrentUser;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.util.*;

/** Shared task queries and JSON shape, always scoped to the caller's workspace. */
public final class TaskViews {
    private TaskViews() {}

    public static final List<String> STATUSES = List.of("Backlog", "To do", "In progress", "In review", "Done");

    /** Canonical status; older rows and clients wrote "In Progress". */
    public static String status(Object value) {
        String s = value == null ? "" : String.valueOf(value).trim();
        for (String known : STATUSES) if (known.equalsIgnoreCase(s)) return known;
        throw new ApiException(400, "Status must be one of " + String.join(", ", STATUSES));
    }

    public static final List<String> PRIORITIES = List.of("Low", "Normal", "High", "Urgent");

    static final String SELECT = """
        SELECT t.*, p.name AS project_name, u.display_name AS assignee_name, u.email AS assignee_email
        FROM task t JOIN project p ON p.id = t.project_id LEFT JOIN app_user u ON u.id = t.assignee_id
        WHERE p.workspace_id = ?""";

    public static Map<String, Object> view(Map<String, Object> t) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", t.get("id"));
        out.put("projectId", t.get("project_id"));
        out.put("project", Objects.toString(t.get("project_name"), "General"));
        out.put("title", t.get("title"));
        out.put("description", Objects.toString(t.get("description"), ""));
        String status = Objects.toString(t.get("status"), "To do");
        out.put("status", status.equalsIgnoreCase("In Progress") ? "In progress" : status);
        out.put("priority", t.get("priority"));
        out.put("date", t.get("due_date"));
        out.put("due", t.get("due_date"));
        out.put("done", Boolean.TRUE.equals(t.get("done")) || "Done".equals(t.get("status")));
        out.put("assigneeId", t.get("assignee_id"));
        out.put("recurrence", t.get("recurrence"));
        String name = (String) t.get("assignee_name");
        out.put("assignee", name == null ? null : Map.of("id", t.get("assignee_id"), "name", name, "email", Objects.toString(t.get("assignee_email"), ""), "avatar", CurrentUser.initials(name)));
        out.put("createdAt", t.get("created_at") instanceof Timestamp ts ? ts.toInstant().toString() : null);
        out.put("updatedAt", t.get("updated_at") instanceof Timestamp ts ? ts.toInstant().toString() : null);
        return out;
    }

    public static List<Map<String, Object>> list(JdbcTemplate jdbc, CurrentUser me, String extraWhere, Object... args) {
        List<Object> params = new ArrayList<>(List.of(me.workspaceId()));
        params.addAll(Arrays.asList(args));
        return jdbc.queryForList(SELECT + extraWhere + " ORDER BY t.created_at DESC", params.toArray()).stream().map(TaskViews::view).toList();
    }

    public static Map<String, Object> find(JdbcTemplate jdbc, CurrentUser me, String taskId) {
        return jdbc.queryForList(SELECT + " AND t.id = ?", me.workspaceId(), taskId).stream().findFirst().map(TaskViews::view)
            .orElseThrow(() -> new ApiException(404, "Task not found"));
    }

    /** An assignee must belong to the workspace; empty clears the assignment. */
    public static String assignee(JdbcTemplate jdbc, CurrentUser me, Object value) {
        if (value == null || String.valueOf(value).isBlank()) return null;
        String id = String.valueOf(value);
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM workspace_member WHERE workspace_id = ? AND user_id = ?", Integer.class, me.workspaceId(), id);
        if (n == null || n == 0) throw new ApiException(400, "The assignee must be a workspace member");
        return id;
    }
}
