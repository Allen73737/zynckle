package com.zynckle.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;

/** Runs the real app on an in-memory database (Flyway applied) and talks to it over HTTP like a browser. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.datasource.url=jdbc:h2:mem:zynckle-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "ZYNCKLE_PUBLIC_URL=http://localhost:5173",
    "ZYNCKLE_FRONTEND_ORIGIN=http://localhost:5173",
})
abstract class ApiTestSupport {
    @LocalServerPort int port;
    protected final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    protected final ObjectMapper json = new ObjectMapper();
    protected final String suffix = UUID.randomUUID().toString().substring(0, 8);

    /** A signed-in person: the cookie the server set, and the token it also returns for API clients. */
    protected record Session(String cookie, String token, String userId) {}

    protected HttpResponse<String> send(String method, String path, String body, String... headers) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(Duration.ofSeconds(20))
            .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        if (body != null) b.header("Content-Type", "application/json");
        for (int i = 0; i < headers.length; i += 2) b.header(headers[i], headers[i + 1]);
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    /** A browser request: session cookie plus the CSRF header the frontend always sends. */
    protected HttpResponse<String> as(Session s, String method, String path, String body) throws Exception {
        return send(method, path, body, "Cookie", s.cookie(), "X-Zynckle-Request", "1");
    }

    protected JsonNode ok(HttpResponse<String> r) throws Exception {
        assertTrue(r.statusCode() >= 200 && r.statusCode() < 300, () -> "expected 2xx, got " + r.statusCode() + ": " + r.body());
        return json.readTree(r.body());
    }

    protected static String cookieFrom(HttpResponse<String> r) {
        return r.headers().allValues("Set-Cookie").stream().filter(c -> c.startsWith("zynckle_session="))
            .findFirst().map(c -> c.split(";", 2)[0]).orElseThrow(() -> new AssertionError("no session cookie in " + r.headers().map()));
    }

    protected String email(String name) { return name.toLowerCase() + "-" + suffix + "@example.test"; }

    protected Session register(String name) throws Exception {
        HttpResponse<String> r = send("POST", "/api/auth/register", "{\"name\":\"" + name + "\",\"email\":\"" + email(name) + "\",\"password\":\"correct-horse-42!\"}");
        JsonNode body = ok(r);
        return new Session(cookieFrom(r), body.get("token").asText(), body.at("/user/id").asText());
    }

    /** Invite {@code who} into {@code owner}'s workspace and accept, so they share it. */
    protected void join(Session owner, Session who, String name, String role) throws Exception {
        JsonNode invite = ok(as(owner, "POST", "/api/team/invitations", "{\"email\":\"" + email(name) + "\",\"role\":\"" + role + "\"}"));
        String token = invite.get("inviteUrl").asText().replaceAll(".*invite=", "");
        ok(as(who, "POST", "/api/team/invitations/accept", "{\"token\":\"" + token + "\"}"));
    }
}
