package com.zynckle.api;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * End-to-end checks of the rules that protect people's data: sessions, CSRF, workspace isolation,
 * private documents (over REST and the co-editing socket), roles, public share links and CORS.
 * Runs the real application on an in-memory database with Flyway migrations applied.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class SecurityIntegrationTest extends ApiTestSupport {
    private Session owner, member, outsider;

    // ---- setup -----------------------------------------------------------------------------

    @BeforeAll
    void people() throws Exception {
        owner = register("Owner");
        member = register("Member");
        outsider = register("Outsider");
        join(owner, member, "Member", "MEMBER");
    }

    // ---- sessions and CSRF -----------------------------------------------------------------

    @Test @Order(1)
    void sessionCookieIsHttpOnlyAndSameSite() throws Exception {
        HttpResponse<String> r = send("POST", "/api/auth/login", "{\"email\":\"owner-" + suffix + "@example.test\",\"password\":\"correct-horse-42!\"}");
        String header = r.headers().allValues("Set-Cookie").stream().filter(c -> c.startsWith("zynckle_session=")).findFirst().orElseThrow();
        assertTrue(header.contains("HttpOnly"), header);
        assertTrue(header.contains("SameSite=Lax"), header);
        assertTrue(header.contains("Path=/"), header);
    }

    @Test @Order(2)
    void wrongPasswordIsRejected() throws Exception {
        HttpResponse<String> r = send("POST", "/api/auth/login", "{\"email\":\"owner-" + suffix + "@example.test\",\"password\":\"wrong-password-1\"}");
        assertEquals(401, r.statusCode());
        assertTrue(r.headers().allValues("Set-Cookie").stream().noneMatch(c -> c.startsWith("zynckle_session=") && !c.startsWith("zynckle_session=;")));
    }

    @Test @Order(3)
    void apiRequiresASession() throws Exception {
        assertEquals(401, send("GET", "/api/projects", null).statusCode());
        assertEquals(401, send("GET", "/api/projects", null, "Cookie", "zynckle_session=not-a-real-token").statusCode());
        assertEquals(200, send("GET", "/api/health", null).statusCode());
    }

    @Test @Order(4)
    void cookieAuthenticatedWritesNeedTheCsrfHeader() throws Exception {
        // A cross-site form or fetch carries the cookie but cannot add the custom header.
        HttpResponse<String> forged = send("POST", "/api/projects", "{\"name\":\"Forged\"}", "Cookie", owner.cookie());
        assertEquals(403, forged.statusCode(), forged.body());
        // Reads are fine without it, and the real app's writes include it.
        assertEquals(200, send("GET", "/api/projects", null, "Cookie", owner.cookie()).statusCode());
        ok(as(owner, "POST", "/api/projects", "{\"name\":\"Real project\"}"));
    }

    @Test @Order(5)
    void bearerTokensStillWorkForApiClients() throws Exception {
        ok(send("POST", "/api/projects", "{\"name\":\"From a script\"}", "Authorization", "Bearer " + owner.token()));
    }

    // ---- workspace isolation and roles ------------------------------------------------------

    @Test @Order(10)
    void outsidersCannotSeeAnotherWorkspace() throws Exception {
        String projectId = ok(as(owner, "POST", "/api/projects", "{\"name\":\"Secret plans\"}")).get("id").asText();
        HttpResponse<String> direct = as(outsider, "GET", "/api/projects/" + projectId, null);
        assertTrue(direct.statusCode() == 404 || direct.statusCode() == 403, "outsider got " + direct.statusCode());
        for (JsonNode p : ok(as(outsider, "GET", "/api/projects", null))) assertNotEquals(projectId, p.get("id").asText());
        HttpResponse<String> task = as(outsider, "POST", "/api/projects/" + projectId + "/tasks", "{\"title\":\"Sneaky\"}");
        assertTrue(task.statusCode() == 404 || task.statusCode() == 403, "outsider could add a task: " + task.statusCode());
    }

    @Test @Order(11)
    void membersShareTheWorkspace() throws Exception {
        String projectId = ok(as(owner, "POST", "/api/projects", "{\"name\":\"Team project\"}")).get("id").asText();
        assertEquals("Team project", ok(as(member, "GET", "/api/projects/" + projectId, null)).get("name").asText());
    }

    // ---- private documents --------------------------------------------------------------------

    private String privateDocument() throws Exception {
        return ok(as(owner, "POST", "/api/documents", "{\"title\":\"Private notes\",\"content\":\"<p>for my eyes</p>\",\"type\":\"rich-text\",\"visibility\":\"private\"}")).get("id").asText();
    }

    @Test @Order(20)
    void privateDocumentsAreHiddenFromOtherMembers() throws Exception {
        String id = privateDocument();
        for (JsonNode d : ok(as(member, "GET", "/api/documents", null))) assertNotEquals(id, d.get("id").asText());
        assertNotEquals(200, as(member, "GET", "/api/documents/" + id, null).statusCode());
        assertNotEquals(200, as(member, "PATCH", "/api/documents/" + id, "{\"title\":\"Hijacked\"}").statusCode());
        // Search and the AI knowledge index must not leak it either.
        JsonNode search = ok(as(member, "GET", "/api/search?q=Private", null));
        for (JsonNode r : search.get("results")) assertNotEquals(id, r.get("id").asText());
    }

    @Test @Order(21)
    void collaboratorsCanOpenAPrivateDocument() throws Exception {
        String id = privateDocument();
        ok(as(owner, "PATCH", "/api/documents/" + id, "{\"collaboratorIds\":[\"" + member.userId() + "\"]}"));
        assertEquals("Private notes", ok(as(member, "GET", "/api/documents/" + id, null)).get("title").asText());
    }

    @Test @Order(22)
    void coEditingSocketRespectsPrivateDocuments() throws Exception {
        String id = privateDocument();
        assertEquals(4403, closeCode(member, "/collab/" + id), "a member who is not a collaborator must not join the live session");
        assertEquals(-1, closeCode(owner, "/collab/" + id), "the owner must be able to join");
    }

    /** Opens a socket and returns the close code the server sends within a few seconds, or -1 if it stays open. */
    private int closeCode(Session s, String path) throws Exception {
        CompletableFuture<Integer> closed = new CompletableFuture<>();
        WebSocket ws = http.newWebSocketBuilder().header("Cookie", s.cookie())
            .buildAsync(URI.create("ws://localhost:" + port + path), new WebSocket.Listener() {
                @Override public CompletionStage<?> onClose(WebSocket w, int code, String reason) { closed.complete(code); return null; }
                @Override public void onError(WebSocket w, Throwable error) { closed.completeExceptionally(error); }
            }).get(10, TimeUnit.SECONDS);
        try { return closed.get(3, TimeUnit.SECONDS); }
        catch (java.util.concurrent.TimeoutException stillOpen) { ws.sendClose(WebSocket.NORMAL_CLOSURE, "done"); return -1; }
    }

    @Test @Order(23)
    void socketsRefuseOtherSitesEvenWithTheCookie() throws Exception {
        // A page on another site can open a WebSocket to us, and the browser attaches the cookie.
        // The Origin check must refuse it; a spoofed X-Forwarded-Host must not help.
        java.util.concurrent.ExecutionException refused = assertThrows(java.util.concurrent.ExecutionException.class, () ->
            http.newWebSocketBuilder().header("Cookie", owner.cookie()).header("Origin", "https://evil.example").header("X-Forwarded-Host", "evil.example")
                .buildAsync(URI.create("ws://localhost:" + port + "/ws"), new WebSocket.Listener() { }).get(10, TimeUnit.SECONDS));
        assertTrue(String.valueOf(refused.getCause()).contains("403") || refused.getCause() instanceof java.net.http.WebSocketHandshakeException, String.valueOf(refused.getCause()));
        // The app's own origin is accepted.
        WebSocket ok = http.newWebSocketBuilder().header("Cookie", owner.cookie()).header("Origin", "http://localhost:5173")
            .buildAsync(URI.create("ws://localhost:" + port + "/ws"), new WebSocket.Listener() { }).get(10, TimeUnit.SECONDS);
        ok.sendClose(WebSocket.NORMAL_CLOSURE, "done");
    }

    // ---- public share links -------------------------------------------------------------------

    @Test @Order(30)
    void privateDocumentsCannotBeSharedPublicly() throws Exception {
        assertEquals(409, as(owner, "POST", "/api/documents/" + privateDocument() + "/share-links", "{}").statusCode());
    }

    @Test @Order(31)
    void shareLinksWorkSignedOutAndStopWhenRevoked() throws Exception {
        String id = ok(as(owner, "POST", "/api/documents", "{\"title\":\"Public spec\",\"content\":\"<p>hello</p>\",\"type\":\"rich-text\"}")).get("id").asText();
        JsonNode link = ok(as(owner, "POST", "/api/documents/" + id + "/share-links", "{\"expiresInDays\":7}"));
        String url = link.get("url").asText();
        JsonNode open = ok(send("GET", "/api/public" + url, null));
        assertEquals("Public spec", open.get("title").asText());
        assertFalse(open.has("ownerId") || open.has("workspaceId"), "the public view must not expose internal ids");
        // The list never shows the token again, and a guessed token fails.
        assertFalse(ok(as(owner, "GET", "/api/documents/" + id + "/share-links", null)).toString().contains(url.substring(7)));
        assertEquals(404, send("GET", "/api/public/share/guessed-token", null).statusCode());
        // Outsiders cannot revoke it; the owner can, and it stops working.
        assertNotEquals(200, as(outsider, "DELETE", "/api/share-links/" + link.get("id").asText(), null).statusCode());
        ok(as(owner, "DELETE", "/api/share-links/" + link.get("id").asText(), null));
        assertEquals(404, send("GET", "/api/public" + url, null).statusCode());
    }

    @Test @Order(32)
    void makingADocumentPrivateClosesItsPublicLinks() throws Exception {
        String id = ok(as(owner, "POST", "/api/documents", "{\"title\":\"Soon private\",\"content\":\"<p>x</p>\",\"type\":\"rich-text\"}")).get("id").asText();
        String url = ok(as(owner, "POST", "/api/documents/" + id + "/share-links", "{}")).get("url").asText();
        ok(as(owner, "PATCH", "/api/documents/" + id, "{\"visibility\":\"private\"}"));
        assertEquals(404, send("GET", "/api/public" + url, null).statusCode());
    }

    // ---- CORS ----------------------------------------------------------------------------------

    @Test @Order(40)
    void otherSitesCannotMakeCredentialedRequests() throws Exception {
        HttpResponse<String> evil = send("OPTIONS", "/api/projects", null, "Origin", "https://evil.example",
            "Access-Control-Request-Method", "POST", "Access-Control-Request-Headers", "x-zynckle-request,content-type");
        assertTrue(evil.headers().firstValue("Access-Control-Allow-Origin").isEmpty(), "evil origin was allowed: " + evil.headers().map());
        HttpResponse<String> app = send("OPTIONS", "/api/projects", null, "Origin", "http://localhost:5173",
            "Access-Control-Request-Method", "POST", "Access-Control-Request-Headers", "x-zynckle-request,content-type");
        assertEquals("http://localhost:5173", app.headers().firstValue("Access-Control-Allow-Origin").orElse(""));
    }

    // ---- roles (last: changes the member's role) ----------------------------------------------

    @Test @Order(50)
    void viewersCanReadButNotWrite() throws Exception {
        ok(as(owner, "PATCH", "/api/team/members/" + member.userId(), "{\"role\":\"VIEWER\"}"));
        assertEquals(200, as(member, "GET", "/api/projects", null).statusCode());
        assertEquals(403, as(member, "POST", "/api/projects", "{\"name\":\"Viewer project\"}").statusCode());
        assertEquals(403, as(member, "POST", "/api/team/invitations", "{\"email\":\"x-" + suffix + "@example.test\"}").statusCode());
    }

    @Test @Order(60)
    void signingOutRevokesTheSession() throws Exception {
        Session s = new Session(cookieFrom(send("POST", "/api/auth/login", "{\"email\":\"outsider-" + suffix + "@example.test\",\"password\":\"correct-horse-42!\"}")), null, outsider.userId());
        assertEquals(200, as(s, "GET", "/api/auth/me", null).statusCode());
        HttpResponse<String> out = as(s, "POST", "/api/auth/logout", null);
        assertEquals(200, out.statusCode());
        assertTrue(out.headers().allValues("Set-Cookie").stream().anyMatch(c -> c.startsWith("zynckle_session=;") || c.contains("Max-Age=0")), "cookie not cleared");
        assertEquals(401, as(s, "GET", "/api/auth/me", null).statusCode(), "the old cookie must stop working");
    }
}
