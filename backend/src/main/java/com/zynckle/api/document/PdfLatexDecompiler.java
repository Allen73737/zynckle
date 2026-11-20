package com.zynckle.api.document;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.*;
import java.util.zip.Inflater;
import java.util.zip.InflaterInputStream;

public class PdfLatexDecompiler {

    public static class DecompileResult {
        public String latex;
        public String extractedTemplate;
        public String title;
        public String author;
        public String docClass;
        public List<String> sections = new ArrayList<>();
        public int equationCount;
        public int wordCount;
    }

    /**
     * Extracts text content from raw PDF bytes (supporting both uncompressed and FlateDecode streams).
     */
    public static String extractPdfText(byte[] pdfBytes) {
        if (pdfBytes == null || pdfBytes.length == 0) return "";
        StringBuilder extracted = new StringBuilder();

        // 1. Scan for stream ... endstream blocks
        String raw = new String(pdfBytes, StandardCharsets.ISO_8859_1);
        int searchFrom = 0;
        while (true) {
            int streamStart = raw.indexOf("stream", searchFrom);
            if (streamStart == -1) break;
            // Advance past stream\r\n or stream\n
            int dataStart = streamStart + 6;
            if (dataStart < pdfBytes.length && pdfBytes[dataStart] == '\r') dataStart++;
            if (dataStart < pdfBytes.length && pdfBytes[dataStart] == '\n') dataStart++;

            int streamEnd = raw.indexOf("endstream", dataStart);
            if (streamEnd == -1) break;

            int len = streamEnd - dataStart;
            if (len > 0 && dataStart + len <= pdfBytes.length) {
                byte[] streamBytes = Arrays.copyOfRange(pdfBytes, dataStart, streamEnd);
                // Try decompressing with Inflater
                String streamText = tryInflate(streamBytes);
                if (streamText == null || streamText.isBlank()) {
                    streamText = new String(streamBytes, StandardCharsets.ISO_8859_1);
                }
                // Parse PDF text operators: (text) Tj, [(text) 20 (more)] TJ, ' or "
                parsePdfStreamOperators(streamText, extracted);
            }
            searchFrom = streamEnd + 9;
        }

        // If stream parsing extracted very little, fall back to literal string scan in raw bytes
        if (extracted.length() < 20) {
            Matcher m = Pattern.compile("\\(([^()\\\\]*(?:\\\\.[^()\\\\]*)*)\\)\\s*(?:Tj|'|\")").matcher(raw);
            while (m.find()) {
                String clean = unescapePdf(m.group(1));
                if (!clean.isBlank()) extracted.append(clean).append("\n");
            }
        }

        return extracted.toString().trim();
    }

    private static String tryInflate(byte[] data) {
        try {
            ByteArrayInputStream bais = new ByteArrayInputStream(data);
            InflaterInputStream iis = new InflaterInputStream(bais, new Inflater(false));
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int r;
            while ((r = iis.read(buf)) != -1) {
                baos.write(buf, 0, r);
            }
            return baos.toString(StandardCharsets.UTF_8);
        } catch (Exception e) {
            // Try with zlib nowrap
            try {
                ByteArrayInputStream bais = new ByteArrayInputStream(data);
                InflaterInputStream iis = new InflaterInputStream(bais, new Inflater(true));
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int r;
                while ((r = iis.read(buf)) != -1) {
                    baos.write(buf, 0, r);
                }
                return baos.toString(StandardCharsets.UTF_8);
            } catch (Exception ignored) {
                return null;
            }
        }
    }

    private static void parsePdfStreamOperators(String content, StringBuilder out) {
        if (content == null) return;
        // Parse BT ... ET blocks
        Matcher btMatcher = Pattern.compile("BT\\b([\\s\\S]*?)ET\\b").matcher(content);
        while (btMatcher.find()) {
            String block = btMatcher.group(1);
            // Handle (string) Tj
            Matcher tj = Pattern.compile("\\(([^()\\\\]*(?:\\\\.[^()\\\\]*)*)\\)\\s*(?:Tj|'|\")").matcher(block);
            while (tj.find()) {
                String s = unescapePdf(tj.group(1));
                if (!s.isBlank()) out.append(s).append(" ");
            }
            // Handle [...] TJ
            Matcher tjArray = Pattern.compile("\\[([^\\]]+)\\]\\s*TJ").matcher(block);
            while (tjArray.find()) {
                String arr = tjArray.group(1);
                Matcher strInArr = Pattern.compile("\\(([^()\\\\]*(?:\\\\.[^()\\\\]*)*)\\)").matcher(arr);
                while (strInArr.find()) {
                    String s = unescapePdf(strInArr.group(1));
                    out.append(s);
                }
                out.append(" ");
            }
            out.append("\n");
        }
    }

    private static String unescapePdf(String s) {
        if (s == null) return "";
        return s.replace("\\(", "(")
                .replace("\\)", ")")
                .replace("\\\\", "\\")
                .replace("\\n", "\n")
                .replace("\\r", "\r")
                .replace("\\t", "\t");
    }

    /**
     * Reverse-engineers raw extracted text into structured LaTeX code and a reusable format template.
     */
    public static DecompileResult decompileTextToLatex(String text, String defaultTitle) {
        DecompileResult result = new DecompileResult();
        if (text == null || text.isBlank()) {
            result.latex = "% Extracted LaTeX Source\n\\documentclass{article}\n\\begin{document}\n\\end{document}";
            result.extractedTemplate = result.latex;
            result.title = defaultTitle != null ? defaultTitle : "Untitled Extracted Document";
            result.docClass = "article";
            return result;
        }

        String[] rawLines = text.split("\r?\n");
        List<String> lines = new ArrayList<>();
        for (String l : rawLines) {
            String trimmed = l.trim();
            if (!trimmed.isEmpty()) lines.add(trimmed);
        }

        // Determine title
        String detectedTitle = defaultTitle;
        int titleIndex = -1;
        for (int i = 0; i < Math.min(lines.size(), 5); i++) {
            String l = lines.get(i);
            if (l.length() > 4 && !l.toLowerCase().contains("page") && !l.toLowerCase().contains("confidential")) {
                detectedTitle = l;
                titleIndex = i;
                break;
            }
        }
        if (detectedTitle == null || detectedTitle.isBlank()) detectedTitle = "Extracted Document";
        result.title = detectedTitle;

        // Determine author
        String detectedAuthor = "Author";
        if (titleIndex != -1 && titleIndex + 1 < lines.size()) {
            String candidate = lines.get(titleIndex + 1);
            if (candidate.length() < 80 && !candidate.toLowerCase().startsWith("abstract") && !candidate.toLowerCase().startsWith("1.")) {
                detectedAuthor = candidate;
            }
        }
        result.author = detectedAuthor;

        // Determine document class
        String docClass = "article";
        String lowerAll = text.toLowerCase();
        if (lowerAll.contains("\\chapter") || lowerAll.contains("chapter 1") || lowerAll.contains("table of contents")) {
            docClass = "report";
        } else if (lowerAll.contains("dear ") && (lowerAll.contains("sincerely") || lowerAll.contains("regards"))) {
            docClass = "letter";
        }
        result.docClass = docClass;

        StringBuilder latex = new StringBuilder();
        StringBuilder template = new StringBuilder();

        // Preamble
        latex.append("\\documentclass[11pt]{").append(docClass).append("}\n");
        latex.append("\\usepackage[utf8]{inputenc}\n");
        latex.append("\\usepackage{amsmath,amssymb,amsfonts}\n");
        latex.append("\\usepackage{graphicx}\n");
        latex.append("\\usepackage{hyperref}\n");
        latex.append("\\usepackage{geometry}\n");
        latex.append("\\geometry{a4paper, margin=1in}\n\n");

        template.append("\\documentclass[11pt]{").append(docClass).append("}\n");
        template.append("\\usepackage[utf8]{inputenc}\n");
        template.append("\\usepackage{amsmath,amssymb,amsfonts}\n");
        template.append("\\usepackage{graphicx}\n");
        template.append("\\usepackage{hyperref}\n");
        template.append("\\usepackage{geometry}\n");
        template.append("\\geometry{a4paper, margin=1in}\n\n");

        // Metadata
        latex.append("\\title{\\textbf{").append(escapeLatex(detectedTitle)).append("}}\n");
        latex.append("\\author{").append(escapeLatex(detectedAuthor)).append("}\n");
        latex.append("\\date{\\today}\n\n");

        template.append("\\title{\\textbf{<DOCUMENT_TITLE>}}\n");
        template.append("\\author{<AUTHOR_NAME> \\\\ \\small <AFFILIATION>}\n");
        template.append("\\date{\\today}\n\n");

        latex.append("\\begin{document}\n\\maketitle\n\n");
        template.append("\\begin{document}\n\\maketitle\n\n");

        boolean inAbstract = false;
        boolean inItemize = false;
        boolean inEnumerate = false;
        int eqCount = 0;
        int words = 0;

        int startIndex = (titleIndex != -1 && titleIndex + 2 < lines.size()) ? titleIndex + 2 : (titleIndex != -1 ? titleIndex + 1 : 0);

        for (int i = startIndex; i < lines.size(); i++) {
            String line = lines.get(i);
            words += line.split("\\s+").length;
            String lower = line.toLowerCase();

            // Check for abstract
            if (lower.startsWith("abstract")) {
                if (inItemize) { latex.append("\\end{itemize}\n\n"); inItemize = false; }
                if (inEnumerate) { latex.append("\\end{enumerate}\n\n"); inEnumerate = false; }
                latex.append("\\begin{abstract}\n");
                template.append("\\begin{abstract}\n<ABSTRACT_STATEMENT>\n\\end{abstract}\n\n");
                inAbstract = true;
                String rest = line.substring(Math.min(line.length(), 8)).trim();
                if (!rest.isEmpty()) latex.append(escapeLatex(rest)).append("\n");
                continue;
            }

            // Check end of abstract (encountering first section)
            if (inAbstract && (isHeading(line) || line.startsWith("1.") || line.startsWith("I."))) {
                latex.append("\\end{abstract}\n\n");
                inAbstract = false;
            }

            // Check for section headings
            if (isHeading(line)) {
                if (inItemize) { latex.append("\\end{itemize}\n\n"); inItemize = false; }
                if (inEnumerate) { latex.append("\\end{enumerate}\n\n"); inEnumerate = false; }
                String cleanHeading = cleanHeadingTitle(line);
                result.sections.add(cleanHeading);
                latex.append("\\section{").append(escapeLatex(cleanHeading)).append("}\n");
                template.append("\\section{<SECTION_HEADING>}\n<SECTION_BODY>\n\n");
                continue;
            }

            // Check for subsection headings
            if (isSubheading(line)) {
                if (inItemize) { latex.append("\\end{itemize}\n\n"); inItemize = false; }
                if (inEnumerate) { latex.append("\\end{enumerate}\n\n"); inEnumerate = false; }
                String cleanSub = cleanHeadingTitle(line);
                latex.append("\\subsection{").append(escapeLatex(cleanSub)).append("}\n");
                continue;
            }

            // Check for mathematical equations
            if (isEquationLine(line)) {
                if (inItemize) { latex.append("\\end{itemize}\n\n"); inItemize = false; }
                if (inEnumerate) { latex.append("\\end{enumerate}\n\n"); inEnumerate = false; }
                eqCount++;
                latex.append("\\begin{equation}\n  ").append(formatMathEquation(line)).append("\n\\end{equation}\n\n");
                continue;
            }

            // Check for bulleted or numbered list items
            if (line.startsWith("•") || line.startsWith("-") || line.startsWith("*")) {
                if (!inItemize) {
                    if (inEnumerate) { latex.append("\\end{enumerate}\n\n"); inEnumerate = false; }
                    latex.append("\\begin{itemize}\n");
                    inItemize = true;
                }
                String itemContent = line.replaceFirst("^[•\\-*]\\s*", "");
                latex.append("  \\item ").append(escapeLatex(itemContent)).append("\n");
                continue;
            }
            if (line.matches("^\\d+[.)]\\s+.*")) {
                if (!inEnumerate) {
                    if (inItemize) { latex.append("\\end{itemize}\n\n"); inItemize = false; }
                    latex.append("\\begin{enumerate}\n");
                    inEnumerate = true;
                }
                String itemContent = line.replaceFirst("^\\d+[.)]\\s*", "");
                latex.append("  \\item ").append(escapeLatex(itemContent)).append("\n");
                continue;
            }

            // Normal text paragraph
            if (inItemize) { latex.append("\\end{itemize}\n\n"); inItemize = false; }
            if (inEnumerate) { latex.append("\\end{enumerate}\n\n"); inEnumerate = false; }

            latex.append(escapeLatex(line)).append("\n\n");
        }

        if (inAbstract) latex.append("\\end{abstract}\n\n");
        if (inItemize) latex.append("\\end{itemize}\n\n");
        if (inEnumerate) latex.append("\\end{enumerate}\n\n");

        latex.append("\\end{document}\n");
        template.append("\\end{document}\n");

        result.latex = latex.toString();
        result.extractedTemplate = template.toString();
        result.equationCount = eqCount;
        result.wordCount = words;
        return result;
    }

    private static boolean isHeading(String line) {
        if (line.length() > 70) return false;
        if (line.matches("^(?:\\d+\\.|I{1,3}\\.|[A-Z]\\.)\\s+[A-Za-z].*")) return true;
        if (line.matches("(?i)^(?:Introduction|Background|Methodology|Related Work|Architecture|Implementation|Results|Discussion|Conclusion|References)\\b.*")) return true;
        if (line.equals(line.toUpperCase()) && line.length() > 3 && line.length() < 50 && line.matches(".*[A-Z].*")) return true;
        return false;
    }

    private static boolean isSubheading(String line) {
        if (line.length() > 80) return false;
        return line.matches("^(?:\\d+\\.\\d+|[a-z]\\))\\s+[A-Za-z].*");
    }

    private static String cleanHeadingTitle(String line) {
        return line.replaceFirst("^(?:\\d+\\.(?:\\d+)?|I{1,3}\\.|[A-Za-z][.)])\\s*", "").trim();
    }

    private static boolean isEquationLine(String line) {
        if (line.length() > 120) return false;
        if (line.matches(".*\\b(?:\\int|\\sum|\\prod|\\partial|\\nabla|\\lambda|\\sigma|\\theta|\\in|\\le|\\ge|\\ne|\\approx)\\b.*")) return true;
        if (line.matches(".*[a-zA-Z0-9_]+\\s*=\\s*[-+/*0-9a-zA-Z\\(\\)\\{\\}\\\\]+.*") && line.contains("=") && !line.contains(";") && !line.startsWith("http")) {
            return line.length() < 80;
        }
        return false;
    }

    private static String formatMathEquation(String line) {
        // Simple clean up for math formatting
        return line.replace("<=", "\\le ")
                   .replace(">=", "\\ge ")
                   .replace("!=", "\\ne ")
                   .replace("->", "\\to ")
                   .replace("=>", "\\implies ")
                   .replace("alpha", "\\alpha")
                   .replace("beta", "\\beta")
                   .replace("lambda", "\\lambda")
                   .replace("theta", "\\theta")
                   .replace("sigma", "\\sigma")
                   .replace("omega", "\\omega")
                   .replace("sum", "\\sum")
                   .replace("int", "\\int");
    }

    private static String escapeLatex(String text) {
        if (text == null) return "";
        return text.replace("&", "\\&")
                   .replace("%", "\\%")
                   .replace("$", "\\$")
                   .replace("#", "\\#")
                   .replace("_", "\\_");
    }
}
