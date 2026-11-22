package com.zynckle.api.security;

import com.zynckle.api.common.ApiException;

import java.util.Arrays;
import java.util.stream.Collectors;

/**
 * The signed-in user and their active workspace, resolved from the bearer token on every
 * request. Controllers take it as a parameter; it never comes from the request body.
 */
public record CurrentUser(String userId, String name, String email, String workspaceId, String workspaceName, String role, String sessionId) {
    public boolean isAdmin() { return "OWNER".equals(role) || "ADMIN".equals(role); }

    public boolean canEdit() { return !"VIEWER".equals(role); }

    public void requireEdit() { if (!canEdit()) throw new ApiException(403, "Viewers cannot change workspace content"); }

    public void requireAdmin() { if (!isAdmin()) throw new ApiException(403, "Workspace admin role required"); }

    public String initials() { return initials(name); }

    /** "Ada Lovelace" → "AL"; matches the avatars the Node API produces. */
    public static String initials(String name) {
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.isEmpty()) return "?";
        return Arrays.stream(trimmed.split("\\s+")).limit(2).map(part -> part.substring(0, 1)).collect(Collectors.joining()).toUpperCase();
    }
}
