package com.zynckle.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zynckle.api.ai.rag.RagService;
import com.zynckle.api.ai.rag.TextTools;
import com.zynckle.api.common.RateLimiter;
import com.zynckle.api.insight.InsightsController;
import com.zynckle.api.security.CurrentUser;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Zynckle AI: streaming chat grounded in workspace knowledge, private conversations, and the
 * knowledge index endpoints. The wire format matches the Node API so the frontend is shared.
 */
@RestController
@RequestMapping("/api/ai")
public class AssistantController {
    private static final Set<String> CITE_MODES = Set.of("general", "explain", "review", "bug", "database", "docs");

    private final AiClient ai;
    private final RagService rag;
    private final ConversationRepository conversations;
    private final JdbcTemplate jdbc;
    private final AiSettings settings;
    private final ObjectMapper json;
    private final RateLimiter limiter;
    private final InsightsController.Insights insights;
    private final Map<String, Integer> dailyCounts = new ConcurrentHashMap<>();

    public AssistantController(AiClient ai, RagService rag, ConversationRepository conversations, JdbcTemplate jdbc, AiSettings settings, ObjectMapper json, RateLimiter limiter, InsightsController.Insights insights) {
        this.ai = ai;
        this.rag = rag;
        this.conversations = conversations;
        this.jdbc = jdbc;
        this.settings = settings;
        this.json = json;
        this.limiter = limiter;
        this.insights = insights;
    }

    // ---- Limits ------------------------------------------------------------------

    private void checkLimits(CurrentUser me) {
        limiter.check("ai:" + me.userId(), settings.getInt("AI_REQUESTS_PER_MINUTE", 20), 60_000);
        String day = LocalDate.now(ZoneOffset.UTC).toString();
        dailyCounts.keySet().removeIf(k -> !k.endsWith(day));
        int perDay = settings.getInt("AI_REQUESTS_PER_DAY", 400);
        if (dailyCounts.merge(me.userId() + ":" + day, 1, Integer::sum) > perDay) throw new AiException(429, "Daily AI limit of " + perDay + " requests reached. It resets at midnight UTC.");
    }

    /** The user's saved provider and model, used when a request does not name one. */
    private String[] preferredModel(CurrentUser me) {
        String prefs = jdbc.queryForList("SELECT preferences FROM app_user WHERE id = ?", String.class, me.userId()).stream().findFirst().orElse(null);
        try {
            JsonNode node = prefs == null ? null : json.readTree(prefs);
            if (node == null) return new String[] {null, null};
            String provider = node.path("aiProvider").asText("");
            String model = node.path("aiModel").asText("");
            return new String[] {provider.isBlank() ? null : provider, model.isBlank() ? null : model};
        } catch (IOException e) {
            return new String[] {null, null};
        }
    }

    // ---- Context -----------------------------------------------------------------

    /** Numbered context blocks shared by explicit selection and retrieval, with one character budget. */
    private static final class Context {
        final List<String> blocks = new ArrayList<>();
        final List<Map<String, Object>> sources = new ArrayList<>();
        int budget;

        Context(int budget) { this.budget = budget; }

        int add(String label, String text, Map<String, Object> source, int cap) {
            int room = Math.min(budget, cap);
            if (room <= 200 || text == null || text.isBlank()) return 0;
            String slice = text.length() > room ? text.substring(0, room) + "\n…[truncated]" : text;
            budget -= slice.length();
            int n = sources.size() + 1;
            blocks.add("<context source=\"[" + n + "] " + label.replace('"', '\'') + "\">\n" + slice + "\n</context>");
            Map<String, Object> numbered = new LinkedHashMap<>();
            numbered.put("n", n);
            numbered.putAll(source);
            sources.add(numbered);
            return slice.length();
        }
    }

    private static Map<String, Object> source(String type, String id, String label, String link) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", type); s.put("id", id); s.put("label", label); s.put("link", link);
        return s;
    }

    private static String text(Object value) {
        if (value instanceof java.sql.Clob clob) {
            try { return clob.getSubString(1, (int) clob.length()); } catch (Exception e) { return ""; }
        }
        return value == null ? "" : String.valueOf(value);
    }

    private Context buildContext(CurrentUser me, Map<String, Object> spec) {
        Context context = new Context(settings.getInt("AI_CONTEXT_CHARS", 28_000));
        if (spec == null) return context;
        Object projectId = spec.get("projectId");
        if (projectId instanceof String pid && !pid.isBlank()) {
            List<Map<String, Object>> found = jdbc.queryForList("SELECT * FROM project WHERE id = ? AND workspace_id = ?", pid, me.workspaceId());
            if (!found.isEmpty()) {
                Map<String, Object> p = found.get(0);
                StringBuilder sb = new StringBuilder("Project: " + p.get("name") + "\nStatus: " + p.get("status") + "\nDeadline: " + p.get("due_date") + "\nDescription: " + text(p.get("description")) + "\nTasks:\n");
                for (Map<String, Object> t : jdbc.queryForList("SELECT title, status, priority, due_date, description FROM task WHERE project_id = ? LIMIT 80", pid)) {
                    String description = text(t.get("description"));
                    sb.append("- [").append(t.get("status")).append("] ").append(t.get("title")).append(" (priority ").append(t.get("priority")).append(", due ").append(t.get("due_date")).append(")")
                      .append(description.isBlank() ? "" : " — " + description.substring(0, Math.min(160, description.length()))).append('\n');
                }
                context.add("project: " + p.get("name"), sb.toString(), source("project", pid, String.valueOf(p.get("name")), "/projects/" + pid), Integer.MAX_VALUE);
            }
        }
        if (spec.get("documentIds") instanceof List<?> ids) {
            for (Object id : ids.stream().limit(6).toList()) {
                List<Map<String, Object>> found = jdbc.queryForList("SELECT id, title, content, type FROM document WHERE id = ? AND workspace_id = ?", String.valueOf(id), me.workspaceId());
                if (found.isEmpty()) continue;
                Map<String, Object> d = found.get(0);
                boolean latex = "latex".equals(d.get("type"));
                String content = text(d.get("content"));
                context.add("document: " + d.get("title"), latex ? content : TextTools.htmlToText(content),
                    source(latex ? "latex" : "document", String.valueOf(id), String.valueOf(d.get("title")), latex ? "/latex?doc=" + id : "/documents?doc=" + id), Integer.MAX_VALUE);
            }
        }
        if (Boolean.TRUE.equals(spec.get("workspace"))) {
            StringBuilder sb = new StringBuilder("Workspace: " + me.workspaceName() + "\nProjects:\n");
            for (Map<String, Object> p : jdbc.queryForList("""
                    SELECT p.name, p.status, (SELECT COUNT(*) FROM task t WHERE t.project_id = p.id AND t.status <> 'Done') AS open_tasks
                    FROM project p WHERE p.workspace_id = ?""", me.workspaceId())) {
                sb.append("- ").append(p.get("name")).append(" (").append(p.get("status")).append("; ").append(p.get("open_tasks")).append(" open tasks)\n");
            }
            context.add("workspace overview", sb.toString(), source("workspace", me.workspaceId(), "Workspace overview", "/"), Integer.MAX_VALUE);
        }
        return context;
    }

    /** Compact id index so proposed actions can reference real projects, tasks and people. */
    private String workspaceIndex(CurrentUser me) {
        StringBuilder sb = new StringBuilder("Workspace index (ids for actions):\nProjects:\n");
        for (Map<String, Object> p : jdbc.queryForList("SELECT id, name, status FROM project WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 40", me.workspaceId())) {
            sb.append("- ").append(p.get("id")).append(" · ").append(p.get("name")).append(" (").append(p.get("status")).append(")\n");
        }
        sb.append("Open tasks (most recent first):\n");
        for (Map<String, Object> t : jdbc.queryForList("""
                SELECT t.id, t.title, t.status, t.due_date, p.name AS project FROM task t JOIN project p ON p.id = t.project_id
                WHERE p.workspace_id = ? AND COALESCE(t.done, FALSE) = FALSE AND t.status <> 'Done' ORDER BY t.updated_at DESC LIMIT 80""", me.workspaceId())) {
            sb.append("- ").append(t.get("id")).append(" · ").append(t.get("title")).append(" [").append(t.get("status")).append("] in ").append(t.get("project"))
              .append(t.get("due_date") != null && !"No date".equals(t.get("due_date")) ? ", due " + t.get("due_date") : "").append('\n');
        }
        sb.append("Members:\n");
        for (Map<String, Object> m : jdbc.queryForList("SELECT u.id, u.display_name, w.role FROM workspace_member w JOIN app_user u ON u.id = w.user_id WHERE w.workspace_id = ?", me.workspaceId())) {
            sb.append("- ").append(m.get("id")).append(" · ").append(m.get("display_name")).append(" (").append(m.get("role")).append(")\n");
        }
        return sb.toString();
    }

    // ---- Retrieval -----------------------------------------------------------------

    private List<String> planQueries(AiClient.Resolved provider, List<Map<String, String>> history) {
        StringBuilder transcript = new StringBuilder();
        for (Map<String, String> m : history.subList(Math.max(0, history.size() - 6), history.size())) {
            String content = m.get("content");
            transcript.append(m.get("role").toUpperCase(Locale.ROOT)).append(": ").append(content, 0, Math.min(1500, content.length())).append("\n\n");
        }
        try {
            String raw = ai.complete(provider, List.of(Map.of("role", "system", "content", Prompts.QUERY_PLANNER), Map.of("role", "user", "content", transcript.toString())), 0, 300, Duration.ofSeconds(12));
            JsonNode plan = json.readTree(raw.substring(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
            List<String> queries = new ArrayList<>();
            if (plan.path("standalone").isTextual()) queries.add(plan.path("standalone").asText());
            plan.path("queries").forEach(q -> { if (q.isTextual()) queries.add(q.asText()); });
            return queries.stream().filter(q -> !q.isBlank()).map(q -> q.length() > 300 ? q.substring(0, 300) : q).limit(6).toList();
        } catch (RuntimeException | IOException e) {
            return List.of();
        }
    }

    /** The latest message, plus the previous one when it reads like a follow-up. */
    private static List<String> autoQueries(List<Map<String, String>> history) {
        List<String> users = history.stream().filter(m -> "user".equals(m.get("role"))).map(m -> m.get("content")).toList();
        if (users.isEmpty()) return List.of();
        String last = users.get(users.size() - 1);
        List<String> queries = new ArrayList<>(List.of(last.length() > 2000 ? last.substring(0, 2000) : last));
        if (users.size() > 1 && last.trim().split("\\s+").length < 14) {
            String previous = users.get(users.size() - 2);
            queries.add(previous.substring(0, Math.min(600, previous.length())) + " " + last);
        }
        return queries;
    }

    private Map<String, Object> retrieve(CurrentUser me, AiClient.Resolved provider, Context context, List<String> queries, String ragMode) {
        List<String> exclude = context.sources.stream()
            .filter(s -> List.of("document", "latex", "project").contains(s.get("type")))
            .map(s -> ("latex".equals(s.get("type")) ? "document" : s.get("type")) + ":" + s.get("id")).toList();
        boolean deep = "deep".equals(ragMode);
        RagService.Result result = rag.search(me.workspaceId(), queries, deep ? 20 : 8, null, exclude);
        List<RagService.Hit> hits = result.hits();
        boolean reranked = false;
        if (deep && hits.size() > 3) {
            List<RagService.Hit> ordered = rerank(provider, queries.get(0), hits);
            reranked = ordered != hits;
            hits = ordered.subList(0, Math.min(12, ordered.size()));
        }
        int room = Math.min(settings.getInt("RAG_CONTEXT_CHARS", 14_000), context.budget);
        int used = 0;
        String joined = String.join(" ", queries);
        for (RagService.Passage passage : RagService.toPassages(hits)) {
            if (room < 300) break;
            RagService.Chunk first = passage.first();
            String where = passage.location() == null || passage.location().isBlank() ? "" : " (" + passage.location() + ")";
            Map<String, Object> s = source(first.type, first.sourceId, first.title, first.link);
            s.put("location", passage.location() == null || passage.location().isBlank() ? null : passage.location());
            s.put("snippet", TextTools.snippet(passage.text(), joined, 260));
            s.put("score", Math.round(passage.score() * 1000) / 1000.0);
            s.put("retrieved", true);
            int size = context.add(first.type + ": " + first.title + where, passage.text(), s, Math.min(room, 3200));
            if (size == 0) break;
            room -= size;
            used++;
        }
        Map<String, Object> retrieval = new LinkedHashMap<>();
        retrieval.put("rag", ragMode);
        retrieval.put("mode", result.mode());
        retrieval.put("queries", result.queries());
        retrieval.put("tookMs", result.tookMs());
        retrieval.put("passages", used);
        retrieval.put("indexed", Map.of("chunks", result.chunks(), "sources", result.sources()));
        retrieval.put("reranked", reranked);
        return retrieval;
    }

    /**
     * Deep mode: one short model call orders the fused candidates by how directly they answer
     * the question. Falls back to the fused order on any failure. Returned hits carry a
     * descending score so later merging keeps the model's order.
     */
    private List<RagService.Hit> rerank(AiClient.Resolved provider, String question, List<RagService.Hit> hits) {
        StringBuilder list = new StringBuilder();
        for (int i = 0; i < hits.size(); i++) {
            RagService.Chunk c = hits.get(i).chunk();
            String text = c.text.replaceAll("\\s+", " ");
            list.append('[').append(i + 1).append("] ").append(c.type).append(": ").append(c.title).append(" — ").append(text, 0, Math.min(320, text.length())).append('\n');
        }
        try {
            String raw = ai.complete(provider, List.of(
                Map.of("role", "system", "content", Prompts.RERANK),
                Map.of("role", "user", "content", "Question: " + question + "\n\nCandidates:\n" + list)), 0, 200, Duration.ofSeconds(12));
            JsonNode order = json.readTree(raw.substring(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).path("ranking");
            List<RagService.Hit> out = new ArrayList<>();
            Set<Integer> used = new HashSet<>();
            for (JsonNode n : order) {
                int i = n.asInt() - 1;
                if (i >= 0 && i < hits.size() && used.add(i)) out.add(hits.get(i));
            }
            if (out.isEmpty()) return hits;
            // Unranked candidates are the ones the model judged irrelevant: drop them.
            List<RagService.Hit> scored = new ArrayList<>();
            for (int i = 0; i < out.size(); i++) {
                RagService.Hit h = out.get(i);
                scored.add(new RagService.Hit(h.chunk(), 1.0 - (double) i / out.size(), h.lexical(), h.semantic()));
            }
            return scored;
        } catch (RuntimeException | IOException e) {
            return hits;
        }
    }

    // ---- Request preparation ------------------------------------------------------------

    private record Prepared(String mode, AiClient.Resolved provider, List<Map<String, String>> messages, double temperature,
                            String conversationId, List<Map<String, Object>> sources, String section, Map<String, Object> retrieval, boolean firstTurn) {}

    private static String message(Map<String, Object> body) {
        Object value = body.get("message");
        if (!(value instanceof String s) || s.isBlank()) throw new AiException(400, "Message is required");
        if (s.length() > 16_000) throw new AiException(400, "Message must be 16000 characters or fewer");
        return s;
    }

    @SuppressWarnings("unchecked")
    private Prepared prepare(CurrentUser me, Map<String, Object> body) {
        String mode = Prompts.MODES.containsKey(String.valueOf(body.get("mode"))) ? String.valueOf(body.get("mode")) : "general";
        String[] preferred = preferredModel(me);
        String requestedProvider = body.get("provider") instanceof String rp && !rp.isBlank() ? rp : preferred[0];
        String requestedModel = body.get("model") instanceof String rm && !rm.isBlank() ? rm : requestedProvider != null && requestedProvider.equals(preferred[0]) ? preferred[1] : null;
        AiClient.Resolved provider = ai.resolve(requestedProvider, requestedModel);
        Map<String, Object> spec = body.get("context") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        Context context = buildContext(me, spec);
        if ("brief".equals(mode)) context.add("workspace health", insights.asContext(me), source("workspace", me.workspaceId(), "Workspace health", "/"), Integer.MAX_VALUE);
        List<Map<String, String>> history = new ArrayList<>();
        String conversationId = null;
        String section = null;
        boolean firstTurn = false;

        if ("architecture".equals(mode)) {
            section = String.valueOf(body.get("section"));
            if (!Prompts.ARCHITECTURE_SECTIONS.containsKey(section)) throw new AiException(400, "Unknown architecture section");
            String description = String.valueOf(body.getOrDefault("description", ""));
            if (description.length() < 20) throw new AiException(400, "Project description must be at least 20 characters");
            String overview = body.get("overview") instanceof String o && !"overview".equals(section) ? o.substring(0, Math.min(6000, o.length())) : "";
            String guidance = body.get("guidance") instanceof String g ? g.substring(0, Math.min(1000, g.length())) : "";
            history.add(Map.of("role", "user", "content", "Project description from the user:\n\"\"\"\n" + description.substring(0, Math.min(8000, description.length())) + "\n\"\"\"\n"
                + (overview.isEmpty() ? "" : "\nAgreed system overview (keep consistent with it):\n\"\"\"\n" + overview + "\n\"\"\"\n")
                + (guidance.isEmpty() ? "" : "\nExtra guidance for this section: " + guidance + "\n")
                + "\nWrite this section now: " + Prompts.ARCHITECTURE_SECTIONS.get(section)));
        } else if (body.get("conversationId") instanceof String cid && !cid.isBlank()) {
            if (conversations.summary(me.workspaceId(), me.userId(), cid).isEmpty()) throw new AiException(404, "Conversation not found");
            conversationId = cid;
            if (Boolean.TRUE.equals(body.get("regenerate"))) conversations.dropTrailingAssistant(cid);
            else conversations.addMessage(cid, "user", message(body), null, null, null, null);
            if (!spec.isEmpty()) conversations.updateContext(cid, spec);
            List<Map<String, Object>> stored = conversations.messages(cid);
            for (Map<String, Object> m : stored.subList(Math.max(0, stored.size() - 30), stored.size())) history.add(Map.of("role", String.valueOf(m.get("role")), "content", String.valueOf(m.get("content"))));
        } else if (Boolean.TRUE.equals(body.get("persist"))) {
            String text = message(body);
            String title = text.replaceAll("\\s+", " ").trim();
            conversationId = conversations.create(me.workspaceId(), me.userId(), title.substring(0, Math.min(70, title.length())), mode, spec);
            conversations.addMessage(conversationId, "user", text, null, null, null, null);
            history.add(Map.of("role", "user", "content", text));
            firstTurn = true;
        } else {
            if (!(body.get("messages") instanceof List<?> list) || list.isEmpty() || list.size() > 60) throw new AiException(400, "Provide between 1 and 60 messages");
            for (Object item : list) {
                if (item instanceof Map<?, ?> m && ("user".equals(m.get("role")) || "assistant".equals(m.get("role"))) && m.get("content") instanceof String c && !c.isBlank()) {
                    history.add(Map.of("role", String.valueOf(m.get("role")), "content", c.substring(0, Math.min(16_000, c.length()))));
                }
            }
            if (history.size() > 30) history = new ArrayList<>(history.subList(history.size() - 30, history.size()));
            if (history.isEmpty()) throw new AiException(400, "Provide between 1 and 60 messages");
        }

        String ragMode = List.of("off", "auto", "deep").contains(String.valueOf(body.get("rag"))) ? String.valueOf(body.get("rag")) : "auto";
        Map<String, Object> retrieval = null;
        if (!"off".equals(ragMode) && CITE_MODES.contains(mode)) {
            List<String> queries = new ArrayList<>();
            if ("deep".equals(ragMode)) queries.addAll(planQueries(provider, history));
            queries.addAll(autoQueries(history));
            retrieval = retrieve(me, provider, context, queries, ragMode);
        }

        List<Map<String, String>> messages = new ArrayList<>();
        messages.add(Map.of("role", "system", "content", Prompts.MODES.get(mode) + "\n\nToday is " + LocalDate.now(ZoneOffset.UTC) + ". The user is " + me.name() + " in workspace \"" + me.workspaceName() + "\"."));
        if (!context.blocks.isEmpty()) {
            messages.add(Map.of("role", "system", "content", "Reference material for this request:\n" + String.join("\n\n", context.blocks) + (CITE_MODES.contains(mode) ? "\n\n" + Prompts.CITATION_RULES : "")));
        }
        // Viewers cannot change anything, so they are never offered actions.
        if ("general".equals(mode) && me.canEdit() && !Boolean.FALSE.equals(body.get("actions"))) {
            messages.add(Map.of("role", "system", "content", Prompts.ACTIONS + "\n\n" + workspaceIndex(me)));
        }
        messages.addAll(history);
        double temperature = "planner".equals(mode) || "components".equals(section) ? 0.2 : "review".equals(mode) || "docs".equals(mode) ? 0.25 : 0.4;
        return new Prepared(mode, provider, messages, temperature, conversationId, context.sources, section, retrieval, firstTurn);
    }

    // ---- Endpoints -----------------------------------------------------------------------

    @GetMapping("/status")
    public Map<String, Object> status() { return ai.status(); }

    @PostMapping("/chat")
    public Map<String, Object> chat(CurrentUser me, @RequestBody Map<String, Object> body) {
        checkLimits(me);
        Prepared prepared = prepare(me, body);
        String text = ai.complete(prepared.provider(), prepared.messages(), prepared.temperature(), 2400, Duration.ofSeconds(120));
        if (prepared.conversationId() != null && !text.isEmpty()) {
            conversations.addMessage(prepared.conversationId(), "assistant", text, prepared.provider().label(), prepared.provider().model(), prepared.sources(), prepared.retrieval());
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", text);
        out.put("model", prepared.provider().model());
        out.put("provider", prepared.provider().label());
        out.put("sources", prepared.sources());
        out.put("retrieval", prepared.retrieval());
        out.put("conversationId", prepared.conversationId());
        return out;
    }

    /** Server-sent events: meta → many delta frames → done (or error). */
    @PostMapping("/stream")
    public ResponseEntity<StreamingResponseBody> stream(CurrentUser me, @RequestBody Map<String, Object> body) {
        checkLimits(me);
        Prepared prepared = prepare(me, body);
        StreamingResponseBody stream = out -> {
            AtomicBoolean closed = new AtomicBoolean(false);
            StringBuilder text = new StringBuilder();
            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("conversationId", prepared.conversationId());
            meta.put("provider", prepared.provider().label());
            meta.put("providerId", prepared.provider().providerId());
            meta.put("model", prepared.provider().model());
            meta.put("sources", prepared.sources());
            meta.put("mode", prepared.mode());
            meta.put("section", prepared.section());
            meta.put("retrieval", prepared.retrieval());
            send(out, "meta", meta, closed);
            try {
                ai.stream(prepared.provider(), prepared.messages(), prepared.temperature(), 2400, Duration.ofSeconds(120), delta -> {
                    text.append(delta);
                    send(out, "delta", Map.of("text", delta), closed);
                }, closed::get);
                String messageId = null;
                if (prepared.conversationId() != null && !text.isEmpty()) {
                    messageId = conversations.addMessage(prepared.conversationId(), "assistant", text.toString(), prepared.provider().label(), prepared.provider().model(), prepared.sources(), prepared.retrieval());
                }
                Map<String, Object> done = new LinkedHashMap<>();
                done.put("messageId", messageId);
                done.put("length", text.length());
                send(out, "done", done, closed);
            } catch (AiException e) {
                // A brand-new conversation that never got an answer is not worth keeping.
                if (prepared.firstTurn() && text.isEmpty()) conversations.delete(prepared.conversationId());
                send(out, "error", Map.of("error", e.getMessage(), "status", e.status()), closed);
            }
        };
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_TYPE, "text/event-stream;charset=UTF-8")
            .header(HttpHeaders.CACHE_CONTROL, "no-cache, no-transform")
            .header("X-Accel-Buffering", "no")
            .body(stream);
    }

    private void send(OutputStream out, String event, Object data, AtomicBoolean closed) {
        if (closed.get()) return;
        try {
            out.write(("event: " + event + "\ndata: " + json.writeValueAsString(data) + "\n\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
        } catch (IOException e) {
            closed.set(true); // the browser went away; stop pulling tokens from the provider
        }
    }

    // ---- Conversations (private to the local user) ----

    @GetMapping("/conversations")
    public List<Map<String, Object>> listConversations(CurrentUser me) { return conversations.list(me.workspaceId(), me.userId()); }

    @GetMapping("/conversations/{id}")
    public Map<String, Object> conversation(CurrentUser me, @PathVariable String id) {
        return conversations.find(me.workspaceId(), me.userId(), id).orElseThrow(() -> new AiException(404, "Conversation not found"));
    }

    @PatchMapping("/conversations/{id}")
    public Map<String, Object> updateConversation(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        if (conversations.summary(me.workspaceId(), me.userId(), id).isEmpty()) throw new AiException(404, "Conversation not found");
        if (body.get("title") instanceof String title) {
            if (title.isBlank() || title.length() > 120) throw new AiException(400, "Title must be between 1 and 120 characters");
            conversations.rename(id, title.trim());
        }
        if (body.get("pinned") instanceof Boolean pinned) conversations.pin(id, pinned);
        return conversations.summary(me.workspaceId(), me.userId(), id).orElseThrow();
    }

    @DeleteMapping("/conversations/{id}")
    public Map<String, Object> deleteConversation(CurrentUser me, @PathVariable String id) {
        if (conversations.summary(me.workspaceId(), me.userId(), id).isEmpty()) throw new AiException(404, "Conversation not found");
        conversations.delete(id);
        return Map.of("deleted", true);
    }

    @PatchMapping("/messages/{id}/feedback")
    public Map<String, Object> feedback(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        int rating = body.get("rating") instanceof Number n ? Integer.signum(n.intValue()) : 0;
        String note = body.get("note") instanceof String s && !s.isBlank() ? s.substring(0, Math.min(1000, s.length())) : null;
        if (!conversations.rate(me.workspaceId(), me.userId(), id, rating, note)) throw new AiException(404, "Answer not found");
        return Map.of("id", id, "feedback", rating);
    }

    /** Workspace-wide answer quality, so admins can review answers people marked unhelpful. */
    @GetMapping("/quality")
    public Map<String, Object> quality(CurrentUser me) {
        me.requireAdmin();
        return conversations.quality(me.workspaceId());
    }

    // ---- Workspace knowledge (RAG index) ----

    @GetMapping("/knowledge")
    public Map<String, Object> knowledge(CurrentUser me) {
        rag.sync(me.workspaceId(), false);
        return rag.status(me.workspaceId());
    }

    @PostMapping("/knowledge/reindex")
    public Map<String, Object> reindex(CurrentUser me, @RequestBody(required = false) Map<String, Object> body) {
        limiter.check("rag-reindex:" + me.workspaceId(), 6, 60_000);
        rag.sync(me.workspaceId(), true);
        if (body != null && Boolean.TRUE.equals(body.get("wait"))) rag.awaitEmbeddings(Duration.ofSeconds(120));
        return rag.status(me.workspaceId());
    }

    @GetMapping("/knowledge/search")
    public Map<String, Object> search(CurrentUser me, @RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "") String types, @RequestParam(defaultValue = "12") int limit) {
        limiter.check("rag-search:" + me.userId(), 120, 60_000);
        String query = q.trim();
        if (query.length() > 500) query = query.substring(0, 500);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("query", query);
        if (query.length() < 2) {
            out.put("results", List.of()); out.put("mode", "lexical"); out.put("tookMs", 0);
            return out;
        }
        List<String> typeList = Arrays.stream(types.split(",")).filter(RagService.TYPES::contains).toList();
        RagService.Result result = rag.search(me.workspaceId(), List.of(query), Math.max(1, Math.min(30, limit)), typeList, List.of());
        List<Map<String, Object>> results = new ArrayList<>();
        for (RagService.Hit hit : result.hits()) {
            RagService.Chunk c = hit.chunk();
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", c.id); item.put("type", c.type); item.put("sourceId", c.sourceId); item.put("title", c.title);
            item.put("section", c.section == null || c.section.isBlank() ? null : c.section);
            item.put("location", c.location == null || c.location.isBlank() ? null : c.location);
            item.put("link", c.link); item.put("updatedAt", c.updatedAt == null || c.updatedAt.isBlank() ? null : c.updatedAt);
            item.put("snippet", TextTools.snippet(c.text, query, 320));
            item.put("score", Math.round(hit.score() * 1000) / 1000.0);
            Map<String, Object> signals = new LinkedHashMap<>();
            signals.put("lexical", hit.lexical() == null ? null : Math.round(hit.lexical() * 1000) / 1000.0);
            signals.put("semantic", hit.semantic() == null ? null : Math.round(hit.semantic() * 1000) / 1000.0);
            item.put("signals", signals);
            results.add(item);
        }
        out.put("mode", result.mode());
        out.put("tookMs", result.tookMs());
        out.put("indexed", Map.of("chunks", result.chunks(), "sources", result.sources()));
        out.put("results", results);
        return out;
    }
}
