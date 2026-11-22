package com.zynckle.api.common;

import java.util.Collection;
import java.util.Map;
import java.util.regex.Pattern;

/** Small request-field helpers that throw 400s with readable messages. */
public final class Validate {
    private Validate() {}

    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");

    public static String str(Map<String, Object> body, String key, String field, int min, int max) {
        Object value = body.get(key);
        String s = value == null ? "" : String.valueOf(value).trim();
        if (s.length() < min) throw new ApiException(400, min <= 1 ? field + " is required" : field + " must be at least " + min + " characters");
        if (s.length() > max) throw new ApiException(400, field + " must be " + max + " characters or fewer");
        return s;
    }

    public static String optional(Map<String, Object> body, String key, String field, int max) {
        if (!body.containsKey(key) || body.get(key) == null) return null;
        return str(body, key, field, 0, max);
    }

    public static String email(Map<String, Object> body, String key) {
        String email = str(body, key, "Email", 1, 320).toLowerCase();
        if (!EMAIL.matcher(email).matches()) throw new ApiException(400, "Enter a valid email address");
        return email;
    }

    public static void password(Object value) {
        if (!(value instanceof String p) || p.length() < 10 || p.length() > 200) throw new ApiException(400, "Password must be between 10 and 200 characters");
        if (!p.matches(".*[A-Za-z].*") || !p.matches(".*[^A-Za-z].*")) throw new ApiException(400, "Use letters plus at least one number or symbol in your password");
    }

    public static String oneOf(Object value, Collection<String> allowed, String field) {
        String s = value == null ? "" : String.valueOf(value);
        if (!allowed.contains(s)) throw new ApiException(400, field + " must be one of " + String.join(", ", allowed));
        return s;
    }
}
