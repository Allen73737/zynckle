package com.zynckle.api.task;

import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.realtime.RealtimeHub;
import com.zynckle.api.security.CurrentUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.*;

/**
 * Task behaviour shared by the task and project controllers: recurrence, due-date reminders,
 * bulk creation and CSV import (the export format of Notion, Trello, Linear and Asana).
 */
@Service
public class TaskFeatures {
    private static final Logger log = LoggerFactory.getLogger(TaskFeatures.class);
    public static final List<String> RECURRENCES = List.of("daily", "weekly", "monthly");

    private final JdbcTemplate jdbc;
    private final Activity activity;
    private final RealtimeHub hub;

    public TaskFeatures(JdbcTemplate jdbc, Activity activity, RealtimeHub hub) {
        this.jdbc = jdbc;
        this.activity = activity;
        this.hub = hub;
    }

    public static String recurrence(Object value) {
        if (value == null || String.valueOf(value).isBlank() || "none".equals(value)) return null;
        String s = String.valueOf(value).toLowerCase(Locale.ROOT);
        if (!RECURRENCES.contains(s)) throw new ApiException(400, "Repeat must be daily, weekly, monthly or none");
        return s;
    }

    static LocalDate iso(Object value) {
        try { return value == null ? null : LocalDate.parse(String.valueOf(value).trim()); } catch (DateTimeParseException e) { return null; }
    }

    /** When a repeating task is completed, schedule the next one and stop the finished one repeating. */
    public void onCompleted(CurrentUser me, String taskId) {
        Map<String, Object> t = jdbc.queryForList("SELECT * FROM task WHERE id = ?", taskId).stream().findFirst().orElse(null);
        if (t == null || t.get("recurrence") == null) return;
        String rule = String.valueOf(t.get("recurrence"));
        LocalDate base = Optional.ofNullable(iso(t.get("due_date"))).orElse(LocalDate.now(ZoneOffset.UTC));
        LocalDate next = switch (rule) { case "daily" -> base.plusDays(1); case "weekly" -> base.plusWeeks(1); default -> base.plusMonths(1); };
        String id = UUID.randomUUID().toString();
        jdbc.update("""
            INSERT INTO task (id, project_id, title, description, status, priority, due_date, done, assignee_id, created_by, recurrence)
            VALUES (?, ?, ?, ?, 'To do', ?, ?, FALSE, ?, ?, ?)""",
            id, t.get("project_id"), t.get("title"), t.get("description"), t.get("priority"), next.toString(), t.get("assignee_id"), me.userId(), rule);
        jdbc.update("UPDATE task SET recurrence = NULL WHERE id = ?", taskId);
        activity.log(me, "scheduled the next", "task", t.get("title") + " · due " + next, false, (String) t.get("project_id"));
        hub.publish(me.workspaceId(), "task.changed", TaskViews.find(jdbc, me, id), null);
    }

    /** Create many tasks at once (AI Workshop plans). Returns the created task views. */
    public List<Map<String, Object>> createMany(CurrentUser me, String projectId, List<Map<String, Object>> inputs) {
        List<Map<String, Object>> created = new ArrayList<>();
        for (Map<String, Object> in : inputs) {
            String title = Objects.toString(in.get("title"), "").trim();
            if (title.isEmpty()) continue;
            String priority = TaskViews.PRIORITIES.stream().filter(p -> p.equalsIgnoreCase(Objects.toString(in.get("priority"), ""))).findFirst().orElse("Normal");
            String status = TaskViews.STATUSES.stream().filter(s -> s.equalsIgnoreCase(Objects.toString(in.get("status"), ""))).findFirst().orElse("To do");
            String due = Optional.ofNullable(iso(in.get("date"))).map(LocalDate::toString)
                .orElseGet(() -> in.get("dueOffsetDays") instanceof Number n ? LocalDate.now(ZoneOffset.UTC).plusDays(n.longValue()).toString() : "No date");
            String assignee = assigneeOrNull(me, in.get("assigneeId"));
            String id = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO task (id, project_id, title, description, status, priority, due_date, done, assignee_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, projectId, title.substring(0, Math.min(240, title.length())), cut(Objects.toString(in.get("description"), ""), 4000), status, priority, due, "Done".equals(status), assignee, me.userId());
            Map<String, Object> view = TaskViews.find(jdbc, me, id);
            hub.publish(me.workspaceId(), "task.changed", view, null);
            created.add(view);
        }
        jdbc.update("UPDATE project SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", projectId);
        return created;
    }

    private String assigneeOrNull(CurrentUser me, Object value) {
        if (value == null || String.valueOf(value).isBlank()) return null;
        try { return TaskViews.assignee(jdbc, me, value); } catch (ApiException e) { return null; }
    }

    private static String cut(String value, int max) { return value.length() > max ? value.substring(0, max) : value; }

    // ---- CSV import ------------------------------------------------------------------

    /** RFC 4180-style parsing: quoted fields, doubled quotes, commas and newlines inside quotes. */
    static List<List<String>> parseCsv(String text) {
        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        String s = text.startsWith("﻿") ? text.substring(1) : text;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (quoted) {
                if (c == '"' && i + 1 < s.length() && s.charAt(i + 1) == '"') { field.append('"'); i++; }
                else if (c == '"') quoted = false;
                else field.append(c);
            } else if (c == '"') quoted = true;
            else if (c == ',') { row.add(field.toString()); field.setLength(0); }
            else if (c == '\n' || c == '\r') {
                if (c == '\r' && i + 1 < s.length() && s.charAt(i + 1) == '\n') i++;
                row.add(field.toString()); field.setLength(0);
                if (row.stream().anyMatch(f -> !f.isBlank())) rows.add(row);
                row = new ArrayList<>();
            } else field.append(c);
        }
        row.add(field.toString());
        if (row.stream().anyMatch(f -> !f.isBlank())) rows.add(row);
        return rows;
    }

    private static int column(List<String> header, String... names) {
        for (int i = 0; i < header.size(); i++) {
            String h = header.get(i).trim().toLowerCase(Locale.ROOT);
            for (String n : names) if (h.equals(n)) return i;
        }
        return -1;
    }

    static String mapStatus(String raw) {
        String s = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        if (s.isEmpty()) return "To do";
        if (s.matches("done|complete|completed|closed|resolved|shipped")) return "Done";
        if (s.matches("in progress|in-progress|doing|started|active|wip")) return "In progress";
        if (s.matches("in review|review|reviewing|qa|testing")) return "In review";
        if (s.matches("backlog|icebox|later|someday")) return "Backlog";
        return "To do";
    }

    static String mapPriority(String raw) {
        String s = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        if (s.matches("urgent|critical|p0|highest|blocker")) return "Urgent";
        if (s.matches("high|p1|important")) return "High";
        if (s.matches("low|p3|p4|lowest|minor")) return "Low";
        return "Normal";
    }

    static String mapDate(String raw) {
        if (raw == null || raw.isBlank()) return "No date";
        String s = raw.trim();
        if (s.matches("\\d{4}-\\d{2}-\\d{2}.*")) return s.substring(0, 10);
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d{1,2})/(\\d{1,2})/(\\d{4})").matcher(s);
        if (m.find()) return String.format("%s-%02d-%02d", m.group(3), Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)));
        return s.length() > 64 ? s.substring(0, 64) : s;
    }

    public Map<String, Object> importCsv(CurrentUser me, String projectId, String csv) {
        if (csv == null || csv.isBlank()) throw new ApiException(400, "The CSV file is empty");
        if (csv.length() > 2_000_000) throw new ApiException(413, "CSV imports are limited to 2 MB");
        List<List<String>> rows = parseCsv(csv);
        if (rows.size() < 2) throw new ApiException(400, "The CSV needs a header row and at least one task");
        List<String> header = rows.get(0);
        int title = column(header, "title", "name", "task", "task name", "summary", "card name", "issue");
        if (title < 0) throw new ApiException(400, "Add a column named Title, Name or Task");
        int description = column(header, "description", "notes", "details", "card description", "body");
        int status = column(header, "status", "state", "list", "list name", "stage");
        int priority = column(header, "priority", "importance");
        int due = column(header, "due", "due date", "date", "deadline", "due on");
        int assignee = column(header, "assignee", "assignee email", "owner", "assigned to", "members");
        Map<String, String> people = new HashMap<>();
        for (Map<String, Object> m : jdbc.queryForList("SELECT u.id, u.email, u.display_name FROM workspace_member w JOIN app_user u ON u.id = w.user_id WHERE w.workspace_id = ?", me.workspaceId())) {
            people.put(String.valueOf(m.get("email")).toLowerCase(Locale.ROOT), (String) m.get("id"));
            people.put(String.valueOf(m.get("display_name")).toLowerCase(Locale.ROOT), (String) m.get("id"));
        }
        List<Map<String, Object>> inputs = new ArrayList<>();
        int skipped = 0;
        for (List<String> row : rows.subList(1, Math.min(rows.size(), 501))) {
            String name = title < row.size() ? row.get(title).trim() : "";
            if (name.isEmpty()) { skipped++; continue; }
            Map<String, Object> in = new HashMap<>();
            in.put("title", name);
            if (description >= 0 && description < row.size()) in.put("description", row.get(description));
            in.put("status", mapStatus(status >= 0 && status < row.size() ? row.get(status) : ""));
            in.put("priority", mapPriority(priority >= 0 && priority < row.size() ? row.get(priority) : ""));
            String date = mapDate(due >= 0 && due < row.size() ? row.get(due) : "");
            if (!"No date".equals(date)) in.put("date", date);
            if (assignee >= 0 && assignee < row.size()) in.put("assigneeId", people.get(row.get(assignee).trim().toLowerCase(Locale.ROOT)));
            inputs.add(in);
        }
        List<Map<String, Object>> created = createMany(me, projectId, inputs);
        activity.log(me, "imported " + created.size() + " tasks into", "project", jdbc.queryForObject("SELECT name FROM project WHERE id = ?", String.class, projectId), false, projectId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("created", created.size());
        out.put("skipped", skipped + Math.max(0, rows.size() - 501));
        out.put("tasks", created);
        return out;
    }

    // ---- Reminders --------------------------------------------------------------------

    /** Hourly: tell assignees about tasks due today or tomorrow, once per due date. */
    @Scheduled(fixedDelay = 3_600_000, initialDelay = 60_000)
    public void remind() {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        List<Map<String, Object>> due = jdbc.queryForList("""
            SELECT t.id, t.title, t.due_date, t.assignee_id, t.project_id, p.workspace_id, w.name AS workspace_name, u.display_name, u.email
            FROM task t JOIN project p ON p.id = t.project_id JOIN workspace w ON w.id = p.workspace_id JOIN app_user u ON u.id = t.assignee_id
            WHERE t.assignee_id IS NOT NULL AND COALESCE(t.done, FALSE) = FALSE AND t.status <> 'Done'
            AND t.due_date IN (?, ?) AND (t.reminded_for IS NULL OR t.reminded_for <> t.due_date)""", today.toString(), today.plusDays(1).toString());
        for (Map<String, Object> t : due) {
            // Reminders come from the system, so the "actor" is a neutral stand-in that is never the recipient.
            CurrentUser system = new CurrentUser("system", "Zynckle", "", (String) t.get("workspace_id"), (String) t.get("workspace_name"), "OWNER", "");
            boolean isToday = today.toString().equals(t.get("due_date"));
            activity.notify(system, List.of((String) t.get("assignee_id")), "deadline", (isToday ? "Due today: " : "Due tomorrow: ") + t.get("title"), "", "/projects/" + t.get("project_id") + "?task=" + t.get("id"));
            jdbc.update("UPDATE task SET reminded_for = due_date WHERE id = ?", t.get("id"));
        }
        if (!due.isEmpty()) log.info("Sent {} deadline reminders", due.size());
    }
}
