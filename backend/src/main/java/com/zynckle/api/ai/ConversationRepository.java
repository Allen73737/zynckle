package com.zynckle.api.ai;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.io.IOException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

/**
 * Assistant conversations, private to each user. Messages keep the sources and retrieval
 * details they were answered with, so citations still work when a thread is reopened.
 */
@Repository
public class ConversationRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public ConversationRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @PostConstruct
    void createTables() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS ai_chat (
                id VARCHAR(64) PRIMARY KEY,
                workspace_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NOT NULL,
                title VARCHAR(240) NOT NULL,
                mode VARCHAR(24) DEFAULT 'general',
                context_json VARCHAR(4000) DEFAULT '{}',
                pinned BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS ai_chat_message (
                id VARCHAR(64) PRIMARY KEY,
                chat_id VARCHAR(64) NOT NULL,
                seq INT NOT NULL,
                role VARCHAR(16) NOT NULL,
                content TEXT NOT NULL,
                provider VARCHAR(120),
                model VARCHAR(160),
                sources_json TEXT,
                retrieval_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """);
        jdbc.execute("ALTER TABLE ai_chat_message ADD COLUMN IF NOT EXISTS feedback INT DEFAULT 0");
        jdbc.execute("ALTER TABLE ai_chat_message ADD COLUMN IF NOT EXISTS feedback_note VARCHAR(1000)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS ai_chat_user_idx ON ai_chat(workspace_id, user_id, updated_at)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS ai_chat_message_chat_idx ON ai_chat_message(chat_id, seq)");
    }

    private static String iso(Timestamp value) { return value == null ? Instant.now().toString() : value.toInstant().toString(); }

    private Map<String, Object> summary(ResultSet rs) throws SQLException {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", rs.getString("id"));
        item.put("title", rs.getString("title"));
        item.put("mode", rs.getString("mode"));
        item.put("pinned", rs.getBoolean("pinned"));
        item.put("createdAt", iso(rs.getTimestamp("created_at")));
        item.put("updatedAt", iso(rs.getTimestamp("updated_at")));
        item.put("messageCount", rs.getInt("message_count"));
        return item;
    }

    private static final String SUMMARY_SQL = """
        SELECT c.*, (SELECT COUNT(*) FROM ai_chat_message m WHERE m.chat_id = c.id) AS message_count
        FROM ai_chat c WHERE c.workspace_id = ? AND c.user_id = ?""";

    public List<Map<String, Object>> list(String workspaceId, String userId) {
        return jdbc.query(SUMMARY_SQL + " ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 200", (rs, i) -> summary(rs), workspaceId, userId);
    }

    public Optional<Map<String, Object>> summary(String workspaceId, String userId, String id) {
        return jdbc.query(SUMMARY_SQL + " AND c.id = ?", (rs, i) -> summary(rs), workspaceId, userId, id).stream().findFirst();
    }

    /** Full conversation with messages, or empty when it does not belong to this user. */
    public Optional<Map<String, Object>> find(String workspaceId, String userId, String id) {
        Optional<Map<String, Object>> found = summary(workspaceId, userId, id);
        found.ifPresent(conversation -> {
            String contextJson = jdbc.queryForObject("SELECT context_json FROM ai_chat WHERE id = ?", String.class, id);
            conversation.put("context", read(contextJson, new TypeReference<Map<String, Object>>() {}, Map.of()));
            conversation.put("messages", messages(id));
        });
        return found;
    }

    public List<Map<String, Object>> messages(String chatId) {
        return jdbc.query("SELECT * FROM ai_chat_message WHERE chat_id = ? ORDER BY seq", (rs, i) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", rs.getString("id"));
            m.put("role", rs.getString("role"));
            m.put("content", rs.getString("content"));
            m.put("createdAt", iso(rs.getTimestamp("created_at")));
            if (rs.getString("provider") != null) m.put("provider", rs.getString("provider"));
            if (rs.getString("model") != null) m.put("model", rs.getString("model"));
            m.put("sources", read(rs.getString("sources_json"), new TypeReference<List<Object>>() {}, List.of()));
            m.put("retrieval", read(rs.getString("retrieval_json"), new TypeReference<Map<String, Object>>() {}, null));
            m.put("feedback", rs.getInt("feedback"));
            return m;
        }, chatId);
    }

    public String create(String workspaceId, String userId, String title, String mode, Map<String, Object> context) {
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO ai_chat (id, workspace_id, user_id, title, mode, context_json) VALUES (?, ?, ?, ?, ?, ?)",
            id, workspaceId, userId, title, mode, write(context == null ? Map.of() : context));
        return id;
    }

    public String addMessage(String chatId, String role, String content, String provider, String model, Object sources, Object retrieval) {
        String id = UUID.randomUUID().toString();
        Integer seq = jdbc.queryForObject("SELECT COALESCE(MAX(seq), 0) + 1 FROM ai_chat_message WHERE chat_id = ?", Integer.class, chatId);
        jdbc.update("INSERT INTO ai_chat_message (id, chat_id, seq, role, content, provider, model, sources_json, retrieval_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            id, chatId, seq, role, content, provider, model, sources == null ? null : write(sources), retrieval == null ? null : write(retrieval));
        jdbc.update("UPDATE ai_chat SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", chatId);
        return id;
    }

    /** Regenerate: drop trailing assistant messages so the last user turn is answered again. */
    public void dropTrailingAssistant(String chatId) {
        jdbc.update("""
            DELETE FROM ai_chat_message WHERE chat_id = ? AND role = 'assistant'
            AND seq > COALESCE((SELECT MAX(seq) FROM ai_chat_message WHERE chat_id = ? AND role = 'user'), 0)""", chatId, chatId);
    }

    public void updateContext(String chatId, Map<String, Object> context) {
        jdbc.update("UPDATE ai_chat SET context_json = ? WHERE id = ?", write(context), chatId);
    }

    /** Rate an assistant answer: 1 helpful, -1 not helpful, 0 cleared. Only the conversation owner can. */
    public boolean rate(String workspaceId, String userId, String messageId, int rating, String note) {
        return jdbc.update("""
            UPDATE ai_chat_message SET feedback = ?, feedback_note = ? WHERE id = ? AND role = 'assistant'
            AND chat_id IN (SELECT id FROM ai_chat WHERE workspace_id = ? AND user_id = ?)""", rating, note, messageId, workspaceId, userId) == 1;
    }

    /** Answer-quality summary for a workspace: totals plus recent unhelpful answers to review. */
    public Map<String, Object> quality(String workspaceId) {
        Map<String, Object> totals = jdbc.queryForMap("""
            SELECT COUNT(*) AS answers,
                   SUM(CASE WHEN m.feedback = 1 THEN 1 ELSE 0 END) AS helpful,
                   SUM(CASE WHEN m.feedback = -1 THEN 1 ELSE 0 END) AS unhelpful
            FROM ai_chat_message m JOIN ai_chat c ON c.id = m.chat_id WHERE c.workspace_id = ? AND m.role = 'assistant'""", workspaceId);
        List<Map<String, Object>> flagged = jdbc.query("""
            SELECT m.id, m.chat_id, m.content, m.feedback_note, m.created_at, m.sources_json,
                   (SELECT q.content FROM ai_chat_message q WHERE q.chat_id = m.chat_id AND q.role = 'user' AND q.seq < m.seq ORDER BY q.seq DESC LIMIT 1) AS question
            FROM ai_chat_message m JOIN ai_chat c ON c.id = m.chat_id
            WHERE c.workspace_id = ? AND m.feedback = -1 ORDER BY m.created_at DESC LIMIT 20""", (rs, i) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", rs.getString("id"));
            item.put("conversationId", rs.getString("chat_id"));
            item.put("question", rs.getString("question"));
            String answer = rs.getString("content");
            item.put("answer", answer.length() > 400 ? answer.substring(0, 400) + "…" : answer);
            item.put("note", rs.getString("feedback_note"));
            item.put("sourceCount", read(rs.getString("sources_json"), new TypeReference<List<Object>>() {}, List.of()).size());
            item.put("createdAt", iso(rs.getTimestamp("created_at")));
            return item;
        }, workspaceId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("answers", ((Number) totals.get("answers")).intValue());
        out.put("helpful", totals.get("helpful") == null ? 0 : ((Number) totals.get("helpful")).intValue());
        out.put("unhelpful", totals.get("unhelpful") == null ? 0 : ((Number) totals.get("unhelpful")).intValue());
        out.put("flagged", flagged);
        return out;
    }

    public void rename(String chatId, String title) { jdbc.update("UPDATE ai_chat SET title = ? WHERE id = ?", title, chatId); }

    public void pin(String chatId, boolean pinned) { jdbc.update("UPDATE ai_chat SET pinned = ? WHERE id = ?", pinned, chatId); }

    public void delete(String chatId) {
        jdbc.update("DELETE FROM ai_chat_message WHERE chat_id = ?", chatId);
        jdbc.update("DELETE FROM ai_chat WHERE id = ?", chatId);
    }

    private String write(Object value) {
        try { return json.writeValueAsString(value); } catch (IOException e) { throw new IllegalStateException(e); }
    }

    private <T> T read(String value, TypeReference<T> type, T fallback) {
        if (value == null || value.isBlank()) return fallback;
        try { return json.readValue(value, type); } catch (IOException e) { return fallback; }
    }
}
