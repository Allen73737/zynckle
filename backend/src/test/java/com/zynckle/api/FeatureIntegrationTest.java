package com.zynckle.api;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import java.net.http.HttpResponse;

import static org.junit.jupiter.api.Assertions.*;

/** Previews (editing, private sharing, public links), weekly report email, error reports, LaTeX status. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class FeatureIntegrationTest extends ApiTestSupport {
    private Session owner, member;

    @BeforeAll
    void people() throws Exception {
        owner = register("Lead");
        member = register("Mate");
        join(owner, member, "Mate", "MEMBER");
    }

    private String preview(String title) throws Exception {
        return ok(as(owner, "POST", "/api/previews", "{\"title\":\"" + title + "\",\"url\":\"https://example.com/\",\"kind\":\"url\"}")).get("id").asText();
    }

    @Test
    void previewsCanBeEdited() throws Exception {
        String id = preview("Marketing site");
        JsonNode edited = ok(as(owner, "PATCH", "/api/previews/" + id, "{\"title\":\"Marketing site v2\",\"description\":\"New hero\"}"));
        assertEquals("Marketing site v2", edited.get("title").asText());
        assertEquals("New hero", edited.get("description").asText());
        assertEquals(400, as(owner, "PATCH", "/api/previews/" + id, "{\"url\":\"javascript:alert(1)\"}").statusCode());
    }

    @Test
    void privatePreviewsAreHiddenFromOtherMembers() throws Exception {
        String id = preview("Unreleased redesign");
        ok(as(owner, "PATCH", "/api/previews/" + id, "{\"visibility\":\"private\",\"sharedWith\":[]}"));
        for (JsonNode p : ok(as(member, "GET", "/api/previews", null))) assertNotEquals(id, p.get("id").asText());
        assertEquals(404, as(member, "GET", "/api/previews/" + id, null).statusCode());
        assertEquals(404, as(member, "GET", "/api/previews/" + id + "/share-links", null).statusCode());
        // Only the owner (or an admin) decides who sees it.
        ok(as(owner, "PATCH", "/api/previews/" + id, "{\"visibility\":\"private\",\"sharedWith\":[\"" + member.userId() + "\"]}"));
        assertEquals(403, as(member, "PATCH", "/api/previews/" + id, "{\"visibility\":\"workspace\"}").statusCode());
        assertEquals("Unreleased redesign", ok(as(member, "GET", "/api/previews/" + id, null)).get("title").asText());
    }

    @Test
    void previewsCanBeSharedPubliclyUntilTheyBecomePrivate() throws Exception {
        String id = preview("Launch page");
        String url = ok(as(owner, "POST", "/api/previews/" + id + "/share-links", "{\"expiresInDays\":1}")).get("url").asText();
        JsonNode open = ok(send("GET", "/api/public" + url, null));
        assertEquals("preview", open.get("kind").asText());
        assertEquals("https://example.com/", open.get("url").asText());
        ok(as(owner, "PATCH", "/api/previews/" + id, "{\"visibility\":\"private\"}"));
        assertEquals(404, send("GET", "/api/public" + url, null).statusCode(), "making it private must close its public links");
        assertEquals(409, as(owner, "POST", "/api/previews/" + id + "/share-links", "{}").statusCode());
    }

    @Test
    void deletingAPreviewRemovesItsLinks() throws Exception {
        String id = preview("Temporary");
        String url = ok(as(owner, "POST", "/api/previews/" + id + "/share-links", "{}")).get("url").asText();
        ok(as(owner, "DELETE", "/api/previews/" + id, null));
        assertEquals(404, send("GET", "/api/public" + url, null).statusCode());
    }

    @Test
    void previewCheckAcceptsThePostTheUiSends() throws Exception {
        HttpResponse<String> r = as(owner, "POST", "/api/previews/check", "{\"url\":\"http://127.0.0.1:1/\"}");
        assertEquals(200, r.statusCode(), r.body());
        assertTrue(json.readTree(r.body()).has("reachable"));
    }

    @Test
    void weeklyEmailExplainsWhenMailIsNotConfigured() throws Exception {
        HttpResponse<String> r = as(owner, "POST", "/api/insights/weekly/email", "{\"report\":\"## Shipped\\n- things\",\"to\":\"me\"}");
        assertEquals(503, r.statusCode(), r.body());
        assertTrue(r.body().contains("SMTP"), r.body());
    }

    @Test
    void onlyAdminsCanEmailTheWholeTeam() throws Exception {
        assertEquals(403, as(member, "POST", "/api/insights/weekly/email", "{\"report\":\"x\",\"to\":\"team\"}").statusCode());
        assertEquals(400, as(owner, "POST", "/api/insights/weekly/email", "{\"report\":\"\",\"to\":\"me\"}").statusCode());
    }

    @Test
    void browserErrorsAreAcceptedAndCounted() throws Exception {
        int before = ok(send("GET", "/api/health", null)).get("errorsLastHour").asInt();
        ok(send("POST", "/api/client-errors", "{\"message\":\"TypeError: x is undefined\",\"source\":\"app.js:1:2\",\"page\":\"/projects\"}"));
        assertEquals(before + 1, ok(send("GET", "/api/health", null)).get("errorsLastHour").asInt());
        assertEquals(400, send("POST", "/api/client-errors", "{\"message\":\"\"}").statusCode());
    }

    @Test
    void latexStatusSaysWhichEngineCompiles() throws Exception {
        JsonNode status = ok(send("GET", "/api/latex/status", null));
        String engine = status.get("engine").asText();
        assertTrue(engine.equals("tex") || engine.equals("preview"), engine);
        if (engine.equals("preview")) assertTrue(status.get("message").asText().contains("simplified"));
        HttpResponse<String> pdf = as(owner, "POST", "/api/latex/compile", "{\"source\":\"\\\\documentclass{article}\\\\begin{document}Hello\\\\end{document}\"}");
        assertEquals(200, pdf.statusCode(), pdf.body());
        assertTrue(pdf.body().startsWith("%PDF"), "not a PDF");
    }

    @Test
    void savedViewsAreStoredAndValidated() throws Exception {
        StringBuilder many = new StringBuilder("[");
        for (int i = 0; i < 15; i++) many.append(i == 0 ? "" : ",").append("{\"id\":\"v").append(i).append("\",\"name\":\"View number ").append(i)
            .append("\",\"projectId\":\"p-1\",\"layout\":\"calendar\",\"filter\":\"").append("x".repeat(80)).append("\",\"priority\":\"High\",\"assignee\":\"Me\"}");
        many.append("]");
        JsonNode prefs = ok(as(owner, "PATCH", "/api/auth/preferences", "{\"savedViews\":" + many + "}"));
        assertEquals(15, prefs.get("savedViews").size(), "more than 2,000 characters of views must fit");
        assertEquals("calendar", prefs.at("/savedViews/0/layout").asText());
        assertEquals(15, ok(as(owner, "GET", "/api/auth/me", null)).at("/preferences/savedViews").size());
        // Bad values are cleaned up or rejected.
        JsonNode cleaned = ok(as(owner, "PATCH", "/api/auth/preferences", "{\"savedViews\":[{\"name\":\"Odd\",\"layout\":\"<script>\",\"priority\":\"Mega\",\"assignee\":\"a b\"}]}"));
        assertEquals("board", cleaned.at("/savedViews/0/layout").asText());
        assertEquals("Any", cleaned.at("/savedViews/0/priority").asText());
        assertEquals("Anyone", cleaned.at("/savedViews/0/assignee").asText());
        assertEquals(400, as(owner, "PATCH", "/api/auth/preferences", "{\"savedViews\":[{\"name\":\"\"}]}").statusCode());
    }

    @Test
    void sandboxedTexCannotReadFilesOutsideItsFolder() throws Exception {
        JsonNode status = ok(send("GET", "/api/latex/status", null));
        Assumptions.assumeTrue("tex".equals(status.get("engine").asText()), "needs TeX Live or Tectonic on this machine");
        java.nio.file.Path secret = java.nio.file.Files.createTempFile("zynckle-secret", ".tex");
        java.nio.file.Files.writeString(secret, "TOPSECRET");
        try {
            String path = secret.toAbsolutePath().toString().replace("\\", "/");
            HttpResponse<String> r = as(owner, "POST", "/api/latex/compile",
                "{\"source\":\"\\\\documentclass{article}\\\\begin{document}\\\\input{" + path + "}\\\\end{document}\"}");
            assertNotEquals(200, r.statusCode(), "TeX read a file outside its folder");
        } finally { java.nio.file.Files.deleteIfExists(secret); }
    }
}
