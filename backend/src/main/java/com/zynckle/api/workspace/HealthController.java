package com.zynckle.api.workspace;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;

@RestController
public class HealthController {
    @GetMapping("/api/health")
    public Map<String, Object> health() {
        return Map.of(
            "status", "ok",
            "service", "zynckle-api",
            "runtime", "Java 17 (OpenJDK)",
            "framework", "Spring Boot 3.4.1 Enterprise",
            "persistence", "embedded-h2-postgresql",
            "storage", "local",
            "ai", true,
            "realtime", true
        );
    }
}
