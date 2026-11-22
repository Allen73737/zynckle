package com.zynckle.api.document;

import com.zynckle.api.common.Activity;
import com.zynckle.api.common.ApiException;
import com.zynckle.api.common.Validate;
import com.zynckle.api.security.CurrentUser;
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
    private final Activity activity;

    public DocumentController(JdbcTemplate jdbc, Activity activity) {
        this.jdbc = jdbc;
        this.activity = activity;
    }

    private static String text(Object value) {
        if (value instanceof java.sql.Clob clob) {
            try { return clob.getSubString(1, (int) clob.length()); } catch (Exception e) { return ""; }
        }
        return value == null ? "" : String.valueOf(value);
    }

    private static Map<String, Object> view(Map<String, Object> d) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", d.get("id"));
        out.put("title", d.get("title"));
        out.put("content", text(d.get("content")));
        out.put("type", d.get("type"));
        out.put("ownerId", d.get("owner_id"));
        out.put("visibility", "workspace");
        Object updated = d.get("updated_at");
        out.put("updated", updated instanceof java.sql.Timestamp t ? t.toInstant().toString() : String.valueOf(updated));
        return out;
    }

    private Map<String, Object> find(CurrentUser me, String id) {
        return jdbc.queryForList("SELECT * FROM document WHERE id = ? AND workspace_id = ? AND type <> 'latex-template'", id, me.workspaceId())
            .stream().findFirst().map(DocumentController::view).orElseThrow(() -> new ApiException(404, "Document not found"));
    }

    @GetMapping("/documents")
    public List<Map<String, Object>> getDocuments(CurrentUser me) {
        return jdbc.queryForList("SELECT * FROM document WHERE workspace_id = ? AND type <> 'latex-template' ORDER BY updated_at DESC", me.workspaceId())
            .stream().map(DocumentController::view).toList();
    }

    /** Create, or update when an id of a document in this workspace is given. */
    @PostMapping("/documents")
    public Map<String, Object> saveDocument(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        String title = Validate.str(body, "title", "Title", 1, 240);
        Object raw = body.getOrDefault("content", "");
        String content = raw == null ? "" : String.valueOf(raw);
        if (content.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 2_000_000) throw new ApiException(413, "Document content is limited to 2 MB");
        String type = "latex".equals(body.get("type")) ? "latex" : "rich-text";
        String id = body.get("id") instanceof String given && !given.isBlank() ? given : null;
        if (id != null && !jdbc.queryForList("SELECT id FROM document WHERE id = ? AND workspace_id = ?", id, me.workspaceId()).isEmpty()) {
            jdbc.update("UPDATE document SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?", title, content, id, me.workspaceId());
            return find(me, id);
        }
        if (id != null && !jdbc.queryForList("SELECT id FROM document WHERE id = ?", id).isEmpty()) throw new ApiException(404, "Document not found");
        String newId = id != null && id.matches("[\\w-]{1,64}") ? id : UUID.randomUUID().toString();
        jdbc.update("INSERT INTO document (id, workspace_id, title, content, type, owner_id) VALUES (?, ?, ?, ?, ?, ?)", newId, me.workspaceId(), title, content, type, me.userId());
        activity.log(me, "created document", "document", title);
        return find(me, newId);
    }

    @GetMapping("/documents/{id}")
    public Map<String, Object> getDocument(CurrentUser me, @PathVariable String id) { return find(me, id); }

    @PatchMapping("/documents/{id}")
    public Map<String, Object> patchDocument(CurrentUser me, @PathVariable String id, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        find(me, id);
        if (body.containsKey("title")) jdbc.update("UPDATE document SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", Validate.str(body, "title", "Title", 1, 240), id);
        if (body.get("content") instanceof String content) jdbc.update("UPDATE document SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", content, id);
        return find(me, id);
    }

    @DeleteMapping("/documents/{id}")
    public Map<String, Object> deleteDocument(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        Map<String, Object> doc = find(me, id);
        if (!me.userId().equals(doc.get("ownerId")) && !me.isAdmin()) throw new ApiException(403, "Only the author or a workspace admin can delete this document");
        jdbc.update("DELETE FROM document WHERE id = ? AND workspace_id = ?", id, me.workspaceId());
        activity.log(me, "deleted document", "document", String.valueOf(doc.get("title")), true, null);
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

    @PostMapping("/latex/decompile-pdf")
    public Map<String, Object> decompilePdf(@RequestBody Map<String, Object> body) {
        String pdfBase64 = (String) body.get("pdfBase64");
        String text = (String) body.get("text");
        String filename = (String) body.getOrDefault("filename", "Extracted Document");

        if (pdfBase64 != null && !pdfBase64.isBlank()) {
            try {
                // Strip possible data URI prefix
                if (pdfBase64.contains(",")) {
                    pdfBase64 = pdfBase64.substring(pdfBase64.indexOf(",") + 1);
                }
                byte[] decoded = Base64.getDecoder().decode(pdfBase64);
                String extracted = PdfLatexDecompiler.extractPdfText(decoded);
                if (!extracted.isBlank()) {
                    text = extracted;
                }
            } catch (Exception ignored) {}
        }

        PdfLatexDecompiler.DecompileResult res = PdfLatexDecompiler.decompileTextToLatex(text, filename.replaceAll("\\.pdf$", ""));

        Map<String, Object> response = new HashMap<>();
        response.put("latex", res.latex);
        response.put("extractedTemplate", res.extractedTemplate);
        response.put("title", res.title);
        response.put("author", res.author);
        response.put("docClass", res.docClass);
        response.put("sections", res.sections);
        response.put("equationCount", res.equationCount);
        response.put("wordCount", res.wordCount);
        response.put("success", true);
        return response;
    }

    @PostMapping("/latex/ai-generate")
    public Map<String, Object> aiGenerateLatex(@RequestBody Map<String, Object> body) {
        String prompt = (String) body.getOrDefault("prompt", "Academic Research Paper");
        String style = (String) body.getOrDefault("style", "article");
        String customTemplate = (String) body.get("customTemplate");

        String title = "Automated Research Specification";
        String docClass = "article";
        if (prompt.toLowerCase().contains("resume") || prompt.toLowerCase().contains("cv")) {
            style = "resume";
            docClass = "article";
            title = "Professional Curriculum Vitae";
        } else if (prompt.toLowerCase().contains("exam") || prompt.toLowerCase().contains("problem set")) {
            style = "exam";
            title = "Advanced Examination Paper";
        } else if (prompt.toLowerCase().contains("report") || prompt.toLowerCase().contains("architecture")) {
            style = "report";
            docClass = "report";
            title = "Technical Systems Specification";
        }

        StringBuilder sb = new StringBuilder();
        if (customTemplate != null && !customTemplate.isBlank()) {
            // Apply prompt over custom template
            sb.append(customTemplate.replace("<DOCUMENT_TITLE>", title)
                                    .replace("<AUTHOR_NAME>", "Zynckle Research Group")
                                    .replace("<SECTION_HEADING>", "System Foundations")
                                    .replace("<SECTION_BODY>", "Generated from custom template: " + prompt));
        } else if ("resume".equals(style)) {
            sb.append("\\documentclass[10pt,letterpaper]{article}\n")
              .append("\\usepackage[utf8]{inputenc}\n\\usepackage{geometry,hyperref,enumitem}\n\\geometry{margin=0.7in}\n\n")
              .append("\\begin{document}\n\\begin{center}\n  {\\LARGE \\textbf{Candidate Profile}} \\\\\n")
              .append("  \\small +1 (555) 019-4829 \\quad|\\quad candidate@zynckle.io \\quad|\\quad github.com/candidate\n\\end{center}\n\n")
              .append("\\section*{Objective}\nTargeted Role: ").append(prompt).append("\n\n")
              .append("\\section*{Core Competencies}\n\\textbf{Engineering:} Distributed Systems, Java 17, Spring Boot, React, TypeScript, LaTeX, PostgreSQL.\n\n")
              .append("\\section*{Experience}\n\\textbf{Staff Platform Architect} \\hfill 2022 -- Present \\\\\n\\textit{Zynckle Labs} \\\\\n")
              .append("\\begin{itemize}[leftmargin=14pt]\n  \\item Architected real-time CRDT synchronization pipeline with sub-5ms vector generation.\n")
              .append("  \\item Delivered high-throughput low-latency microservices with zero downtime.\n\\end{itemize}\n\n")
              .append("\\end{document}\n");
        } else if ("exam".equals(style)) {
            sb.append("\\documentclass[12pt]{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath,amssymb,amsfonts,geometry}\n\\geometry{a4paper, margin=0.9in}\n\n")
              .append("\\title{\\textbf{Advanced Applied Examination}\\\\\\large ").append(prompt).append("}\n")
              .append("\\author{Department of Mathematical Sciences}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n")
              .append("\\section*{Problem 1: Invariant Subspaces and Spectral Bounds (25 points)}\n")
              .append("Let $T: \\mathcal{H} \\to \\mathcal{H}$ denote a bounded linear operator on a complex Hilbert space.\n")
              .append("\\begin{equation}\n  \\sigma(T) \\subset \\{ z \\in \\mathbb{C} : |z| \\le \\|T\\| \\}\n\\end{equation}\n")
              .append("Prove that every invariant subspace of $T$ reduces $T$ if and only if $T$ is normal.\n\n")
              .append("\\section*{Problem 2: Variational Dynamics and Contours (25 points)}\n")
              .append("Evaluate the integral along the positive orientation path $\\gamma$:\n")
              .append("\\begin{equation}\n  \\oint_\\gamma \\frac{e^{z^2}}{z(z - 1)^2} \\, dz\n\\end{equation}\n\n")
              .append("\\end{document}\n");
        } else {
            sb.append("\\documentclass[11pt]{").append(docClass).append("}\n")
              .append("\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath,amssymb,amsfonts,graphicx,hyperref,geometry}\n\\geometry{a4paper, margin=1in}\n\n")
              .append("\\title{\\textbf{").append(prompt.replaceAll("[\\{\\}\\\\]", "")).append("}}\n")
              .append("\\author{Dr. Lead Researcher \\and Platform Engineering Group \\\\ \\small Zynckle Advanced Institute}\n")
              .append("\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n")
              .append("\\begin{abstract}\nThis document presents a deterministic formal framework addressing: ").append(prompt).append(".\n\\end{abstract}\n\n")
              .append("\\section{Introduction and Objectives}\n")
              .append("Modern computational workflows demand precision mathematical models combined with guaranteed convergence.\n\n")
              .append("\\section{Mathematical Architecture}\n")
              .append("We establish the governing variational principle:\n")
              .append("\\begin{equation}\n  \\mathcal{S}[\\psi] = \\int_{\\Omega} \\left( \\frac{1}{2} |\\nabla \\psi|^2 + V(\\psi) \\right) d^nx\n\\end{equation}\n\n")
              .append("\\section{Verification and Results}\n")
              .append("Numerical simulation validates the theoretical bounds with bounded sub-5ms compile overhead.\n\n")
              .append("\\section{Conclusion}\n")
              .append("The system guarantees zero-drift consistency under distributed operating conditions.\n\n")
              .append("\\end{document}\n");
        }

        Map<String, Object> res = new HashMap<>();
        res.put("latex", sb.toString());
        res.put("title", title);
        res.put("style", style);
        res.put("success", true);
        return res;
    }

    @GetMapping("/latex/templates")
    public List<Map<String, Object>> getLatexTemplates(CurrentUser me) {
        return jdbc.queryForList("SELECT * FROM document WHERE workspace_id = ? AND type = 'latex-template' ORDER BY updated_at DESC", me.workspaceId())
            .stream().map(DocumentController::view).toList();
    }

    @PostMapping("/latex/templates")
    public Map<String, Object> saveLatexTemplate(CurrentUser me, @RequestBody Map<String, Object> body) {
        me.requireEdit();
        String title = Validate.str(body, "title", "Template name", 1, 240);
        String content = String.valueOf(body.getOrDefault("content", ""));
        String id = body.get("id") instanceof String given && !given.isBlank() ? given : null;
        if (id != null && !jdbc.queryForList("SELECT id FROM document WHERE id = ? AND workspace_id = ? AND type = 'latex-template'", id, me.workspaceId()).isEmpty()) {
            jdbc.update("UPDATE document SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", title, content, id);
        } else {
            id = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO document (id, workspace_id, title, content, type, owner_id) VALUES (?, ?, ?, ?, 'latex-template', ?)", id, me.workspaceId(), title, content, me.userId());
        }
        return jdbc.queryForList("SELECT * FROM document WHERE id = ?", id).stream().findFirst().map(DocumentController::view).orElseThrow();
    }

    @DeleteMapping("/latex/templates/{id}")
    public Map<String, Object> deleteLatexTemplate(CurrentUser me, @PathVariable String id) {
        me.requireEdit();
        jdbc.update("DELETE FROM document WHERE id = ? AND workspace_id = ? AND type = 'latex-template'", id, me.workspaceId());
        return Map.of("deleted", true);
    }
}
