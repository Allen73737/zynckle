package com.zynckle.api.document;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api")
public class DocumentController {
    private final JdbcTemplate jdbc;

    public DocumentController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/documents")
    public List<Map<String, Object>> getDocuments() {
        return jdbc.queryForList("""
            SELECT id, title, content, type, updated_at AS updated
            FROM document ORDER BY updated_at DESC
        """);
    }

    @PostMapping("/documents")
    public Map<String, Object> saveDocument(@RequestBody Map<String, Object> body) {
        String id = (String) body.get("id");
        if (id == null || id.isBlank()) {
            id = "doc-" + System.currentTimeMillis();
        }
        String title = (String) body.getOrDefault("title", "Untitled Document");
        String content = (String) body.getOrDefault("content", "");
        String type = (String) body.getOrDefault("type", "rich-text");

        List<Map<String, Object>> exists = jdbc.queryForList("SELECT id FROM document WHERE id = ?", id);
        if (exists.isEmpty()) {
            jdbc.update("""
                INSERT INTO document (id, workspace_id, title, content, type, owner_id)
                VALUES (?, 'ws-local', ?, ?, ?, 'usr-local')
            """, id, title, content, type);
        } else {
            jdbc.update("""
                UPDATE document SET title = ?, content = ?, type = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, title, content, type, id);
        }

        Map<String, Object> doc = new HashMap<>();
        doc.put("id", id);
        doc.put("title", title);
        doc.put("content", content);
        doc.put("type", type);
        doc.put("updated", new Date().toString());
        return doc;
    }

    @GetMapping("/documents/{id}")
    public Map<String, Object> getDocument(@PathVariable String id) {
        List<Map<String, Object>> list = jdbc.queryForList("""
            SELECT id, title, content, type, updated_at AS updated
            FROM document WHERE id = ?
        """, id);
        if (!list.isEmpty()) {
            return list.get(0);
        }
        return Map.of("id", id, "title", "Document", "content", "", "type", "rich-text");
    }

    @DeleteMapping("/documents/{id}")
    public Map<String, Object> deleteDocument(@PathVariable String id) {
        jdbc.update("DELETE FROM document WHERE id = ?", id);
        return Map.of("deleted", true);
    }

    @GetMapping("/latex/status")
    public Map<String, Object> latexStatus() {
        return Map.of(
            "available", true,
            "compiler", "built-in",
            "version", "Zynckle Spring Boot TeX Engine (Built-in)",
            "message", "High-performance instant compiler ready"
        );
    }

    @PostMapping("/latex/compile")
    public ResponseEntity<byte[]> compileLatex(@RequestBody Map<String, Object> body) {
        String source = (String) body.getOrDefault("source", "");
        byte[] pdfBytes = LatexPdfCompiler.compile(source);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.set(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"document.pdf\"");
        headers.set("x-latex-warnings", "0");
        headers.set("x-compiler", "zynckle-spring-tex");

        return ResponseEntity.ok().headers(headers).body(pdfBytes);
    }
}
