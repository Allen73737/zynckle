package com.zynckle.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/**
 * Provider-independent chat completion client. Groq, Gemini, OpenRouter and any
 * OpenAI-compatible server (Ollama, LM Studio, vLLM, OpenAI) share one streaming protocol,
 * so one client serves them all. Keys never leave the server.
 */
@Component
public class AiClient {
    public record Provider(String id, String label, String url, String key, String model, List<String> suggestions) {
        boolean configured() { return "custom".equals(id) ? !url.isBlank() && !model.isBlank() : !key.isBlank(); }
    }
    public record Resolved(String providerId, String label, String model) {}

    private static final List<String> ORDER = List.of("groq", "gemini", "openrouter", "custom");
    private final AiSettings settings;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final Map<String, Provider> providers = new LinkedHashMap<>();

    public AiClient(AiSettings settings, ObjectMapper json) {
        this.settings = settings;
        this.json = json;
        providers.put("groq", new Provider("groq", "Groq", "https://api.groq.com/openai/v1/chat/completions",
            settings.get("GROQ_API_KEY"), settings.get("GROQ_MODEL", "llama-3.3-70b-versatile"), List.of("llama-3.3-70b-versatile", "llama-3.1-8b-instant")));
        providers.put("gemini", new Provider("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            settings.get("GEMINI_API_KEY"), settings.get("GEMINI_MODEL", "gemini-2.5-flash"), List.of("gemini-2.5-flash", "gemini-2.5-pro")));
        providers.put("openrouter", new Provider("openrouter", "OpenRouter", "https://openrouter.ai/api/v1/chat/completions",
            settings.get("OPENROUTER_API_KEY"), settings.get("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct"), List.of()));
        String customUrl = settings.get("CUSTOM_AI_URL").replaceAll("/$", "");
        providers.put("custom", new Provider("custom", settings.get("CUSTOM_AI_LABEL", "OpenAI-compatible"),
            customUrl.endsWith("/chat/completions") ? customUrl : customUrl + "/chat/completions",
            settings.get("CUSTOM_AI_API_KEY"), settings.get("CUSTOM_AI_MODEL"), List.of()));
    }

    public Optional<String> defaultProvider() {
        String preferred = settings.get("AI_PROVIDER").toLowerCase(Locale.ROOT);
        if (providers.containsKey(preferred) && providers.get(preferred).configured()) return Optional.of(preferred);
        return ORDER.stream().filter(id -> providers.get(id).configured()).findFirst();
    }

    public Map<String, Object> status() {
        Optional<String> fallback = defaultProvider();
        List<Map<String, Object>> list = new ArrayList<>();
        for (Provider p : providers.values()) {
            LinkedHashSet<String> models = new LinkedHashSet<>();
            if (!p.model().isBlank()) models.add(p.model());
            models.addAll(p.suggestions());
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", p.id()); item.put("label", p.label()); item.put("configured", p.configured());
            item.put("defaultModel", p.model()); item.put("models", new ArrayList<>(models));
            list.add(item);
        }
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("available", fallback.isPresent());
        status.put("provider", fallback.map(id -> providers.get(id).label()).orElse("Groq"));
        status.put("defaultProvider", fallback.orElse(null));
        status.put("message", fallback.map(id -> providers.get(id).label() + " is configured").orElse("No AI provider key is configured on the backend"));
        status.put("limits", Map.of("perMinute", settings.getInt("AI_REQUESTS_PER_MINUTE", 20), "perDay", settings.getInt("AI_REQUESTS_PER_DAY", 400)));
        status.put("providers", list);
        return status;
    }

    public Resolved resolve(String requested, String model) {
        String id = requested != null && providers.containsKey(requested) && providers.get(requested).configured() ? requested : defaultProvider().orElse(null);
        if (id == null) throw new AiException(503, "AI is not configured. Add GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY or CUSTOM_AI_URL + CUSTOM_AI_MODEL to the backend environment.");
        String chosen = model != null && model.matches("[\\w.:/-]{1,100}") ? model : providers.get(id).model();
        return new Resolved(id, providers.get(id).label(), chosen);
    }

    /** Stream assistant text deltas to {@code onDelta}. Returns early when {@code cancelled} turns true. */
    public void stream(Resolved target, List<Map<String, String>> messages, double temperature, int maxTokens, Duration timeout,
                       Consumer<String> onDelta, BooleanSupplier cancelled) {
        Provider provider = providers.get(target.providerId());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", target.model()); body.put("messages", messages); body.put("temperature", temperature);
        body.put("max_tokens", maxTokens); body.put("stream", true);
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(provider.url())).timeout(timeout)
            .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(write(body)));
        if (!provider.key().isBlank()) request.header("Authorization", "Bearer " + provider.key());
        if ("openrouter".equals(provider.id())) request.header("HTTP-Referer", settings.publicUrl()).header("X-Title", "Zynckle");

        HttpResponse<InputStream> response;
        try {
            response = http.send(request.build(), HttpResponse.BodyHandlers.ofInputStream());
        } catch (IOException e) {
            throw new AiException(502, "Could not reach " + provider.label());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return;
        }
        try (InputStream in = response.body(); BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            if (response.statusCode() != 200) {
                String detail = errorDetail(new String(in.readAllBytes(), StandardCharsets.UTF_8));
                if (response.statusCode() == 429) throw new AiException(429, provider.label() + " rate limit reached. Wait a moment and try again.");
                throw new AiException(502, provider.label() + " request failed" + (detail.isEmpty() ? "" : ": " + detail));
            }
            String line;
            while ((line = reader.readLine()) != null) {
                if (cancelled.getAsBoolean()) return;
                line = line.trim();
                if (!line.startsWith("data:")) continue;
                String data = line.substring(5).trim();
                if (data.equals("[DONE]")) return;
                try {
                    JsonNode delta = json.readTree(data).path("choices").path(0).path("delta").path("content");
                    if (delta.isTextual() && !delta.asText().isEmpty()) onDelta.accept(delta.asText());
                } catch (IOException ignored) { /* keep-alive or partial frame */ }
            }
        } catch (IOException e) {
            if (!cancelled.getAsBoolean()) throw new AiException(502, "The " + provider.label() + " stream was interrupted");
        }
    }

    public String complete(Resolved target, List<Map<String, String>> messages, double temperature, int maxTokens, Duration timeout) {
        StringBuilder text = new StringBuilder();
        stream(target, messages, temperature, maxTokens, timeout, text::append, () -> false);
        return text.toString();
    }

    /** Call an OpenAI-compatible /embeddings endpoint. */
    public List<float[]> embed(String url, String key, String model, List<String> inputs, Duration timeout) {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url)).timeout(timeout).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(write(Map.of("model", model, "input", inputs))));
        if (key != null && !key.isBlank()) request.header("Authorization", "Bearer " + key);
        try {
            HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                String detail = errorDetail(response.body());
                throw new AiException(502, "Embeddings failed (" + response.statusCode() + ")" + (detail.isEmpty() ? "" : ": " + detail));
            }
            JsonNode data = json.readTree(response.body()).path("data");
            float[][] out = new float[inputs.size()][];
            for (int i = 0; i < data.size(); i++) {
                JsonNode item = data.get(i);
                int index = item.path("index").asInt(i);
                JsonNode values = item.path("embedding");
                float[] v = new float[values.size()];
                for (int j = 0; j < v.length; j++) v[j] = (float) values.get(j).asDouble();
                if (index >= 0 && index < out.length) out[index] = v;
            }
            for (float[] v : out) if (v == null) throw new AiException(502, "The embedding provider returned an unexpected number of vectors");
            return Arrays.asList(out);
        } catch (IOException e) {
            throw new AiException(502, "Could not reach the embedding provider");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AiException(502, "Embedding request interrupted");
        }
    }

    private String errorDetail(String body) {
        try {
            JsonNode node = json.readTree(body);
            JsonNode message = node.isArray() ? node.path(0).path("error").path("message") : node.path("error").path("message");
            return message.isTextual() ? message.asText() : "";
        } catch (IOException e) {
            return "";
        }
    }

    private String write(Object value) {
        try { return json.writeValueAsString(value); } catch (IOException e) { throw new IllegalStateException(e); }
    }
}
