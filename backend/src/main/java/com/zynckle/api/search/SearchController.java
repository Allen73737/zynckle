package com.zynckle.api.search;

import com.zynckle.api.ai.rag.RagService;
import com.zynckle.api.ai.rag.TextTools;
import com.zynckle.api.common.RateLimiter;
import com.zynckle.api.document.DocumentsController;
import com.zynckle.api.security.CurrentUser;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.*;

/**
 * Command-palette search: names and titles across everything the caller can see, followed by
 * the best passages from workspace knowledge so content matches surface too.
 */
@RestController
public class SearchController {
    private final JdbcTemplate jdbc;
    private final RagService rag;
    private final RateLimiter limiter;

    public SearchController(JdbcTemplate jdbc, RagService rag, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.rag = rag;
        this.limiter = limiter;
    }

    private static Map<String, Object> hit(String type, Object id, Object title, String subtitle, String link) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", type); out.put("id", id); out.put("title", title); out.put("subtitle", subtitle); out.put("link", link);
        return out;
    }

    @GetMapping("/api/search")
    public Map<String, Object> search(CurrentUser me, @RequestParam(defaultValue = "") String q) {
        limiter.check("search:" + me.userId(), 240, 60_000);
        String query = q.trim();
        if (query.length() < 2) return Map.of("query", query, "results", List.of());
        String like = "%" + query.toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        String ws = me.workspaceId();
        List<Map<String, Object>> results = new ArrayList<>();
        for (Map<String, Object> p : jdbc.queryForList("SELECT id, name, status FROM project WHERE workspace_id = ? AND (LOWER(name) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ?) LIMIT 6", ws, like, like))
            results.add(hit("project", p.get("id"), p.get("name"), String.valueOf(p.get("status")), "/projects/" + p.get("id")));
        for (Map<String, Object> t : jdbc.queryForList("SELECT t.id, t.title, t.status, t.project_id, p.name AS project FROM task t JOIN project p ON p.id = t.project_id WHERE p.workspace_id = ? AND (LOWER(t.title) LIKE ? OR LOWER(COALESCE(t.description, '')) LIKE ?) LIMIT 8", ws, like, like))
            results.add(hit("task", t.get("id"), t.get("title"), t.get("project") + " · " + t.get("status"), "/projects/" + t.get("project_id") + "?task=" + t.get("id")));
        for (Map<String, Object> d : jdbc.queryForList("SELECT * FROM document WHERE workspace_id = ? AND type <> 'latex-template' AND LOWER(title) LIKE ? LIMIT 12", ws, like)) {
            if (!DocumentsController.canSee(d, me)) continue;
            boolean latex = "latex".equals(d.get("type"));
            results.add(hit(latex ? "latex" : "document", d.get("id"), d.get("title"), latex ? "LaTeX document" : "Document", (latex ? "/latex?doc=" : "/documents?doc=") + d.get("id")));
        }
        for (Map<String, Object> f : jdbc.queryForList("SELECT id, name, visibility, owner_id, shared_with FROM drive_file WHERE workspace_id = ? AND LOWER(name) LIKE ? LIMIT 12", ws, like)) {
            boolean visible = !"private".equals(f.get("visibility")) || me.userId().equals(f.get("owner_id")) || DocumentsController.ids(f.get("shared_with")).contains(me.userId());
            if (visible) results.add(hit("file", f.get("id"), f.get("name"), "Drive", "/drive?file=" + f.get("id")));
        }
        for (Map<String, Object> c : jdbc.queryForList("SELECT id, name FROM code_project WHERE workspace_id = ? AND LOWER(name) LIKE ? LIMIT 4", ws, like))
            results.add(hit("code", c.get("id"), c.get("name"), "Code project", "/code/" + c.get("id")));
        for (Map<String, Object> f : jdbc.queryForList("SELECT id, path, code_project_id FROM code_file WHERE workspace_id = ? AND LOWER(path) LIKE ? LIMIT 6", ws, like)) {
            String path = String.valueOf(f.get("path"));
            results.add(hit("code-file", f.get("id"), path.substring(path.lastIndexOf('/') + 1), path, "/code/" + f.get("code_project_id") + "?file=" + f.get("id")));
        }
        for (Map<String, Object> v : jdbc.queryForList("SELECT id, title, url FROM website_preview WHERE workspace_id = ? AND (LOWER(title) LIKE ? OR LOWER(url) LIKE ?) LIMIT 4", ws, like, like))
            results.add(hit("preview", v.get("id"), v.get("title"), String.valueOf(v.get("url")), "/previews?preview=" + v.get("id")));
        for (Map<String, Object> u : jdbc.queryForList("SELECT u.id, u.display_name, u.email FROM workspace_member m JOIN app_user u ON u.id = m.user_id WHERE m.workspace_id = ? AND (LOWER(u.display_name) LIKE ? OR LOWER(u.email) LIKE ?) LIMIT 4", ws, like, like))
            results.add(hit("person", u.get("id"), u.get("display_name"), String.valueOf(u.get("email")), "/team"));

        // Content matches: passages whose source is not already listed by name.
        Set<String> listed = new HashSet<>();
        for (Map<String, Object> r : results) listed.add(r.get("type") + ":" + r.get("id"));
        if (query.length() >= 3) {
            for (RagService.Hit h : rag.search(ws, List.of(query), 6, null, List.of()).hits()) {
                RagService.Chunk c = h.chunk();
                String key = ("latex".equals(c.type) ? "latex" : c.type) + ":" + c.sourceId;
                if (!listed.add(key)) continue;
                Map<String, Object> passage = hit("passage", c.id, c.title, TextTools.snippet(c.text, query, 140), c.link);
                passage.put("sourceType", c.type);
                results.add(passage);
            }
        }
        return Map.of("query", query, "results", results);
    }
}
