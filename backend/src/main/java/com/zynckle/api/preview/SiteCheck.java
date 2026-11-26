package com.zynckle.api.preview;

import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.*;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Checks whether a URL can be shown in the preview iframe: is it reachable, and does it allow
 * framing (X-Frame-Options / CSP frame-ancestors)? The server makes this request on the user's
 * behalf, so it refuses private, loopback and link-local addresses and re-checks every redirect
 * hop to stop server-side request forgery against the local network.
 */
@Component
public class SiteCheck {
    private static final int MAX_REDIRECTS = 4;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();

    static boolean isPublic(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isSiteLocalAddress() || address.isMulticastAddress()) return false;
        byte[] b = address.getAddress();
        if (b.length == 4) {
            int first = b[0] & 0xff, second = b[1] & 0xff;
            if (first == 0 || first >= 224) return false;
            if (first == 100 && second >= 64 && second <= 127) return false; // carrier-grade NAT
            if (first == 169 && second == 254) return false;                // cloud metadata range
        } else if ((b[0] & 0xfe) == 0xfc) {
            return false;                                                    // IPv6 unique-local
        }
        return true;
    }

    private static Map<String, Object> result(Boolean reachable, Boolean embeddable, String reason, Integer status) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("reachable", reachable); out.put("embeddable", embeddable); out.put("reason", reason);
        if (status != null) out.put("status", status);
        return out;
    }

    public Map<String, Object> check(String raw) {
        URI uri;
        try { uri = new URI(raw == null ? "" : raw.trim()); } catch (URISyntaxException e) { return result(false, false, "That is not a valid URL", null); }
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            String scheme = Optional.ofNullable(uri.getScheme()).orElse("").toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) return result(false, false, "Only http:// and https:// addresses can be previewed", null);
            if (uri.getHost() == null) return result(false, false, "The URL has no host", null);
            try {
                for (InetAddress address : InetAddress.getAllByName(uri.getHost())) {
                    if (!isPublic(address)) return result(null, null, "Private and local network addresses are not checked from the server. The preview may still load in your browser.", null);
                }
            } catch (UnknownHostException e) {
                return result(false, false, "The host name could not be resolved", null);
            }
            HttpResponse<Void> response;
            try {
                response = http.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(8)).header("User-Agent", "ZynckleLinkCheck/1.0")
                    .method("GET", HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.discarding());
            } catch (IOException e) {
                return result(false, false, "The site did not respond", null);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return result(false, false, "The check was interrupted", null);
            } catch (IllegalArgumentException e) {
                return result(false, false, "That is not a valid URL", null);
            }
            int status = response.statusCode();
            if (status >= 300 && status < 400) {
                Optional<String> location = response.headers().firstValue("location");
                if (location.isEmpty()) return result(false, false, "The site redirected without a destination", status);
                uri = uri.resolve(location.get());
                continue;
            }
            if (status >= 400) return result(false, false, "The site answered with HTTP " + status, status);
            String frame = response.headers().firstValue("x-frame-options").orElse("").toLowerCase(Locale.ROOT);
            String csp = response.headers().allValues("content-security-policy").stream().reduce("", (a, b) -> a + ";" + b).toLowerCase(Locale.ROOT);
            String ancestors = csp.contains("frame-ancestors") ? csp.substring(csp.indexOf("frame-ancestors")).split(";")[0] : "";
            boolean blocked = frame.contains("deny") || frame.contains("sameorigin") || (!ancestors.isEmpty() && !ancestors.contains("*"));
            return blocked
                ? result(true, false, "The site is reachable but forbids embedding (" + (frame.isEmpty() ? "CSP frame-ancestors" : "X-Frame-Options: " + frame) + "). Open it in a new tab instead.", status)
                : result(true, true, "Reachable and allows embedding", status);
        }
        return result(false, false, "Too many redirects", null);
    }
}
