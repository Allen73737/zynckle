package com.zynckle.api.ai.rag;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Tokenizing and structural chunking for the retrieval index. Kept in step with backend/lib/rag.mjs. */
public final class TextTools {
    private TextTools() {}

    public static final int CHUNK_CHARS = 1100;
    private static final int CHUNK_OVERLAP = 160;
    private static final int CODE_LINES = 60;
    private static final int CODE_OVERLAP = 8;

    public record Piece(String text, String section, int startLine, int endLine) {}

    private static final Set<String> STOP = Set.of(("a an and are as at be been but by can could did do does for from had has have how i if in into is it its "
        + "me my no not of on or our should so than that the their them then there these they this those to was we were what when "
        + "where which who why will with would you your about also any just more most some such very use using used").split(" "));
    private static final Pattern WORD = Pattern.compile("[\\p{L}\\p{N}_]+");
    private static final Pattern CAMEL = Pattern.compile("_+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])");
    private static final Pattern DIGIT = Pattern.compile("\\d");
    private static final Pattern HEADING = Pattern.compile("^(#{1,6})\\s+(.+)$");
    private static final Pattern SENTENCE = Pattern.compile("[^.!?\\n]+[.!?]*\\s*");
    private static final Pattern DECLARATION = Pattern.compile("^\\s*(export\\s+)?(default\\s+)?(async\\s+)?(public|private|protected|static|final|abstract|def|fn|func|function|class|interface|type|enum|struct|impl|module|trait|const\\s+\\w+\\s*=\\s*(async\\s*)?\\(|@\\w+).*");

    /** Light suffix stripping; applied identically to queries and passages, so it only has to be consistent. */
    static String stem(String word) {
        if (word.length() <= 4 || DIGIT.matcher(word).find()) return word;
        return word.replaceAll("ies$", "y")
            .replaceAll("(?<=\\w{3})(?:ings?|edly|ed|ly|ment|ness)$", "")
            .replaceAll("(?<=\\w{3})es$", "e")
            .replaceAll("(?<=[^s])s$", "")
            .replaceAll("([b-df-hj-km-np-rtv-z])\\1$", "$1");
    }

    /** Split identifiers (camelCase, snake_case) as well as keeping them whole. */
    public static List<String> tokenize(String text) {
        List<String> out = new ArrayList<>();
        Matcher m = WORD.matcher(text == null ? "" : text);
        while (m.find()) {
            String raw = m.group();
            if (raw.length() > 60) continue;
            List<String> parts = Arrays.stream(CAMEL.split(raw)).filter(p -> !p.isEmpty()).toList();
            if (parts.size() > 1) out.add(raw.toLowerCase(Locale.ROOT).replace("_", ""));
            for (String part : parts) {
                String word = part.toLowerCase(Locale.ROOT);
                if ((word.length() < 2 && !DIGIT.matcher(word).find()) || STOP.contains(word)) continue;
                out.add(stem(word));
            }
        }
        return out;
    }

    private static String decode(String text) {
        return text.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&");
    }

    /** Rich-text HTML to Markdown-ish prose that keeps headings and list structure. */
    public static String htmlToText(String html) {
        String s = html == null ? "" : html;
        s = s.replaceAll("(?is)<(script|style)[^>]*>.*?</\\1>", " ");
        Matcher h = Pattern.compile("(?is)<h([1-6])[^>]*>(.*?)</h\\1>").matcher(s);
        StringBuilder sb = new StringBuilder();
        while (h.find()) h.appendReplacement(sb, Matcher.quoteReplacement("\n\n" + "#".repeat(Integer.parseInt(h.group(1))) + " " + h.group(2).replaceAll("<[^>]*>", "") + "\n\n"));
        h.appendTail(sb);
        s = sb.toString()
            .replaceAll("(?i)<li[^>]*>", "\n- ")
            .replaceAll("(?i)<(br|/p|/div|/tr|/blockquote|/pre)[^>]*>", "\n")
            .replaceAll("(?i)</t[dh]>", " | ")
            .replaceAll("<[^>]*>", " ");
        return decode(s).replaceAll("[ \\t]+", " ").replaceAll(" *\\n *", "\n").replaceAll("\\n{3,}", "\n\n").trim();
    }

    public static String latexToText(String source) {
        String s = (source == null ? "" : source).replaceAll("(?m)(?<!\\\\)%.*$", "");
        Matcher m = Pattern.compile("\\\\((?:sub){0,2})section\\*?\\{([^}]*)\\}").matcher(s);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String level = m.group(1).isEmpty() ? "#" : m.group(1).length() == 3 ? "##" : "###";
            m.appendReplacement(sb, Matcher.quoteReplacement("\n\n" + level + " " + m.group(2) + "\n\n"));
        }
        m.appendTail(sb);
        return sb.toString().replaceAll("\\\\(?:chapter|title)\\*?\\{([^}]*)\\}", "\n\n# $1\n\n").replaceAll("\\n{3,}", "\n\n").trim();
    }

    private static String tail(String value) {
        if (value.length() <= CHUNK_OVERLAP) return value;
        String cut = value.substring(value.length() - CHUNK_OVERLAP);
        return cut.substring(cut.indexOf(' ') + 1);
    }

    private static void flush(List<Piece> chunks, StringBuilder current, String section) {
        String text = current.toString().trim();
        if (!text.isEmpty()) chunks.add(new Piece(text, section, 0, 0));
        current.setLength(0);
    }

    /** Prose chunks follow heading and paragraph boundaries, with a small word-aligned overlap. */
    public static List<Piece> chunkProse(String text) {
        List<Piece> chunks = new ArrayList<>();
        String[] headings = new String[6];
        StringBuilder current = new StringBuilder();
        String section = "";
        for (String raw : (text == null ? "" : text).split("\\n\\s*\\n")) {
            String block = raw.trim();
            if (block.isEmpty()) continue;
            Matcher heading = HEADING.matcher(block);
            if (!block.contains("\n") && heading.matches()) {
                flush(chunks, current, section);
                int level = heading.group(1).length();
                headings[level - 1] = heading.group(2).trim();
                for (int i = level; i < headings.length; i++) headings[i] = null;
                List<String> path = new ArrayList<>();
                for (int i = 0; i < level; i++) if (headings[i] != null) path.add(headings[i]);
                section = String.join(" › ", path);
                current.append(block).append("\n\n");
                continue;
            }
            if (current.length() + block.length() > CHUNK_CHARS && !current.toString().isBlank()) {
                String carry = tail(current.toString());
                flush(chunks, current, section);
                if (!carry.isBlank()) current.append("… ").append(carry).append("\n\n");
            }
            if (block.length() > CHUNK_CHARS) {
                Matcher sentences = SENTENCE.matcher(block);
                while (sentences.find()) {
                    String sentence = sentences.group();
                    if (current.length() + sentence.length() > CHUNK_CHARS) {
                        String carry = tail(current.toString());
                        flush(chunks, current, section);
                        if (!carry.isBlank()) current.append("… ").append(carry).append(' ');
                    }
                    current.append(sentence.length() > CHUNK_CHARS * 1.5 ? sentence.substring(0, CHUNK_CHARS) + " " : sentence);
                }
                current.append("\n\n");
            } else {
                current.append(block).append("\n\n");
            }
        }
        flush(chunks, current, section);
        return chunks;
    }

    /** Code chunks are line windows that prefer to break just before a declaration. */
    public static List<Piece> chunkCode(String text) {
        String[] lines = (text == null ? "" : text).split("\\r?\\n", -1);
        List<Piece> chunks = new ArrayList<>();
        int start = 0;
        while (start < lines.length) {
            int end = Math.min(lines.length, start + CODE_LINES);
            if (end < lines.length) {
                for (int i = end; i > start + CODE_LINES / 2; i--) {
                    if (DECLARATION.matcher(lines[i]).matches() && !lines[i].startsWith("        ")) { end = i; break; }
                }
            }
            String body = String.join("\n", Arrays.copyOfRange(lines, start, end));
            if (!body.isBlank()) {
                String declaration = "";
                for (int i = start; i < end; i++) {
                    if (DECLARATION.matcher(lines[i]).matches() && lines[i].trim().length() < 160) { declaration = lines[i].trim().replaceAll("\\s*\\{\\s*$", ""); break; }
                }
                chunks.add(new Piece(body, declaration, start + 1, end));
            }
            if (end >= lines.length) break;
            start = Math.max(end - CODE_OVERLAP, start + 1);
        }
        return chunks;
    }

    /** Pick the window with the densest query-term coverage. */
    public static String snippet(String text, String query, int size) {
        List<String> words = tokenize(query).stream().filter(w -> w.length() > 2).distinct().toList();
        String clean = text.replaceAll("\\s+", " ").trim();
        if (clean.length() <= size || words.isEmpty()) return clean.length() > size ? clean.substring(0, size) + "…" : clean;
        String lower = clean.toLowerCase(Locale.ROOT);
        int best = 0;
        int bestScore = -1;
        for (int start = 0; start < lower.length() - size / 2; start += 40) {
            String window = lower.substring(start, Math.min(lower.length(), start + size));
            int score = 0;
            for (String w : words) if (window.contains(w)) score++;
            if (score > bestScore) { bestScore = score; best = start; }
        }
        int from = best == 0 ? 0 : clean.lastIndexOf(' ', best) + 1;
        int to = Math.min(clean.length(), from + size);
        return (from > 0 ? "…" : "") + clean.substring(from, to).trim() + (to < clean.length() ? "…" : "");
    }
}
