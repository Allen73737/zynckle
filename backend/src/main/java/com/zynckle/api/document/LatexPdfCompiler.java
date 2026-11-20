package com.zynckle.api.document;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.*;

public class LatexPdfCompiler {

    public static class TextOp {
        public String font;
        public float size;
        public float x;
        public float y;
        public String text;

        public TextOp(String font, float size, float x, float y, String text) {
            this.font = font;
            this.size = size;
            this.x = x;
            this.y = y;
            this.text = text;
        }
    }

    public static String escapePdf(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)");
    }

    public static String stripLatexFormatting(String s) {
        if (s == null) return "";
        return s.replaceAll("\\\\textbf\\{([^}]+)\\}", "$1")
                .replaceAll("\\\\textit\\{([^}]+)\\}", "$1")
                .replaceAll("\\\\texttt\\{([^}]+)\\}", "$1")
                .replaceAll("\\\\emph\\{([^}]+)\\}", "$1")
                .replaceAll("\\\\underline\\{([^}]+)\\}", "$1")
                .replaceAll("\\\\text\\{([^}]+)\\}", "$1")
                .replaceAll("\\\\frac\\{([^}]+)\\}\\{([^}]+)\\}", "($1 / $2)")
                .replaceAll("\\\\sqrt\\{([^}]+)\\}", "sqrt($1)")
                .replaceAll("\\\\[a-zA-Z]+\\b", "")
                .replaceAll("[{}\\\\]", "")
                .trim();
    }

    public static List<String> wrapText(String text, int maxChars) {
        List<String> lines = new ArrayList<>();
        if (text == null || text.isBlank()) return lines;
        String[] words = text.split("\\s+");
        StringBuilder current = new StringBuilder();

        for (String w : words) {
            if (current.length() + w.length() + 1 <= maxChars) {
                if (current.length() > 0) current.append(" ");
                current.append(w);
            } else {
                if (current.length() > 0) lines.add(current.toString());
                current = new StringBuilder(w);
            }
        }
        if (current.length() > 0) lines.add(current.toString());
        return lines;
    }

    public static byte[] compile(String source) {
        String title = "Zynckle LaTeX Document";
        String author = "";
        String date = LocalDate.now().format(DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US));

        Matcher tm = Pattern.compile("\\\\title\\{([^}]+)\\}").matcher(source);
        if (tm.find()) title = stripLatexFormatting(tm.group(1));

        Matcher am = Pattern.compile("\\\\author\\{([^}]+)\\}").matcher(source);
        if (am.find()) author = stripLatexFormatting(am.group(1));

        Matcher dm = Pattern.compile("\\\\date\\{([^}]+)\\}").matcher(source);
        if (dm.find() && !dm.group(1).contains("today")) date = stripLatexFormatting(dm.group(1));

        String body = source;
        int docStart = source.indexOf("\\begin{document}");
        int docEnd = source.indexOf("\\end{document}");
        if (docStart != -1) {
            body = source.substring(docStart + 16, docEnd != -1 ? docEnd : source.length());
        }
        body = body.replaceAll("%.*$", "").replace("\\maketitle", "").replace("\\tableofcontents", "");

        List<List<TextOp>> pages = new ArrayList<>();
        List<TextOp> currentOps = new ArrayList<>();
        float curY = 780;
        final float bottomMargin = 60;
        final float pageWidth = 595.28f;
        final float pageHeight = 841.89f;

        // Title & metadata
        if (!title.isBlank()) {
            for (String l : wrapText(title, 45)) {
                curY -= 26;
                currentOps.add(new TextOp("/F2", 22, 54, curY, l));
            }
            curY -= 8;
        }
        if (!author.isBlank() || !date.isBlank()) {
            curY -= 16;
            String meta = author + (!author.isBlank() && !date.isBlank() ? "  ·  " : "") + date;
            currentOps.add(new TextOp("/F3", 10, 54, curY, meta));
            curY -= 20;
        }

        String[] rawLines = body.split("\\r?\\n");
        int sectionCounter = 0;

        for (String rawLine : rawLines) {
            String line = rawLine.trim();
            if (line.isBlank()) continue;

            if (line.startsWith("\\section")) {
                sectionCounter++;
                Matcher sm = Pattern.compile("\\\\section\\*?\\{([^}]+)\\}").matcher(line);
                String secTitle = sm.find() ? stripLatexFormatting(sm.group(1)) : "Section " + sectionCounter;
                if (curY < bottomMargin + 60) {
                    pages.add(currentOps);
                    currentOps = new ArrayList<>();
                    curY = 780;
                }
                curY -= 26;
                currentOps.add(new TextOp("/F2", 14, 54, curY, sectionCounter + ". " + secTitle));
                curY -= 8;
            } else if (line.startsWith("\\subsection")) {
                Matcher ssm = Pattern.compile("\\\\subsection\\*?\\{([^}]+)\\}").matcher(line);
                String subTitle = ssm.find() ? stripLatexFormatting(ssm.group(1)) : "Subsection";
                if (curY < bottomMargin + 40) {
                    pages.add(currentOps);
                    currentOps = new ArrayList<>();
                    curY = 780;
                }
                curY -= 20;
                currentOps.add(new TextOp("/F2", 12, 54, curY, subTitle));
                curY -= 6;
            } else if (line.startsWith("\\item")) {
                String itemText = stripLatexFormatting(line.substring(5));
                List<String> wlines = wrapText(itemText, 68);
                for (int i = 0; i < wlines.size(); i++) {
                    if (curY < bottomMargin) {
                        pages.add(currentOps);
                        currentOps = new ArrayList<>();
                        curY = 780;
                    }
                    curY -= 15;
                    String prefix = (i == 0) ? "•  " : "   ";
                    currentOps.add(new TextOp("/F1", 10.5f, 70, curY, prefix + wlines.get(i)));
                }
                curY -= 3;
            } else if (line.startsWith("\\[") || line.contains("equation") || line.contains("align")) {
                String eq = stripLatexFormatting(line);
                if (curY < bottomMargin + 40) {
                    pages.add(currentOps);
                    currentOps = new ArrayList<>();
                    curY = 780;
                }
                curY -= 22;
                currentOps.add(new TextOp("/F4", 11, 95, curY, eq));
                curY -= 14;
            } else {
                String plain = stripLatexFormatting(line);
                for (String l : wrapText(plain, 72)) {
                    if (curY < bottomMargin) {
                        pages.add(currentOps);
                        currentOps = new ArrayList<>();
                        curY = 780;
                    }
                    curY -= 15;
                    currentOps.add(new TextOp("/F1", 11, 54, curY, l));
                }
                curY -= 8;
            }
        }

        if (!currentOps.isEmpty()) pages.add(currentOps);
        if (pages.isEmpty()) pages.add(List.of(new TextOp("/F1", 11, 54, 750, "Blank document")));

        int totalPages = pages.size();
        List<String> objects = new ArrayList<>();
        objects.add(""); // 0 index unused

        // 1: Catalog
        objects.add("<< /Type /Catalog /Pages 2 0 R >>");

        // 2: Pages
        StringBuilder kids = new StringBuilder();
        for (int i = 0; i < totalPages; i++) {
            kids.append(4 + 2 * i).append(" 0 R ");
        }
        objects.add("<< /Type /Pages /Kids [" + kids.toString().trim() + "] /Count " + totalPages + " >>");

        // 3: Font Resources
        objects.add("<< /Font << " +
                "/F1 << /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >> " +
                "/F2 << /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >> " +
                "/F3 << /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >> " +
                "/F4 << /Type /Font /Subtype /Type1 /BaseFont /Courier >> " +
                ">> >>");

        for (int i = 0; i < totalPages; i++) {
            int pageObjId = 4 + 2 * i;
            int contentObjId = 4 + 2 * i + 1;
            List<TextOp> ops = new ArrayList<>(pages.get(i));

            // Footer
            ops.add(new TextOp("/F1", 9, pageWidth / 2 - 12, 35, (i + 1) + " / " + totalPages));

            StringBuilder stream = new StringBuilder("BT\n");
            for (TextOp op : ops) {
                stream.append(op.font).append(" ").append(op.size).append(" Tf\n");
                stream.append(String.format(Locale.US, "%.2f %.2f Td\n", op.x, op.y));
                stream.append("(").append(escapePdf(op.text)).append(") Tj\n");
            }
            stream.append("ET\n");
            byte[] streamBytes = stream.toString().getBytes(StandardCharsets.UTF_8);

            while (objects.size() <= pageObjId) objects.add("");
            objects.set(pageObjId, "<< /Type /Page /Parent 2 0 R /Resources 3 0 R /MediaBox [0 0 " + pageWidth + " " + pageHeight + "] /Contents " + contentObjId + " 0 R >>");

            while (objects.size() <= contentObjId) objects.add("");
            objects.set(contentObjId, "<< /Length " + streamBytes.length + " >>\nstream\n" + stream.toString() + "endstream");
        }

        StringBuilder out = new StringBuilder("%PDF-1.4\n");
        List<Integer> offsets = new ArrayList<>(Collections.nCopies(objects.size(), 0));

        for (int i = 1; i < objects.size(); i++) {
            offsets.set(i, out.toString().getBytes(StandardCharsets.UTF_8).length);
            out.append(i).append(" 0 obj\n").append(objects.get(i)).append("\nendobj\n");
        }

        int xrefOffset = out.toString().getBytes(StandardCharsets.UTF_8).length;
        out.append("xref\n0 ").append(objects.size()).append("\n0000000000 65535 f \n");
        for (int i = 1; i < objects.size(); i++) {
            out.append(String.format(Locale.US, "%010d 00000 n \n", offsets.get(i)));
        }
        out.append("trailer\n<< /Size ").append(objects.size()).append(" /Root 1 0 R >>\nstartxref\n").append(xrefOffset).append("\n%%EOF\n");

        return out.toString().getBytes(StandardCharsets.UTF_8);
    }
}
