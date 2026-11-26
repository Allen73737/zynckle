package com.zynckle.api.ai.rag;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zynckle.api.ai.AiClient;
import com.zynckle.api.ai.AiException;
import com.zynckle.api.ai.AiSettings;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Predicate;

/**
 * Workspace retrieval engine (RAG).
 *
 * Each workspace gets an in-memory index of chunked passages drawn from projects, tasks and
 * their comments, documents, LaTeX papers and website previews. The index syncs lazily: each
 * query fingerprints the sources and re-chunks only what changed, so no controller has to
 * remember to update it.
 *
 * Ranking is hybrid: BM25 over a code-aware tokenizer always runs; when an embedding provider
 * is configured, dense cosine similarity runs too and both lists are merged with reciprocal
 * rank fusion. Every row in the Java schema is visible to the whole workspace, so scoping by
 * workspace is the permission check; add a filter in {@link #search} if per-item visibility
 * is introduced.
 */
@Service
public class RagService {
    private static final Logger log = LoggerFactory.getLogger(RagService.class);
    private static final int MAX_CHUNKS = 25_000;
    private static final int PER_SOURCE_CAP = 3;
    private static final int RRF_K = 60;

    public static final List<String> TYPES = List.of("project", "task", "document", "latex", "preview", "code-file", "file");
    private static final java.util.regex.Pattern SKIP_PATH = java.util.regex.Pattern.compile("(^|/)(node_modules|dist|build|out|target|vendor|\\.git|\\.next|coverage|__pycache__)/|(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml)$|\\.min\\.(js|css)$|\\.map$", java.util.regex.Pattern.CASE_INSENSITIVE);
    private static final java.util.regex.Pattern PROSE = java.util.regex.Pattern.compile("(?i).*\\.(md|markdown|mdx|txt|rst|adoc)$");

    /** A source's fingerprint is cheap to compute; its text is only loaded when the fingerprint changed. */
    record Source(String key, String type, String id, String title, String link, String updatedAt, String kind, String fp, java.util.function.Supplier<String> loader) {
        Source(String key, String type, String id, String title, String link, String updatedAt, String kind, String text) {
            this(key, type, id, title, link, updatedAt, kind, sha256(title + "\u0000" + text), () -> text);
        }
        String text() { return loader.get(); }
    }

    public static final class Chunk {
        public String id, sourceKey, type, sourceId, title, link, updatedAt, section, location, text, hash;
        public int seq, startLine, endLine, length;
    }

    public record Hit(Chunk chunk, double score, Double lexical, Double semantic) {}

    public record Passage(Chunk first, String text, String location, double score, int lastSeq, int endLine) {}

    public record Result(List<Hit> hits, List<String> queries, long tookMs, String mode, int chunks, int sources) {}

    private static final class SourceEntry { String fp; String type; List<String> chunkIds = new ArrayList<>(); }

    private static final class Index {
        final Map<String, Chunk> chunks = new HashMap<>();
        final Map<String, SourceEntry> sources = new HashMap<>();
        final Map<String, Map<String, Integer>> postings = new HashMap<>();
        long totalLength;
        long seq;
        String syncedAt;
    }

    private record EmbeddingConfig(String label, String url, String key, String model, int dims) {}

    private final JdbcTemplate jdbc;
    private final com.zynckle.api.storage.BlobStore blobs;
    private final AiClient ai;
    private final AiSettings settings;
    private final ObjectMapper json;
    private final Map<String, Index> indexes = new ConcurrentHashMap<>();
    private final Map<String, float[]> vectors = new ConcurrentHashMap<>();
    private final Map<String, float[]> queryVectors = Collections.synchronizedMap(new LinkedHashMap<>(16, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, float[]> eldest) { return size() > 300; }
    });
    private final ExecutorService embedder = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "rag-embedder"); t.setDaemon(true); return t; });
    private final Path vectorFile = Path.of("data", "rag-vectors.json");
    private volatile boolean vectorsLoaded;
    private volatile boolean embedRunning;
    private volatile String embedError;
    private volatile String embedRunAt;
    private Future<?> pendingEmbed = CompletableFuture.completedFuture(null);

    public RagService(JdbcTemplate jdbc, com.zynckle.api.storage.BlobStore blobs, AiClient ai, AiSettings settings, ObjectMapper json) {
        this.jdbc = jdbc;
        this.blobs = blobs;
        this.ai = ai;
        this.settings = settings;
        this.json = json;
    }

    @PreDestroy
    void shutdown() { embedder.shutdownNow(); }

    // ---- Sources ---------------------------------------------------------------

    private List<Map<String, Object>> rows(String sql, Object... args) {
        try { return jdbc.queryForList(sql, args); }
        catch (RuntimeException e) { log.warn("RAG source query failed: {}", e.getMessage()); return List.of(); }
    }

    private static String str(Object value) {
        if (value == null) return "";
        if (value instanceof java.sql.Clob clob) {
            try { return clob.getSubString(1, (int) Math.min(Integer.MAX_VALUE, clob.length())); } catch (Exception e) { return ""; }
        }
        return String.valueOf(value);
    }

    private List<Source> sourcesFor(String workspaceId) {
        List<Source> list = new ArrayList<>();
        for (Map<String, Object> p : rows("SELECT id, name, description, status, due_date, updated_at FROM project WHERE workspace_id = ?", workspaceId)) {
            String text = "Project: " + str(p.get("name")) + "\nStatus: " + str(p.get("status")) + "\nDeadline: " + str(p.get("due_date")) + "\n\n" + str(p.get("description"));
            list.add(new Source("project:" + p.get("id"), "project", str(p.get("id")), str(p.get("name")), "/projects/" + p.get("id"), str(p.get("updated_at")), "prose", text));
        }
        Map<String, List<String>> comments = new HashMap<>();
        for (Map<String, Object> c : rows("""
                SELECT c.task_id, c.author_name, c.body FROM task_comment c
                JOIN task t ON t.id = c.task_id JOIN project p ON p.id = t.project_id
                WHERE p.workspace_id = ? ORDER BY c.created_at""", workspaceId)) {
            comments.computeIfAbsent(str(c.get("task_id")), k -> new ArrayList<>()).add("- " + str(c.get("author_name")) + ": " + str(c.get("body")));
        }
        for (Map<String, Object> t : rows("""
                SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority, t.due_date, t.updated_at, p.name AS project_name
                FROM task t JOIN project p ON p.id = t.project_id WHERE p.workspace_id = ?""", workspaceId)) {
            List<String> thread = comments.getOrDefault(str(t.get("id")), List.of());
            String text = "Task: " + str(t.get("title")) + "\nProject: " + str(t.get("project_name")) + "\nStatus: " + str(t.get("status"))
                + "\nPriority: " + str(t.get("priority")) + "\nDue: " + str(t.get("due_date")) + "\n\n" + str(t.get("description"))
                + (thread.isEmpty() ? "" : "\n\nComments:\n" + String.join("\n", thread.subList(Math.max(0, thread.size() - 20), thread.size())));
            list.add(new Source("task:" + t.get("id"), "task", str(t.get("id")), str(t.get("title")), "/projects/" + t.get("project_id") + "?task=" + t.get("id"), str(t.get("updated_at")), "prose", text));
        }
        for (Map<String, Object> d : rows("SELECT id, title, content, type, updated_at FROM document WHERE workspace_id = ? AND type <> 'latex-template' AND COALESCE(visibility, 'workspace') <> 'private'", workspaceId)) {
            boolean latex = "latex".equals(str(d.get("type")));
            String id = str(d.get("id"));
            String content = str(d.get("content"));
            list.add(new Source("document:" + id, latex ? "latex" : "document", id, str(d.get("title")).isBlank() ? "Untitled" : str(d.get("title")),
                latex ? "/latex?doc=" + id : "/documents?doc=" + id, str(d.get("updated_at")), "prose", latex ? TextTools.latexToText(content) : TextTools.htmlToText(content)));
        }
        for (Map<String, Object> f : rows("SELECT id, code_project_id, path, storage_key, size_bytes, updated_at FROM code_file WHERE workspace_id = ? AND is_binary = FALSE AND size_bytes <= 400000", workspaceId)) {
            String path = str(f.get("path"));
            if (SKIP_PATH.matcher(path).find()) continue;
            String key = str(f.get("storage_key"));
            list.add(new Source("code-file:" + f.get("id"), "code-file", str(f.get("id")), path, "/code/" + f.get("code_project_id") + "?file=" + f.get("id"), str(f.get("updated_at")),
                PROSE.matcher(path).matches() ? "prose" : "code", key + ":" + f.get("size_bytes"), () -> readBlob(key)));
        }
        // Private Drive files are left out: retrieval is workspace-wide.
        for (Map<String, Object> f : rows("""
                SELECT id, name, mime_type, storage_key, size_bytes, updated_at FROM drive_file
                WHERE workspace_id = ? AND COALESCE(visibility, 'workspace') <> 'private' AND size_bytes <= 400000
                AND (mime_type LIKE 'text/%' OR mime_type = 'application/json')""", workspaceId)) {
            String name = str(f.get("name"));
            String key = str(f.get("storage_key"));
            String kind = "text/html".equals(str(f.get("mime_type"))) ? "html" : PROSE.matcher(name).matches() || "text/plain".equals(str(f.get("mime_type"))) ? "prose" : "code";
            list.add(new Source("file:" + f.get("id"), "file", str(f.get("id")), name, "/drive?file=" + f.get("id"), str(f.get("updated_at")), kind,
                key + ":" + f.get("size_bytes") + ":" + str(f.get("updated_at")), () -> readBlob(key)));
        }
        for (Map<String, Object> v : rows("SELECT id, title, url, description, created_at FROM website_preview WHERE workspace_id = ?", workspaceId)) {
            String text = "Website preview: " + str(v.get("title")) + "\nURL: " + str(v.get("url")) + "\n\n" + str(v.get("description"));
            list.add(new Source("preview:" + v.get("id"), "preview", str(v.get("id")), str(v.get("title")), "/previews?preview=" + v.get("id"), str(v.get("created_at")), "prose", text));
        }
        return list;
    }

    private String readBlob(String key) {
        try {
            byte[] bytes = blobs.get(key);
            for (int i = 0; i < Math.min(bytes.length, 8000); i++) if (bytes[i] == 0) return "";
            return new String(bytes, StandardCharsets.UTF_8);
        } catch (RuntimeException e) {
            return "";
        }
    }

    // ---- Index -----------------------------------------------------------------

    private static void addChunk(Index index, Chunk chunk, List<String> terms) {
        Map<String, Integer> counts = new HashMap<>();
        for (String term : terms) counts.merge(term, 1, Integer::sum);
        for (Map.Entry<String, Integer> e : counts.entrySet()) index.postings.computeIfAbsent(e.getKey(), k -> new HashMap<>()).put(chunk.id, e.getValue());
        chunk.length = terms.size();
        index.totalLength += chunk.length;
        index.chunks.put(chunk.id, chunk);
    }

    private static void removeSource(Index index, String key) {
        SourceEntry source = index.sources.remove(key);
        if (source == null) return;
        Set<String> removed = new HashSet<>(source.chunkIds);
        for (String chunkId : removed) {
            Chunk chunk = index.chunks.remove(chunkId);
            if (chunk != null) index.totalLength -= chunk.length;
        }
        index.postings.values().removeIf(posting -> { posting.keySet().removeAll(removed); return posting.isEmpty(); });
    }

    private static List<Chunk> buildChunks(Source source, Index index, Map<String, List<String>> termsOut) {
        String text = source.text();
        if (text == null || text.isBlank()) return List.of();
        List<TextTools.Piece> pieces = "code".equals(source.kind()) ? TextTools.chunkCode(text)
            : TextTools.chunkProse("html".equals(source.kind()) ? TextTools.htmlToText(text) : text);
        List<Chunk> chunks = new ArrayList<>();
        for (int seq = 0; seq < pieces.size(); seq++) {
            TextTools.Piece piece = pieces.get(seq);
            Chunk c = new Chunk();
            c.id = source.key() + "#" + index.seq++;
            c.sourceKey = source.key(); c.type = source.type(); c.sourceId = source.id(); c.title = source.title(); c.link = source.link();
            c.updatedAt = source.updatedAt(); c.seq = seq; c.section = piece.section(); c.text = piece.text();
            c.startLine = piece.startLine(); c.endLine = piece.endLine();
            c.location = piece.startLine() > 0 ? "lines " + piece.startLine() + "–" + piece.endLine() : piece.section();
            c.hash = sha256(source.title() + "\n" + piece.text());
            // Titles and section names are indexed twice: matches there are strong evidence.
            String header = source.title() + " " + source.title() + " " + piece.section() + " " + piece.section();
            termsOut.put(c.id, TextTools.tokenize(header + "\n" + piece.text()));
            chunks.add(c);
        }
        return chunks;
    }

    /** Bring a workspace index up to date with the database. */
    public void sync(String workspaceId, boolean force) {
        if (force) indexes.remove(workspaceId);
        Index index = indexes.computeIfAbsent(workspaceId, k -> new Index());
        synchronized (index) {
            List<Source> sources = sourcesFor(workspaceId);
            Set<String> live = new HashSet<>();
            boolean changed = false;
            for (Source s : sources) live.add(s.key());
            for (String key : new ArrayList<>(index.sources.keySet())) if (!live.contains(key)) { removeSource(index, key); changed = true; }
            for (Source source : sources) {
                String fp = source.fp();
                SourceEntry existing = index.sources.get(source.key());
                if (existing != null && existing.fp.equals(fp)) continue;
                if (existing == null && index.chunks.size() >= MAX_CHUNKS) continue;
                removeSource(index, source.key());
                Map<String, List<String>> terms = new HashMap<>();
                SourceEntry entry = new SourceEntry();
                entry.fp = fp; entry.type = source.type();
                for (Chunk chunk : buildChunks(source, index, terms)) { addChunk(index, chunk, terms.get(chunk.id)); entry.chunkIds.add(chunk.id); }
                index.sources.put(source.key(), entry);
                changed = true;
            }
            index.syncedAt = Instant.now().toString();
            if (changed) queueEmbeddings(index);
        }
    }

    // ---- Embeddings (optional) -----------------------------------------------------

    /**
     * Any OpenAI-compatible /embeddings endpoint works. Gemini's compatible endpoint is used
     * automatically when GEMINI_API_KEY is set; RAG_EMBEDDINGS=off forces lexical-only.
     */
    private EmbeddingConfig embeddingConfig() {
        if ("off".equalsIgnoreCase(settings.get("RAG_EMBEDDINGS"))) return null;
        String url = settings.get("EMBEDDING_URL");
        String model = settings.get("EMBEDDING_MODEL");
        if (!url.isBlank() && !model.isBlank()) return new EmbeddingConfig("Custom embeddings", url, settings.get("EMBEDDING_API_KEY"), model, settings.getInt("EMBEDDING_DIMENSIONS", 0));
        String gemini = settings.get("GEMINI_API_KEY");
        if (!gemini.isBlank()) return new EmbeddingConfig("Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/embeddings", gemini,
            model.isBlank() ? "gemini-embedding-001" : model, settings.getInt("EMBEDDING_DIMENSIONS", 768));
        return null;
    }

    private static float[] normalise(float[] values, int dims) {
        float[] v = dims > 0 && values.length > dims ? Arrays.copyOf(values, dims) : values.clone();
        double norm = 0;
        for (float x : v) norm += x * x;
        norm = Math.sqrt(norm);
        if (norm == 0) norm = 1;
        for (int i = 0; i < v.length; i++) v[i] /= (float) norm;
        return v;
    }

    private List<float[]> embed(EmbeddingConfig config, List<String> inputs, Duration timeout) {
        return ai.embed(config.url(), config.key(), config.model(), inputs, timeout).stream().map(v -> normalise(v, config.dims())).toList();
    }

    private synchronized void loadVectors() {
        if (vectorsLoaded) return;
        vectorsLoaded = true;
        EmbeddingConfig config = embeddingConfig();
        if (config == null || !Files.isRegularFile(vectorFile)) return;
        try {
            JsonNode saved = json.readTree(vectorFile.toFile());
            if (!config.model().equals(saved.path("model").asText())) return;
            saved.path("vectors").fields().forEachRemaining(e -> {
                byte[] bytes = Base64.getDecoder().decode(e.getValue().asText());
                float[] v = new float[bytes.length / 4];
                ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(v);
                vectors.put(e.getKey(), v);
            });
        } catch (IOException e) {
            log.warn("Could not read the RAG vector cache: {}", e.getMessage());
        }
    }

    private void saveVectors(EmbeddingConfig config) {
        ObjectNode root = json.createObjectNode();
        root.put("model", config.model());
        ObjectNode out = root.putObject("vectors");
        for (Map.Entry<String, float[]> e : vectors.entrySet()) {
            ByteBuffer buffer = ByteBuffer.allocate(e.getValue().length * 4).order(ByteOrder.LITTLE_ENDIAN);
            buffer.asFloatBuffer().put(e.getValue());
            out.put(e.getKey(), Base64.getEncoder().encodeToString(buffer.array()));
        }
        try {
            Files.createDirectories(vectorFile.toAbsolutePath().getParent());
            Path tmp = vectorFile.resolveSibling("rag-vectors.json." + System.currentTimeMillis() + ".tmp");
            json.writeValue(tmp.toFile(), root);
            Files.move(tmp, vectorFile, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            log.warn("Could not save the RAG vector cache: {}", e.getMessage());
        }
    }

    private synchronized void queueEmbeddings(Index index) {
        EmbeddingConfig config = embeddingConfig();
        if (config == null) return;
        List<Chunk> snapshot = new ArrayList<>(index.chunks.values());
        pendingEmbed = embedder.submit(() -> {
            loadVectors();
            Map<String, Chunk> pending = new LinkedHashMap<>();
            for (Chunk c : snapshot) if (!vectors.containsKey(c.hash)) pending.putIfAbsent(c.hash, c);
            if (pending.isEmpty()) return;
            embedRunning = true;
            try {
                List<Chunk> list = new ArrayList<>(pending.values());
                for (int i = 0; i < list.size(); i += 32) {
                    List<Chunk> batch = list.subList(i, Math.min(list.size(), i + 32));
                    List<String> inputs = batch.stream().map(c -> {
                        String text = c.title + (c.section == null || c.section.isBlank() ? "" : " — " + c.section) + "\n" + c.text;
                        return text.length() > 6000 ? text.substring(0, 6000) : text;
                    }).toList();
                    List<float[]> result = embed(config, inputs, Duration.ofSeconds(30));
                    for (int j = 0; j < batch.size(); j++) vectors.put(batch.get(j).hash, result.get(j));
                }
                embedError = null;
                saveVectors(config);
            } catch (AiException e) {
                embedError = e.getMessage();
            } finally {
                embedRunning = false;
                embedRunAt = Instant.now().toString();
            }
        });
    }

    /** Block until queued embedding work finishes (used by the reindex endpoint with wait=true). */
    public void awaitEmbeddings(Duration timeout) {
        Future<?> future;
        synchronized (this) { future = pendingEmbed; }
        try { future.get(timeout.toMillis(), TimeUnit.MILLISECONDS); } catch (Exception ignored) { /* status reports progress */ }
    }

    private float[] embedQuery(String text) {
        EmbeddingConfig config = embeddingConfig();
        if (config == null) return null;
        loadVectors();
        float[] cached = queryVectors.get(text);
        if (cached != null) return cached;
        try {
            float[] v = embed(config, List.of(text.length() > 2000 ? text.substring(0, 2000) : text), Duration.ofSeconds(5)).get(0);
            queryVectors.put(text, v);
            return v;
        } catch (AiException e) {
            embedError = e.getMessage();
            return null;
        }
    }

    // ---- Retrieval -------------------------------------------------------------------

    private static List<Map.Entry<String, Double>> bm25(Index index, List<String> terms, Predicate<Chunk> allowed) {
        int n = Math.max(1, index.chunks.size());
        double avg = Math.max(1, (double) index.totalLength / n);
        double k1 = 1.2, b = 0.75;
        Map<String, Integer> weights = new HashMap<>();
        for (String t : terms) weights.merge(t, 1, Integer::sum);
        Map<String, Double> scores = new HashMap<>();
        for (Map.Entry<String, Integer> w : weights.entrySet()) {
            Map<String, Integer> posting = index.postings.get(w.getKey());
            if (posting == null) continue;
            double idf = Math.log(1 + (n - posting.size() + 0.5) / (posting.size() + 0.5));
            for (Map.Entry<String, Integer> p : posting.entrySet()) {
                Chunk chunk = index.chunks.get(p.getKey());
                if (chunk == null || !allowed.test(chunk)) continue;
                int tf = p.getValue();
                double score = w.getValue() * idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * chunk.length / avg));
                scores.merge(p.getKey(), score, Double::sum);
            }
        }
        return top(scores, 60);
    }

    /**
     * Nearest neighbours always exist, so a dense hit must earn its place: it needs an absolute
     * similarity floor (RAG_MIN_SIMILARITY) and must stand out from the rest of the corpus.
     * Hits that also matched lexically skip both checks.
     */
    private List<Map.Entry<String, Double>> dense(Index index, float[] vector, Predicate<Chunk> allowed, Set<String> lexicalIds) {
        if (vector == null) return List.of();
        Map<String, Double> scores = new HashMap<>();
        double sum = 0, squares = 0;
        for (Chunk chunk : index.chunks.values()) {
            float[] v = vectors.get(chunk.hash);
            if (v == null || v.length != vector.length || !allowed.test(chunk)) continue;
            double dot = 0;
            for (int i = 0; i < v.length; i++) dot += vector[i] * v[i];
            scores.put(chunk.id, dot);
            sum += dot; squares += dot * dot;
        }
        int n = Math.max(1, scores.size());
        double mean = sum / n;
        double spread = Math.sqrt(Math.max(0, squares / n - mean * mean));
        double floor = Math.max(settings.getDouble("RAG_MIN_SIMILARITY", 0.3), scores.size() >= 8 ? mean + spread : -1);
        scores.entrySet().removeIf(e -> !lexicalIds.contains(e.getKey()) && e.getValue() < floor);
        return top(scores, 60);
    }

    private static List<Map.Entry<String, Double>> top(Map<String, Double> scores, int limit) {
        return scores.entrySet().stream().sorted(Map.Entry.<String, Double>comparingByValue().reversed()).limit(limit).map(e -> Map.entry(e.getKey(), e.getValue())).toList();
    }

    /** Hybrid search: each query runs lexically and densely, and all ranked lists merge by RRF. */
    public Result search(String workspaceId, List<String> queries, int limit, Collection<String> types, Collection<String> exclude) {
        long started = System.currentTimeMillis();
        sync(workspaceId, false);
        Index index = indexes.get(workspaceId);
        Set<String> typeSet = types == null ? Set.of() : new HashSet<>(types);
        Set<String> excluded = exclude == null ? Set.of() : new HashSet<>(exclude);
        Predicate<Chunk> allowed = c -> (typeSet.isEmpty() || typeSet.contains(c.type)) && !excluded.contains(c.sourceKey);
        List<String> list = queries.stream().filter(Objects::nonNull).map(String::trim).filter(q -> !q.isEmpty()).distinct().limit(6).toList();

        // Embed outside the index lock: it is a network call.
        Map<String, float[]> queryVecs = new HashMap<>();
        for (String q : list) { float[] v = embedQuery(q); if (v != null) queryVecs.put(q, v); }

        synchronized (index) {
            Map<String, Double> fused = new HashMap<>();
            Map<String, Double> lexicalScore = new HashMap<>();
            Map<String, Double> semanticScore = new HashMap<>();
            boolean denseUsed = false;
            for (String query : list) {
                List<Map.Entry<String, Double>> lexical = bm25(index, TextTools.tokenize(query), allowed);
                Set<String> lexicalIds = new HashSet<>();
                for (Map.Entry<String, Double> e : lexical) lexicalIds.add(e.getKey());
                List<Map.Entry<String, Double>> semantic = dense(index, queryVecs.get(query), allowed, lexicalIds);
                if (!semantic.isEmpty()) denseUsed = true;
                for (int rank = 0; rank < lexical.size(); rank++) {
                    fused.merge(lexical.get(rank).getKey(), 1.0 / (RRF_K + rank + 1), Double::sum);
                    lexicalScore.merge(lexical.get(rank).getKey(), lexical.get(rank).getValue(), Math::max);
                }
                for (int rank = 0; rank < semantic.size(); rank++) {
                    fused.merge(semantic.get(rank).getKey(), 1.0 / (RRF_K + rank + 1), Double::sum);
                    semanticScore.merge(semantic.get(rank).getKey(), semantic.get(rank).getValue(), Math::max);
                }
            }
            // Freshness: recently updated sources get up to a 10% boost, halving every ~3 weeks.
            Instant now = Instant.now();
            fused.replaceAll((chunkId, score) -> {
                Chunk chunk = index.chunks.get(chunkId);
                Instant updated = chunk == null ? null : parseTime(chunk.updatedAt);
                if (updated == null) return score;
                double ageDays = Math.max(0, Duration.between(updated, now).toHours() / 24.0);
                return score * (1 + 0.1 * Math.exp(-ageDays / 30));
            });
            List<Map.Entry<String, Double>> ranked = top(fused, Integer.MAX_VALUE);
            double best = ranked.isEmpty() ? 1 : ranked.get(0).getValue();
            Map<String, Integer> perSource = new HashMap<>();
            Set<String> seenHashes = new HashSet<>();
            List<Hit> hits = new ArrayList<>();
            for (Map.Entry<String, Double> e : ranked) {
                Chunk chunk = index.chunks.get(e.getKey());
                if (chunk == null || !seenHashes.add(chunk.hash)) continue;
                if (perSource.merge(chunk.sourceKey, 1, Integer::sum) > PER_SOURCE_CAP) continue;
                hits.add(new Hit(chunk, e.getValue() / best, lexicalScore.get(chunk.id), semanticScore.get(chunk.id)));
                if (hits.size() >= limit) break;
            }
            return new Result(hits, list, System.currentTimeMillis() - started, denseUsed ? "hybrid" : "lexical", index.chunks.size(), index.sources.size());
        }
    }

    /** Merge adjacent hits from the same source into passages ready for a prompt. */
    public static List<Passage> toPassages(List<Hit> hits) {
        Map<String, List<Hit>> bySource = new LinkedHashMap<>();
        for (Hit hit : hits) bySource.computeIfAbsent(hit.chunk().sourceKey, k -> new ArrayList<>()).add(hit);
        List<Passage> passages = new ArrayList<>();
        for (List<Hit> group : bySource.values()) {
            group.sort(Comparator.comparingInt(h -> h.chunk().seq));
            Passage current = null;
            for (Hit hit : group) {
                Chunk c = hit.chunk();
                if (current != null && c.seq == current.lastSeq() + 1) {
                    String joined;
                    if (c.startLine > 0) {
                        // Code windows overlap; drop the lines the previous window already holds.
                        String[] lines = c.text.split("\n", -1);
                        int skip = Math.min(lines.length, Math.max(0, current.endLine() - c.startLine + 1));
                        joined = current.text() + "\n" + String.join("\n", Arrays.copyOfRange(lines, skip, lines.length));
                    } else {
                        joined = current.text() + "\n\n" + c.text;
                    }
                    String location = c.startLine > 0 ? "lines " + current.first().startLine + "–" + c.endLine : current.location();
                    current = new Passage(current.first(), joined, location, Math.max(current.score(), hit.score()), c.seq, c.endLine);
                    continue;
                }
                if (current != null) passages.add(current);
                current = new Passage(c, c.text, c.location, hit.score(), c.seq, c.endLine);
            }
            if (current != null) passages.add(current);
        }
        passages.sort(Comparator.comparingDouble(Passage::score).reversed());
        return passages;
    }

    public Map<String, Object> status(String workspaceId) {
        Index index = indexes.get(workspaceId);
        EmbeddingConfig config = embeddingConfig();
        Map<String, Integer> byType = new TreeMap<>();
        int chunks = 0, embedded = 0, sources = 0, terms = 0;
        String syncedAt = null;
        if (index != null) {
            synchronized (index) {
                for (SourceEntry s : index.sources.values()) byType.merge(s.type, 1, Integer::sum);
                for (Chunk c : index.chunks.values()) if (vectors.containsKey(c.hash)) embedded++;
                chunks = index.chunks.size(); sources = index.sources.size(); terms = index.postings.size(); syncedAt = index.syncedAt;
            }
        }
        Map<String, Object> embeddings = new LinkedHashMap<>();
        embeddings.put("enabled", config != null);
        embeddings.put("provider", config == null ? null : config.label());
        embeddings.put("model", config == null ? null : config.model());
        embeddings.put("embedded", embedded);
        embeddings.put("pending", config == null ? 0 : Math.max(0, chunks - embedded));
        embeddings.put("running", embedRunning);
        embeddings.put("lastError", embedError);
        embeddings.put("lastRunAt", embedRunAt);
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("ready", syncedAt != null);
        status.put("syncedAt", syncedAt);
        status.put("chunks", chunks);
        status.put("sources", sources);
        status.put("terms", terms);
        status.put("byType", byType);
        status.put("retrieval", config == null ? "lexical" : "hybrid");
        status.put("engine", "spring-boot");
        status.put("embeddings", embeddings);
        return status;
    }

    /** Timestamps arrive as ISO strings or JDBC "yyyy-mm-dd hh:mm:ss[.f]" text. */
    static Instant parseTime(String value) {
        if (value == null || value.isBlank()) return null;
        try { return Instant.parse(value); } catch (RuntimeException ignored) { /* try JDBC form */ }
        try { return java.sql.Timestamp.valueOf(value).toInstant(); } catch (RuntimeException ignored) { return null; }
    }

    static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
