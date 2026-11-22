package com.zynckle.api.workspace;

import org.springframework.jdbc.core.JdbcTemplate;

/** Removes a workspace and everything that belongs to it. */
public final class WorkspaceData {
    private WorkspaceData() {}

    public static void delete(JdbcTemplate jdbc, String workspaceId) {
        jdbc.update("DELETE FROM task_comment WHERE task_id IN (SELECT t.id FROM task t JOIN project p ON p.id = t.project_id WHERE p.workspace_id = ?)", workspaceId);
        jdbc.update("DELETE FROM task WHERE project_id IN (SELECT id FROM project WHERE workspace_id = ?)", workspaceId);
        jdbc.update("DELETE FROM ai_chat_message WHERE chat_id IN (SELECT id FROM ai_chat WHERE workspace_id = ?)", workspaceId);
        jdbc.update("DELETE FROM code_file_version WHERE code_file_id IN (SELECT id FROM code_file WHERE workspace_id = ?)", workspaceId);
        // Stored bytes for these rows are left as orphans under data/uploads/<kind>/<workspaceId>/ and can be removed with that folder.
        for (String table : new String[] {"code_file", "code_project", "drive_file", "drive_folder", "project", "document", "website_preview", "activity_log", "invitation", "notification", "ai_chat", "workspace_member"}) {
            jdbc.update("DELETE FROM " + table + " WHERE workspace_id = ?", workspaceId);
        }
        jdbc.update("UPDATE app_user SET active_workspace_id = NULL WHERE active_workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM workspace WHERE id = ?", workspaceId);
    }
}
