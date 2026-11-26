package com.zynckle.api.common;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Objects;

/** Browsers report uncaught errors here (public, rate-limited, size-limited, never echoed back). */
@RestController
public class ClientErrorController {
    private final ErrorReporter reporter;
    private final RateLimiter limiter;

    public ClientErrorController(ErrorReporter reporter, RateLimiter limiter) {
        this.reporter = reporter;
        this.limiter = limiter;
    }

    @PostMapping("/api/client-errors")
    public Map<String, Object> report(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        limiter.check("client-error:" + request.getRemoteAddr(), 20, 60_000);
        String message = clean(body.get("message"), 500);
        if (message.isBlank()) throw new ApiException(400, "message is required");
        reporter.client(message, clean(body.get("source"), 300), clean(body.get("page"), 200), clean(request.getHeader("User-Agent"), 200));
        return Map.of("ok", true);
    }

    /** Single line, printable, bounded: the text ends up in logs and chat alerts. */
    private static String clean(Object value, int max) {
        String s = Objects.toString(value, "").replaceAll("[\\p{Cntrl}]+", " ").trim();
        return ErrorReporter.truncate(s, max);
    }
}
