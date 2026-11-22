package com.zynckle.api.insight;

import com.zynckle.api.security.CurrentUser;
import com.zynckle.api.task.TaskViews;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Deterministic workspace health signals: what is overdue, due soon, assigned to me, and
 * which projects have stalled. No model call is involved, so it is instant and free; the
 * daily brief hands these facts to the assistant to narrate.
 */
@RestController
public class InsightsController {
    private final Insights insights;

    public InsightsController(Insights insights) { this.insights = insights; }

    @GetMapping("/api/insights")
    public Map<String, Object> get(CurrentUser me) { return insights.compute(me); }

    @Service
    public static class Insights {
        private static final int STALE_DAYS = 14;
        private final JdbcTemplate jdbc;

        public Insights(JdbcTemplate jdbc) { this.jdbc = jdbc; }

        /** Only ISO dates (YYYY-MM-DD) carry a real deadline; free text like "Nov 28" is ignored. */
        static LocalDate due(Object value) {
            if (value == null) return null;
            try { return LocalDate.parse(String.valueOf(value).trim().substring(0, Math.min(10, String.valueOf(value).trim().length()))); }
            catch (DateTimeParseException | StringIndexOutOfBoundsException e) { return null; }
        }

        public Map<String, Object> compute(CurrentUser me) {
            LocalDate today = LocalDate.now(ZoneOffset.UTC);
            List<Map<String, Object>> open = TaskViews.list(jdbc, me, " AND COALESCE(t.done, FALSE) = FALSE AND t.status <> 'Done'");
            List<Map<String, Object>> overdue = new ArrayList<>();
            List<Map<String, Object>> dueSoon = new ArrayList<>();
            List<Map<String, Object>> mine = new ArrayList<>();
            for (Map<String, Object> t : open) {
                LocalDate due = due(t.get("date"));
                Map<String, Object> item = brief(t, due, today);
                if (due != null && due.isBefore(today)) overdue.add(item);
                else if (due != null && !due.isAfter(today.plusDays(3))) dueSoon.add(item);
                if (me.userId().equals(t.get("assigneeId"))) mine.add(item);
            }
            Comparator<Map<String, Object>> byDue = Comparator.comparing(m -> String.valueOf(m.getOrDefault("due", "9999")));
            overdue.sort(byDue); dueSoon.sort(byDue); mine.sort(byDue);

            List<Map<String, Object>> projects = new ArrayList<>();
            List<Map<String, Object>> stalled = new ArrayList<>();
            for (Map<String, Object> p : jdbc.queryForList("""
                    SELECT p.id, p.name, p.status, p.updated_at,
                           (SELECT COUNT(*) FROM task t WHERE t.project_id = p.id) AS total,
                           (SELECT COUNT(*) FROM task t WHERE t.project_id = p.id AND (t.done = TRUE OR t.status = 'Done')) AS done,
                           (SELECT MAX(t.updated_at) FROM task t WHERE t.project_id = p.id) AS last_task
                    FROM project p WHERE p.workspace_id = ?""", me.workspaceId())) {
                String id = String.valueOf(p.get("id"));
                int total = ((Number) p.get("total")).intValue();
                int done = ((Number) p.get("done")).intValue();
                long late = overdue.stream().filter(t -> id.equals(t.get("projectId"))).count();
                Instant last = latest(p.get("updated_at"), p.get("last_task"));
                long idleDays = last == null ? 0 : ChronoUnit.DAYS.between(last, Instant.now());
                String health = late >= 3 || (total > 0 && late * 3 >= total - done && late > 0) ? "at-risk" : late > 0 || (idleDays >= STALE_DAYS && total > done) ? "watch" : "on-track";
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("id", id); row.put("name", p.get("name")); row.put("status", p.get("status"));
                row.put("progress", total == 0 ? 0 : Math.round(done * 100f / total)); row.put("openTasks", total - done);
                row.put("overdue", late); row.put("idleDays", idleDays); row.put("health", health);
                projects.add(row);
                if (idleDays >= STALE_DAYS && total > done) stalled.add(row);
            }
            projects.sort(Comparator.comparingInt((Map<String, Object> r) -> switch (String.valueOf(r.get("health"))) { case "at-risk" -> 0; case "watch" -> 1; default -> 2; }));

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("generatedAt", Instant.now().toString());
            out.put("today", today.toString());
            out.put("counts", Map.of("open", open.size(), "overdue", overdue.size(), "dueSoon", dueSoon.size(), "mine", mine.size(), "stalled", stalled.size()));
            out.put("overdue", overdue.subList(0, Math.min(10, overdue.size())));
            out.put("dueSoon", dueSoon.subList(0, Math.min(10, dueSoon.size())));
            out.put("mine", mine.subList(0, Math.min(10, mine.size())));
            out.put("stalled", stalled);
            out.put("projects", projects);
            return out;
        }

        /** Plain-text facts for the daily brief prompt. */
        public String asContext(CurrentUser me) {
            Map<String, Object> data = compute(me);
            StringBuilder sb = new StringBuilder("Workspace health as of " + data.get("today") + " (computed from task data):\n");
            sb.append("Counts: ").append(data.get("counts")).append('\n');
            for (String key : List.of("overdue", "dueSoon", "mine")) {
                @SuppressWarnings("unchecked") List<Map<String, Object>> list = (List<Map<String, Object>>) data.get(key);
                sb.append('\n').append(switch (key) { case "overdue" -> "Overdue tasks"; case "dueSoon" -> "Due in the next 3 days"; default -> "Assigned to " + me.name(); }).append(":\n");
                if (list.isEmpty()) sb.append("- none\n");
                for (Map<String, Object> t : list) sb.append("- ").append(t.get("title")).append(" (").append(t.get("project")).append(", ").append(t.get("status")).append(t.get("due") != null ? ", due " + t.get("due") : "").append(")\n");
            }
            sb.append("\nProjects:\n");
            @SuppressWarnings("unchecked") List<Map<String, Object>> projects = (List<Map<String, Object>>) data.get("projects");
            for (Map<String, Object> p : projects) sb.append("- ").append(p.get("name")).append(": ").append(p.get("health")).append(", ").append(p.get("progress")).append("% done, ")
                .append(p.get("openTasks")).append(" open, ").append(p.get("overdue")).append(" overdue, idle ").append(p.get("idleDays")).append(" days\n");
            sb.append("\nRecent activity:\n");
            for (Map<String, Object> a : jdbc.queryForList("SELECT actor_name, verb, summary, created_at FROM activity_log WHERE workspace_id = ? AND COALESCE(audit, FALSE) = FALSE ORDER BY created_at DESC LIMIT 15", me.workspaceId())) {
                sb.append("- ").append(a.get("actor_name")).append(' ').append(a.get("verb")).append(' ').append(a.get("summary")).append('\n');
            }
            return sb.toString();
        }

        private static Map<String, Object> brief(Map<String, Object> t, LocalDate due, LocalDate today) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", t.get("id")); item.put("title", t.get("title")); item.put("project", t.get("project")); item.put("projectId", t.get("projectId"));
            item.put("status", t.get("status")); item.put("priority", t.get("priority")); item.put("due", due == null ? null : due.toString());
            item.put("daysLate", due != null && due.isBefore(today) ? ChronoUnit.DAYS.between(due, today) : 0);
            item.put("assignee", t.get("assignee"));
            return item;
        }

        private static Instant latest(Object... values) {
            Instant best = null;
            for (Object v : values) if (v instanceof Timestamp ts && (best == null || ts.toInstant().isAfter(best))) best = ts.toInstant();
            return best;
        }
    }
}
