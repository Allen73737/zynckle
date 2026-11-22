package com.zynckle.api.task;

import com.zynckle.api.common.ApiException;
import com.zynckle.api.security.CurrentUser;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** Task comments can be removed by their author or a workspace admin. */
@RestController
public class CommentController {
    private final JdbcTemplate jdbc;

    public CommentController(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @DeleteMapping("/api/comments/{id}")
    public Map<String, Object> delete(CurrentUser me, @PathVariable String id) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT c.author_id FROM task_comment c JOIN task t ON t.id = c.task_id JOIN project p ON p.id = t.project_id
            WHERE c.id = ? AND p.workspace_id = ?""", id, me.workspaceId());
        if (rows.isEmpty()) throw new ApiException(404, "Comment not found");
        if (!me.userId().equals(rows.get(0).get("author_id")) && !me.isAdmin()) throw new ApiException(403, "Only the author or a workspace admin can delete this comment");
        jdbc.update("DELETE FROM task_comment WHERE id = ?", id);
        return Map.of("deleted", true);
    }
}
