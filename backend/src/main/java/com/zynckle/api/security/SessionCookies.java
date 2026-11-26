package com.zynckle.api.security;

import com.zynckle.api.ai.AiSettings;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * The browser session lives in an HttpOnly cookie, so page scripts (and any XSS) cannot read it.
 * API clients can still send "Authorization: Bearer". Because cookies are sent automatically,
 * cookie-authenticated writes must also carry {@link #CSRF_HEADER}, which other sites cannot add
 * without passing a CORS preflight that only {@link #allowsOrigin} origins pass.
 */
@Component
public class SessionCookies {
    public static final String NAME = "zynckle_session";
    public static final String CSRF_HEADER = "X-Zynckle-Request";
    static final Duration TTL = Duration.ofDays(14);

    private final AiSettings settings;

    public SessionCookies(AiSettings settings) { this.settings = settings; }

    public void issue(HttpServletResponse response, String token) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(token, TTL).toString());
    }

    public void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString());
    }

    private ResponseCookie cookie(String value, Duration maxAge) {
        return ResponseCookie.from(NAME, value).httpOnly(true).secure(secure()).sameSite("Lax").path("/").maxAge(maxAge).build();
    }

    /** Secure cookies need HTTPS; plain http://localhost development would never send them back. */
    private boolean secure() { return settings.publicUrl().toLowerCase(Locale.ROOT).startsWith("https://"); }

    public static String read(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return "";
        return Arrays.stream(cookies).filter(c -> NAME.equals(c.getName())).map(Cookie::getValue).findFirst().orElse("");
    }

    /** Parse the session cookie out of a raw Cookie header (WebSocket handshakes). */
    public static String readHeader(List<String> cookieHeaders) {
        if (cookieHeaders == null) return "";
        for (String header : cookieHeaders) {
            for (String part : header.split(";")) {
                String p = part.trim();
                if (p.startsWith(NAME + "=")) return p.substring(NAME.length() + 1);
            }
        }
        return "";
    }

    /** Browser origins the app is served from: ZYNCKLE_FRONTEND_ORIGIN (comma-separated) and ZYNCKLE_PUBLIC_URL. */
    public List<String> allowedOrigins() {
        List<String> out = new ArrayList<>();
        for (String o : settings.get("ZYNCKLE_FRONTEND_ORIGIN", "http://localhost:5173,http://127.0.0.1:5173").split(",")) {
            if (!o.isBlank()) out.add(o.trim().replaceAll("/$", ""));
        }
        out.add(origin(settings.publicUrl()));
        return out;
    }

    /** True for a configured origin, or a same-origin request (Origin host equals the Host header). */
    public boolean allowsOrigin(String origin, String host) {
        if (origin == null || origin.isBlank()) return true; // not a browser: the token itself is the credential
        String clean = origin.replaceAll("/$", "");
        if (allowedOrigins().contains(clean)) return true;
        try { return host != null && host.equalsIgnoreCase(URI.create(clean).getAuthority()); }
        catch (IllegalArgumentException e) { return false; }
    }

    private static String origin(String url) {
        try { URI u = URI.create(url); return u.getScheme() + "://" + u.getAuthority(); }
        catch (Exception e) { return url; }
    }
}
