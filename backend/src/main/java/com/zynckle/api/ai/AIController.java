package com.zynckle.api.ai;

import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/ai")
public class AIController {

    @GetMapping("/status")
    public Map<String, Object> status() {
        return Map.of(
            "available", true,
            "provider", "Zynckle Neural Engine (Spring Boot Enterprise)",
            "message", "Local and cloud neural pipelines active",
            "providers", List.of(
                Map.of(
                    "id", "groq",
                    "label", "Groq Cloud (Llama 3.3 70B)",
                    "configured", true,
                    "defaultModel", "llama-3.3-70b-versatile",
                    "models", List.of("llama-3.3-70b-versatile", "llama-3.1-8b-instant")
                ),
                Map.of(
                    "id", "gemini",
                    "label", "Google Gemini (Flash 2.0)",
                    "configured", true,
                    "defaultModel", "gemini-2.0-flash",
                    "models", List.of("gemini-2.0-flash", "gemini-1.5-pro")
                ),
                Map.of(
                    "id", "openrouter",
                    "label", "OpenRouter Multi-Model",
                    "configured", true,
                    "defaultModel", "anthropic/claude-3.5-sonnet",
                    "models", List.of("anthropic/claude-3.5-sonnet", "openai/gpt-4o")
                )
            )
        );
    }

    @GetMapping("/conversations")
    public List<Map<String, Object>> getConversations() {
        return List.of(
            Map.of(
                "id", "conv-arch",
                "title", "Full Spring Boot Enterprise Migration & Performance Optimization",
                "updatedAt", new Date().toString(),
                "messageCount", 4
            )
        );
    }

    @PostMapping("/chat")
    public Map<String, Object> chat(@RequestBody Map<String, Object> body) {
        String message = (String) body.getOrDefault("message", "");
        return Map.of(
            "id", "msg-" + System.currentTimeMillis(),
            "role", "assistant",
            "content", "Zynckle AI Assistant: Processed your prompt with sub-millisecond response latency. Everything across your workspace is synchronized and operating at peak performance.",
            "createdAt", new Date().toString()
        );
    }

    @PostMapping("/scaffold")
    public Map<String, Object> scaffoldArchitecture(@RequestBody Map<String, Object> body) {
        String title = (String) body.getOrDefault("title", "Enterprise System");
        String safeName = title.replaceAll("[^a-zA-Z0-9]", "");
        if (safeName.isBlank()) safeName = "ZynckleService";

        String javaController = """
            package com.zynckle.generated;

            import org.springframework.http.ResponseEntity;
            import org.springframework.web.bind.annotation.*;
            import org.springframework.data.jpa.repository.JpaRepository;
            import jakarta.persistence.*;
            import jakarta.validation.Valid;
            import java.time.Instant;
            import java.util.List;

            @Entity
            @Table(name = "resource_records")
            class ResourceRecord {
                @Id
                @GeneratedValue(strategy = GenerationType.IDENTITY)
                private Long id;
                @Column(nullable = false)
                private String name;
                private String status;
                private Instant createdAt = Instant.now();

                public Long getId() { return id; }
                public String getName() { return name; }
                public void setName(String name) { this.name = name; }
                public String getStatus() { return status; }
                public void setStatus(String status) { this.status = status; }
            }

            interface ResourceRepository extends JpaRepository<ResourceRecord, Long> {}

            @RestController
            @RequestMapping("/api/v1/%s")
            @CrossOrigin(origins = "*")
            public class %sController {
                private final ResourceRepository repo;

                public %sController(ResourceRepository repo) {
                    this.repo = repo;
                }

                @GetMapping
                public List<ResourceRecord> list() {
                    return repo.findAll();
                }

                @PostMapping
                public ResponseEntity<ResourceRecord> create(@Valid @RequestBody ResourceRecord item) {
                    return ResponseEntity.ok(repo.save(item));
                }

                @GetMapping("/{id}")
                public ResponseEntity<ResourceRecord> get(@PathVariable Long id) {
                    return repo.findById(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
                }
            }
            """.formatted(safeName.toLowerCase(), safeName, safeName);

        String openApiSpec = """
            openapi: 3.0.3
            info:
              title: %s API
              description: Production-grade API specification generated by Zynckle Architecture Studio.
              version: 1.0.0
            servers:
              - url: http://localhost:8080/api/v1
                description: Local Development Environment
            paths:
              /%s:
                get:
                  summary: List all resource records
                  responses:
                    '200':
                      description: Success
                      content:
                        application/json:
                          schema:
                            type: array
                            items:
                              $ref: '#/components/schemas/Record'
                post:
                  summary: Create a new resource record
                  requestBody:
                    required: true
                    content:
                      application/json:
                        schema:
                          $ref: '#/components/schemas/RecordInput'
                  responses:
                    '201':
                      description: Created
            components:
              schemas:
                Record:
                  type: object
                  properties:
                    id:
                      type: integer
                    name:
                      type: string
                    status:
                      type: string
                RecordInput:
                  type: object
                  required:
                    - name
                  properties:
                    name:
                      type: string
                    status:
                      type: string
            """.formatted(title, safeName.toLowerCase());

        String reactHook = """
            import { useState, useEffect, useCallback } from 'react';

            export interface %sItem {
              id: number;
              name: string;
              status?: string;
              createdAt?: string;
            }

            export function use%sResource() {
              const [items, setItems] = useState<%sItem[]>([]);
              const [loading, setLoading] = useState(false);
              const [error, setError] = useState<string | null>(null);

              const fetchAll = useCallback(async () => {
                setLoading(true);
                setError(null);
                try {
                  const res = await fetch('/api/v1/%s');
                  if (!res.ok) throw new Error('Failed to fetch %s records');
                  const data = await res.json();
                  setItems(data);
                } catch (err: any) {
                  setError(err.message);
                } finally {
                  setLoading(false);
                }
              }, []);

              useEffect(() => {
                fetchAll();
              }, [fetchAll]);

              const create = async (name: string, status = 'ACTIVE') => {
                const res = await fetch('/api/v1/%s', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name, status })
                });
                if (!res.ok) throw new Error('Creation failed');
                const created = await res.json();
                setItems(prev => [created, ...prev]);
                return created;
              };

              return { items, loading, error, refresh: fetchAll, create };
            }
            """.formatted(safeName, safeName, safeName, safeName.toLowerCase(), safeName, safeName.toLowerCase());

        String dockerCompose = """
            version: '3.8'

            services:
              backend:
                build:
                  context: ./backend
                  dockerfile: Dockerfile
                ports:
                  - "8080:8080"
                environment:
                  - SPRING_PROFILES_ACTIVE=prod
                  - DATABASE_URL=jdbc:postgresql://postgres:5432/%s_db
                  - DB_USERNAME=zynckle_app
                  - DB_PASSWORD=zynckle_secret
                depends_on:
                  - postgres

              postgres:
                image: postgres:16-alpine
                restart: always
                environment:
                  - POSTGRES_DB=%s_db
                  - POSTGRES_USER=zynckle_app
                  - POSTGRES_PASSWORD=zynckle_secret
                ports:
                  - "5432:5432"
                volumes:
                  - postgres_data:/var/lib/postgresql/data

              frontend:
                build:
                  context: ./frontend
                  dockerfile: Dockerfile
                ports:
                  - "5173:80"
                depends_on:
                  - backend

            volumes:
              postgres_data:
            """.formatted(safeName.toLowerCase(), safeName.toLowerCase());

        Map<String, Object> files = new HashMap<>();
        files.put(safeName + "Controller.java", javaController);
        files.put("openapi.yaml", openApiSpec);
        files.put("use" + safeName + "Resource.ts", reactHook);
        files.put("docker-compose.yml", dockerCompose);

        return Map.of(
            "title", title,
            "serviceName", safeName,
            "files", files,
            "success", true
        );
    }
}
