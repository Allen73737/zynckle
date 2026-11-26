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
 * Resolves the bearer token for every /api request. Public endpoints work without one;
 * everything else gets a JSON 401 so the frontend can send the user to sign-in.
 */
public class AuthFilter extends OncePerRequestFilter {
    public static final String ATTRIBUTE = "zynckle.currentUser";
    private static final Set<String> PUBLIC = Set.of(
        "/api/health", "/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/forgot",
        "/api/auth/reset", "/api/auth/verify", "/api/auth/providers", "/api/ai/status", "/api/latex/status",
        "/api/auth/google/start", "/api/auth/google/callback");

    private final AuthService auth;

    public AuthFilter(AuthService auth) { this.auth = auth; }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        String path = request.getRequestURI().replaceAll("/+$", "");
        if (!path.startsWith("/api/") || "OPTIONS".equals(request.getMethod())) { chain.doFilter(request, response); return; }
        String header = Optional.ofNullable(request.getHeader("Authorization")).orElse("");
        String token = header.regionMatches(true, 0, "Bearer ", 0, 7) ? header.substring(7).trim() : "";
        Optional<CurrentUser> user = auth.resolve(token);
        if (user.isPresent()) request.setAttribute(ATTRIBUTE, user.get());
        // These authenticate themselves: signed file links (HMAC), public share tokens and signed GitHub webhooks.
        else if (!PUBLIC.contains(path) && !path.matches("/api/files/[^/]+/content|/api/public/share/[^/]+|/api/integrations/github/[^/]+/webhook")) {
            response.setStatus(401);
            response.setContentType("application/json");
            response.getOutputStream().write("{\"error\":\"Sign in required\"}".getBytes(StandardCharsets.UTF_8));
            return;
        }
        chain.doFilter(request, response);
    }
}
