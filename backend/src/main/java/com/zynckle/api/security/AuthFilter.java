package com.zynckle.api.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.Set;

/**
 * Resolves the session for every /api request: the HttpOnly session cookie (browsers) or a bearer
 * token (API clients). Public endpoints work without one; everything else gets a JSON 401 so the
 * frontend can send the user to sign-in. Cookie-authenticated writes must carry the CSRF header.
 */
public class AuthFilter extends OncePerRequestFilter {
    public static final String ATTRIBUTE = "zynckle.currentUser";
    /** The raw session token of this request, so logout can revoke it whichever way it arrived. */
    public static final String TOKEN_ATTRIBUTE = "zynckle.sessionToken";
    private static final Set<String> PUBLIC = Set.of(
        "/api/health", "/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/forgot",
        "/api/auth/reset", "/api/auth/verify", "/api/auth/providers", "/api/ai/status", "/api/latex/status",
        "/api/auth/google/start", "/api/auth/google/callback", "/api/client-errors");
    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS");

    private final AuthService auth;

    public AuthFilter(AuthService auth) { this.auth = auth; }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        String path = request.getRequestURI().replaceAll("/+$", "");
        if (!path.startsWith("/api/") || "OPTIONS".equals(request.getMethod())) { chain.doFilter(request, response); return; }
        String header = Optional.ofNullable(request.getHeader("Authorization")).orElse("");
        String bearer = header.regionMatches(true, 0, "Bearer ", 0, 7) ? header.substring(7).trim() : "";
        String token = bearer.isEmpty() ? SessionCookies.read(request) : bearer;
        boolean fromCookie = bearer.isEmpty() && !token.isEmpty();
        // Cookies are attached by the browser even to requests another site triggers; the custom header is not.
        // (Error reports are exempt: they are anonymous, harmless, and sent with sendBeacon, which cannot add headers.)
        if (fromCookie && !SAFE_METHODS.contains(request.getMethod()) && request.getHeader(SessionCookies.CSRF_HEADER) == null && !"/api/client-errors".equals(path)) {
            reject(response, 403, "Missing " + SessionCookies.CSRF_HEADER + " header");
            return;
        }
        Optional<CurrentUser> user = auth.resolve(token);
        if (user.isPresent()) { request.setAttribute(ATTRIBUTE, user.get()); request.setAttribute(TOKEN_ATTRIBUTE, token); }
        // These authenticate themselves: signed file links (HMAC), public share tokens and signed GitHub webhooks.
        else if (!PUBLIC.contains(path) && !path.matches("/api/files/[^/]+/content|/api/public/share/[^/]+|/api/integrations/github/[^/]+/webhook")) {
            reject(response, 401, "Sign in required");
            return;
        }
        chain.doFilter(request, response);
    }

    private static void reject(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.getOutputStream().write(("{\"error\":\"" + message + "\"}").getBytes(StandardCharsets.UTF_8));
    }
}
