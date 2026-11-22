package com.zynckle.api.storage;

import com.zynckle.api.common.ApiException;

import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** File names, MIME types and languages shared by Drive and code projects. */
public final class FileTypes {
    private FileTypes() {}

    public static final Map<String, String> MIME = Map.ofEntries(
        Map.entry("txt", "text/plain"), Map.entry("md", "text/markdown"), Map.entry("csv", "text/csv"), Map.entry("json", "application/json"),
        Map.entry("html", "text/html"), Map.entry("htm", "text/html"), Map.entry("css", "text/css"), Map.entry("js", "text/javascript"), Map.entry("mjs", "text/javascript"),
        Map.entry("xml", "text/xml"), Map.entry("svg", "image/svg+xml"), Map.entry("png", "image/png"), Map.entry("jpg", "image/jpeg"), Map.entry("jpeg", "image/jpeg"),
        Map.entry("gif", "image/gif"), Map.entry("webp", "image/webp"), Map.entry("ico", "image/x-icon"), Map.entry("pdf", "application/pdf"), Map.entry("zip", "application/zip"),
        Map.entry("mp4", "video/mp4"), Map.entry("webm", "video/webm"), Map.entry("mp3", "audio/mpeg"), Map.entry("wav", "audio/wav"),
        Map.entry("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        Map.entry("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        Map.entry("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        Map.entry("woff", "font/woff"), Map.entry("woff2", "font/woff2"), Map.entry("ttf", "font/ttf"),
        Map.entry("java", "text/plain"), Map.entry("ts", "text/plain"), Map.entry("tsx", "text/plain"), Map.entry("py", "text/plain"),
        Map.entry("yml", "text/plain"), Map.entry("yaml", "text/plain"), Map.entry("sql", "text/plain"), Map.entry("tex", "text/plain"));

    /** Executables and scripts that browsers or OSes would run are refused outright. */
    public static final Set<String> BLOCKED = Set.of("exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "jar", "dll", "sh", "app", "dmg", "apk");

    public static final Map<String, String> LANGUAGES = Map.ofEntries(
        Map.entry("java", "Java"), Map.entry("js", "JavaScript"), Map.entry("jsx", "JavaScript"), Map.entry("mjs", "JavaScript"), Map.entry("cjs", "JavaScript"),
        Map.entry("ts", "TypeScript"), Map.entry("tsx", "TypeScript"), Map.entry("py", "Python"), Map.entry("c", "C"), Map.entry("h", "C"), Map.entry("cpp", "C++"),
        Map.entry("cc", "C++"), Map.entry("hpp", "C++"), Map.entry("html", "HTML"), Map.entry("htm", "HTML"), Map.entry("css", "CSS"), Map.entry("scss", "CSS"),
        Map.entry("sql", "SQL"), Map.entry("json", "JSON"), Map.entry("yml", "YAML"), Map.entry("yaml", "YAML"), Map.entry("xml", "XML"), Map.entry("svg", "XML"),
        Map.entry("md", "Markdown"), Map.entry("php", "PHP"), Map.entry("go", "Go"), Map.entry("rs", "Rust"), Map.entry("rb", "Ruby"), Map.entry("kt", "Kotlin"),
        Map.entry("cs", "C#"), Map.entry("sh", "Shell"), Map.entry("toml", "TOML"), Map.entry("vue", "Vue"), Map.entry("svelte", "Svelte"), Map.entry("swift", "Swift"),
        Map.entry("gradle", "Gradle"), Map.entry("txt", "Text"));

    private static final Set<String> BINARY_EXT = Set.of("png", "jpg", "jpeg", "gif", "webp", "ico", "avif", "woff", "woff2", "ttf", "otf", "eot", "mp4", "webm", "mp3", "pdf", "zip");
    private static final Pattern BAD_NAME = Pattern.compile("[\\\\/:*?\"<>|\\x00-\\x1f]");

    public static String extension(String name) {
        int dot = name.lastIndexOf('.');
        return (dot >= 0 ? name.substring(dot + 1) : name).toLowerCase(Locale.ROOT);
    }

    public static String mime(String name) { return MIME.getOrDefault(extension(name), "application/octet-stream"); }

    public static boolean isText(String mime) { return mime.startsWith("text/") || mime.equals("application/json") || mime.equals("image/svg+xml"); }

    public static String validName(String raw) {
        String name = raw == null ? "" : raw.trim();
        if (name.isEmpty() || name.length() > 180) throw new ApiException(400, "File name must be between 1 and 180 characters");
        if (BAD_NAME.matcher(name).find() || name.equals(".") || name.equals("..")) throw new ApiException(400, "File name contains unsupported characters");
        return name;
    }

    public static boolean looksBinary(String path, byte[] bytes) {
        if (BINARY_EXT.contains(extension(path))) return true;
        for (int i = 0; i < Math.min(bytes.length, 8000); i++) if (bytes[i] == 0) return true;
        return false;
    }

    /** Normalise an archive or upload path; null when it escapes the project or is unsafe. */
    public static String normalisePath(String raw) {
        if (raw == null) return null;
        String path = raw.replace('\\', '/').replaceAll("^/+", "");
        if (path.isEmpty() || path.length() > 500 || path.endsWith("/")) return null;
        StringBuilder out = new StringBuilder();
        for (String part : path.split("/")) {
            if (part.isEmpty() || part.equals(".")) continue;
            if (part.equals("..") || part.contains(":") || BAD_NAME.matcher(part).find()) return null;
            if (out.length() > 0) out.append('/');
            out.append(part);
        }
        return out.length() == 0 ? null : out.toString();
    }
}
