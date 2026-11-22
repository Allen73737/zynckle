package com.zynckle.api.storage;

import com.zynckle.api.ai.AiSettings;
import com.zynckle.api.common.ApiException;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.regex.Pattern;

/**
 * Binary content for Drive and code projects. Bytes live on local disk under
 * data/uploads; the database only stores keys. Also signs short-lived URLs so that
 * &lt;img&gt;, &lt;video&gt; and &lt;iframe&gt; can load content without a bearer token.
 */
@Component
public class BlobStore {
    private static final Pattern SAFE_KEY = Pattern.compile("^[A-Za-z0-9/_-]{1,200}$");
    private final Path root = Path.of("data", "uploads").toAbsolutePath();
    private final byte[] secret;

    public BlobStore(AiSettings settings) throws IOException {
        Files.createDirectories(root);
        String configured = settings.get("ZYNCKLE_SECRET");
        Path secretFile = Path.of("data", ".secret");
        if (configured.length() >= 32) secret = configured.getBytes(StandardCharsets.UTF_8);
        else if (Files.isRegularFile(secretFile)) secret = Files.readString(secretFile).trim().getBytes(StandardCharsets.UTF_8);
        else {
            byte[] random = new byte[48];
            new SecureRandom().nextBytes(random);
            String hex = HexFormat.of().formatHex(random);
            Files.writeString(secretFile, hex);
            secret = hex.getBytes(StandardCharsets.UTF_8);
        }
    }

    private Path resolve(String key) {
        if (key == null || !SAFE_KEY.matcher(key).matches() || key.contains("..")) throw new ApiException(400, "Invalid storage key");
        Path path = root.resolve(key).normalize();
        if (!path.startsWith(root)) throw new ApiException(400, "Invalid storage key");
        return path;
    }

    public void put(String key, byte[] bytes) {
        try {
            Path path = resolve(key);
            Files.createDirectories(path.getParent());
            Files.write(path, bytes);
        } catch (IOException e) { throw new UncheckedIOException(e); }
    }

    public byte[] get(String key) {
        try { return Files.readAllBytes(resolve(key)); }
        catch (IOException e) { throw new ApiException(404, "Stored content is missing"); }
    }

    public void delete(String key) {
        try { if (key != null) Files.deleteIfExists(resolve(key)); } catch (IOException ignored) { /* best effort */ }
    }

    // ---- Signed URLs ----------------------------------------------------------------

    public String sign(String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    public String signedPath(String base, String subject, long ttlSeconds) {
        long exp = Instant.now().getEpochSecond() + ttlSeconds;
        return base + "?exp=" + exp + "&sig=" + sign(subject + ":" + exp);
    }

    public boolean verify(String subject, String exp, String sig) {
        if (exp == null || sig == null) return false;
        try { if (Long.parseLong(exp) < Instant.now().getEpochSecond()) return false; } catch (NumberFormatException e) { return false; }
        return MessageDigest.isEqual(sign(subject + ":" + exp).getBytes(StandardCharsets.UTF_8), sig.getBytes(StandardCharsets.UTF_8));
    }
}
