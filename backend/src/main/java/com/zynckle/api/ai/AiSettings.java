package com.zynckle.api.ai;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AI and retrieval settings. Lookup order: process environment, Spring properties
 * (application.yml / -D flags), then the repository .env file.
 *
 * Only these keys are read from .env. Importing the whole file into Spring would also pick up
 * DATABASE_URL, which points at PostgreSQL and would silently move the app off embedded H2.
 */
@Component
public class AiSettings {
    private static final Pattern LINE = Pattern.compile("^\\s*([A-Z_][A-Z0-9_]*)\\s*=\\s*(.*?)\\s*$");
    private final Environment env;
    private final Map<String, String> dotEnv = new HashMap<>();

    public AiSettings(Environment env) {
        this.env = env;
        for (Path candidate : List.of(Path.of(".env"), Path.of("..", ".env"))) {
            if (!Files.isRegularFile(candidate)) continue;
            try {
                for (String line : Files.readAllLines(candidate, StandardCharsets.UTF_8)) {
                    Matcher m = LINE.matcher(line);
                    if (!m.matches()) continue;
                    String value = m.group(2);
                    if (value.length() >= 2 && (value.startsWith("\"") && value.endsWith("\"") || value.startsWith("'") && value.endsWith("'"))) value = value.substring(1, value.length() - 1);
                    dotEnv.putIfAbsent(m.group(1), value);
                }
            } catch (IOException ignored) { /* .env is optional */ }
        }
    }

    public String get(String key, String fallback) {
        String value = System.getenv(key);
        if (value == null || value.isEmpty()) value = env.getProperty(key);
        if (value == null || value.isEmpty()) value = dotEnv.get(key);
        return value == null || value.isEmpty() ? fallback : value;
    }

    public String get(String key) { return get(key, ""); }

    public int getInt(String key, int fallback) {
        try { return Integer.parseInt(get(key, String.valueOf(fallback)).trim()); } catch (NumberFormatException e) { return fallback; }
    }

    public double getDouble(String key, double fallback) {
        try { return Double.parseDouble(get(key, String.valueOf(fallback)).trim()); } catch (NumberFormatException e) { return fallback; }
    }

    public String publicUrl() { return get("ZYNCKLE_PUBLIC_URL", "http://localhost:5173"); }
}
