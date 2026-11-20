package com.zynckle.api.storage;

import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api")
public class StorageController {

    @GetMapping("/storage/usage")
    public Map<String, Object> storageUsage() {
        return Map.of(
            "usedBytes", 24500000L,
            "quotaBytes", 1073741824L,
            "driver", "h2-postgresql",
            "percentUsed", 2.3
        );
    }

    @GetMapping("/files")
    public List<Map<String, Object>> listFiles() {
        return List.of(
            Map.of(
                "id", "file-spec",
                "name", "zynckle-architecture-diagram.svg",
                "contentType", "image/svg+xml",
                "sizeBytes", 48200L,
                "createdAt", new Date().toString()
            ),
            Map.of(
                "id", "file-manifesto",
                "name", "design-system-spec.pdf",
                "contentType", "application/pdf",
                "sizeBytes", 185000L,
                "createdAt", new Date().toString()
            )
        );
    }
}
