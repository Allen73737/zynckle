package com.zynckle.api.document;

import com.zynckle.api.ai.AiSettings;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Compiles LaTeX with a real TeX engine when one is installed (TeX Live / MiKTeX pdflatex, xelatex,
 * lualatex, or Tectonic), chosen by LATEX_COMPILER or found on PATH. Without one, the caller falls back
 * to {@link LatexPdfCompiler}, a simplified preview renderer, and the status says so plainly.
 *
 * Sources are untrusted: shell escape is disabled, TeX may only read and write inside its temporary
 * folder (openin_any/openout_any = p), runs are time-limited, and only two compile at once.
 */
@Component
public class LatexEngine {
    private static final Logger log = LoggerFactory.getLogger(LatexEngine.class);
    private static final List<String> CANDIDATES = List.of("tectonic", "pdflatex", "xelatex", "lualatex");
    private static final long TIMEOUT_SECONDS = 45;
    private static final Pattern ERROR = Pattern.compile("^! (.+)$");
    private static final Pattern LINE = Pattern.compile("^l\\.(\\d+)");

    public record Result(byte[] pdf, List<Map<String, Object>> errors, String log) {}

    private final Optional<Path> executable;
    private final Semaphore slots = new Semaphore(2);

    /** Why a TeX engine that was found is not used (shown in the LaTeX status), or null. */
    private final String disabledReason;

    public LatexEngine(AiSettings settings) {
        Optional<Path> found = locate(settings.get("LATEX_COMPILER", ""));
        String reason = null;
        // MiKTeX ignores openin_any/openout_any, so a document could \input any file the server can read.
        // Only use it when the operator accepts that (a single-user machine), never by default.
        if (found.isPresent() && isMiktex(found.get()) && !"true".equalsIgnoreCase(settings.get("LATEX_ALLOW_MIKTEX", ""))) {
            reason = "MiKTeX was found but is not used: it cannot stop a document from reading other files on the server. "
                + "Install TeX Live or Tectonic, or set LATEX_ALLOW_MIKTEX=true if only trusted people use this server.";
            log.warn("LaTeX: {} is MiKTeX, which cannot sandbox file reads; using the preview renderer. Set LATEX_ALLOW_MIKTEX=true to use it anyway.", found.get());
            found = Optional.empty();
        }
        this.executable = found;
        this.disabledReason = reason;
        if (reason == null) executable.ifPresentOrElse(p -> log.info("LaTeX: using {}", p), () -> log.info("LaTeX: no TeX engine found; using the simplified preview renderer"));
    }

    public boolean available() { return executable.isPresent(); }

    public String disabledReason() { return disabledReason; }

    /** MiKTeX identifies itself in --version ("MiKTeX-pdfTeX ..."); TeX Live prints "pdfTeX ... (TeX Live ...)". */
    static boolean isMiktex(Path exe) {
        if (exe.getFileName().toString().toLowerCase(Locale.ROOT).startsWith("tectonic")) return false;
        if (exe.toString().toLowerCase(Locale.ROOT).contains("miktex")) return true;
        try {
            Process p = new ProcessBuilder(exe.toString(), "--version").redirectErrorStream(true).start();
            if (!p.waitFor(15, TimeUnit.SECONDS)) { p.destroyForcibly(); return false; }
            String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            return out.toLowerCase(Locale.ROOT).contains("miktex");
        } catch (IOException e) {
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    /** e.g. "pdflatex", or null when only the preview renderer is available. */
    public String name() { return executable.map(p -> p.getFileName().toString().replaceAll("(?i)\\.exe$", "")).orElse(null); }

    private static Optional<Path> locate(String configured) {
        if (!configured.isBlank()) {
            Path direct = Path.of(configured);
            if (Files.isExecutable(direct)) return Optional.of(direct);
            return onPath(configured);
        }
        for (String name : CANDIDATES) { Optional<Path> found = onPath(name); if (found.isPresent()) return found; }
        return Optional.empty();
    }

    private static Optional<Path> onPath(String name) {
        String path = Objects.toString(System.getenv("PATH"), "");
        boolean windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        for (String dir : path.split(File.pathSeparator)) {
            if (dir.isBlank()) continue;
            for (String candidate : windows ? List.of(name + ".exe", name + ".cmd", name) : List.of(name)) {
                Path p = Path.of(dir, candidate);
                if (Files.isRegularFile(p) && Files.isExecutable(p)) return Optional.of(p);
            }
        }
        return Optional.empty();
    }

    public Result compile(String source) throws IOException, InterruptedException {
        if (executable.isEmpty()) throw new IllegalStateException("No TeX engine installed");
        if (!slots.tryAcquire(20, TimeUnit.SECONDS)) return failure("The compiler is busy. Try again in a moment.", "");
        Path dir = Files.createTempDirectory("zynckle-tex-");
        try {
            Files.writeString(dir.resolve("main.tex"), source, StandardCharsets.UTF_8);
            String exe = executable.get().toString();
            boolean tectonic = name().equalsIgnoreCase("tectonic");
            List<String> command = tectonic
                ? List.of(exe, "--untrusted", "--keep-logs", "--outdir", dir.toString(), dir.resolve("main.tex").toString())
                : List.of(exe, "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "main.tex");
            ProcessBuilder pb = new ProcessBuilder(command).directory(dir.toFile()).redirectErrorStream(true);
            pb.environment().put("openin_any", "p");   // TeX may only read files inside its folder (and the TeX tree)
            pb.environment().put("openout_any", "p");
            pb.environment().put("shell_escape", "f");
            pb.redirectOutput(dir.resolve("console.txt").toFile());
            Process process = pb.start();
            if (!process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                return failure("Compilation took longer than " + TIMEOUT_SECONDS + " seconds and was stopped.", "");
            }
            String logText = read(dir.resolve("main.log"));
            if (logText.isBlank()) logText = read(dir.resolve("console.txt"));
            Path pdf = dir.resolve("main.pdf");
            if (process.exitValue() == 0 && Files.isRegularFile(pdf)) return new Result(Files.readAllBytes(pdf), List.of(), tail(logText));
            List<Map<String, Object>> errors = parseErrors(logText);
            if (errors.isEmpty()) errors = List.of(error(null, "Compilation failed (exit code " + process.exitValue() + "). See the log for details."));
            return new Result(null, errors, tail(logText));
        } finally {
            slots.release();
            deleteQuietly(dir);
        }
    }

    static List<Map<String, Object>> parseErrors(String logText) {
        List<Map<String, Object>> out = new ArrayList<>();
        String[] lines = logText.split("\\R");
        for (int i = 0; i < lines.length && out.size() < 20; i++) {
            Matcher m = ERROR.matcher(lines[i]);
            // -file-line-error prints "./main.tex:12: Undefined control sequence."
            Matcher fl = Pattern.compile("^\\./main\\.tex:(\\d+): (.+)$").matcher(lines[i]);
            if (fl.find()) { out.add(error(Integer.parseInt(fl.group(1)), fl.group(2))); continue; }
            if (!m.find()) continue;
            Integer line = null;
            for (int j = i + 1; j < Math.min(lines.length, i + 12); j++) {
                Matcher l = LINE.matcher(lines[j]);
                if (l.find()) { line = Integer.parseInt(l.group(1)); break; }
            }
            out.add(error(line, m.group(1)));
        }
        return out;
    }

    private static Map<String, Object> error(Integer line, String message) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("line", line);
        e.put("message", message);
        return e;
    }

    private static Result failure(String message, String logText) { return new Result(null, List.of(error(null, message)), logText); }

    private static String read(Path p) {
        try { return Files.isRegularFile(p) ? new String(Files.readAllBytes(p), StandardCharsets.UTF_8) : ""; } catch (IOException e) { return ""; }
    }

    private static String tail(String s) { return s.length() <= 8000 ? s : s.substring(s.length() - 8000); }

    private static void deleteQuietly(Path dir) {
        try (var walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> { try { Files.deleteIfExists(p); } catch (IOException ignored) { } });
        } catch (IOException ignored) { }
    }
}
