package com.zynckle.api.config;

import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class DatabaseInitializer implements CommandLineRunner {
    private final JdbcTemplate jdbc;

    public DatabaseInitializer(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(String... args) {
        // Create base tables if they don't exist
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS app_user (
                id VARCHAR(64) PRIMARY KEY,
                email VARCHAR(320) NOT NULL UNIQUE,
                password_hash VARCHAR(100) NOT NULL,
                display_name VARCHAR(100) NOT NULL,
                title VARCHAR(80) DEFAULT '',
                bio VARCHAR(400) DEFAULT '',
                email_verified BOOLEAN DEFAULT TRUE,
                role VARCHAR(16) DEFAULT 'OWNER',
                preferences VARCHAR(2000) DEFAULT '{"theme":"dark"}',
                notification_prefs VARCHAR(2000) DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """);

        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS workspace (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(120) NOT NULL,
                description VARCHAR(400) DEFAULT '',
                owner_id VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """);

        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS workspace_member (
                workspace_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NOT NULL,
                role VARCHAR(16) NOT NULL,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (workspace_id, user_id)
            )
        """);

        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS project (
                id VARCHAR(64) PRIMARY KEY,
                workspace_id VARCHAR(64) NOT NULL,
                name VARCHAR(160) NOT NULL,
                description VARCHAR(2000) DEFAULT '',
                status VARCHAR(24) DEFAULT 'In Progress',
                due_date VARCHAR(64) DEFAULT 'Not set',
                created_by VARCHAR(64),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """);

        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS task (
                id VARCHAR(64) PRIMARY KEY,
                project_id VARCHAR(64) NOT NULL,
                title VARCHAR(240) NOT NULL,
                description VARCHAR(4000) DEFAULT '',
                status VARCHAR(24) DEFAULT 'In Progress',
                priority VARCHAR(16) DEFAULT 'Normal',
                assignee_id VARCHAR(64),
                due_date VARCHAR(64) DEFAULT 'No date',
                done BOOLEAN DEFAULT FALSE,
                position INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """);

        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS task_comment (
                id VARCHAR(64) PRIMARY KEY,
                task_id VARCHAR(64) NOT NULL,
                author_id VARCHAR(64),
                author_name VARCHAR(100) DEFAULT 'Team Member',
                body VARCHAR(5000) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """);

        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS document (
                id VARCHAR(64) PRIMARY KEY,
                workspace_id VARCHAR(64) NOT NULL,
                title VARCHAR(240) NOT NULL,
                content CLOB,
                type VARCHAR(32) DEFAULT 'rich-text',
                owner_id VARCHAR(64),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """);

        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS website_preview (
                id VARCHAR(64) PRIMARY KEY,
                workspace_id VARCHAR(64) NOT NULL,
                title VARCHAR(120) NOT NULL,
                url VARCHAR(2000) NOT NULL,
                description VARCHAR(1000) DEFAULT '',
                kind VARCHAR(32) DEFAULT 'url',
                owner_id VARCHAR(64),
                owner_name VARCHAR(100) DEFAULT 'Studio Lead',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """);

        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS notification (
                id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                kind VARCHAR(32) NOT NULL,
                title VARCHAR(240) NOT NULL,
                body VARCHAR(4000) DEFAULT '',
                read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """);

        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS activity_log (
                id VARCHAR(64) PRIMARY KEY,
                workspace_id VARCHAR(64) NOT NULL,
                actor_id VARCHAR(64),
                actor_name VARCHAR(100) DEFAULT 'Studio Lead',
                actor_avatar VARCHAR(10) DEFAULT 'SL',
                verb VARCHAR(80) NOT NULL,
                entity_type VARCHAR(40) NOT NULL,
                summary VARCHAR(500) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """);

        // Seed default demo user and workspace if table is empty
        Integer userCount = jdbc.queryForObject("SELECT COUNT(*) FROM app_user", Integer.class);
        if (userCount == null || userCount == 0) {
            String defaultUserId = "usr-local";
            String defaultWorkspaceId = "ws-local";

            jdbc.update("""
                INSERT INTO app_user (id, email, password_hash, display_name, title, bio, role)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, defaultUserId, "lead@zynckle.local", "$2a$10$e8V9...demo", "Studio Lead", "Product Architect", "Building next-generation design systems", "OWNER");

            jdbc.update("""
                INSERT INTO workspace (id, name, description, owner_id)
                VALUES (?, ?, ?, ?)
            """, defaultWorkspaceId, "Zynckle Studio", "Primary design & development workspace", defaultUserId);

            jdbc.update("""
                INSERT INTO workspace_member (workspace_id, user_id, role)
                VALUES (?, ?, ?)
            """, defaultWorkspaceId, defaultUserId, "OWNER");

            // Seed default projects
            String p1 = "p-1";
            String p2 = "p-2";
            jdbc.update("""
                INSERT INTO project (id, workspace_id, name, description, status, due_date, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, p1, defaultWorkspaceId, "Zynckle Core Studio", "Unified workspace suite architecture and design system implementation", "In Progress", "Nov 28", defaultUserId);

            jdbc.update("""
                INSERT INTO project (id, workspace_id, name, description, status, due_date, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, p2, defaultWorkspaceId, "Hyper-Speed Compiler & Previews", "Integrated real-time LaTeX compilation and responsive viewport matrix", "Planning", "Dec 05", defaultUserId);

            // Seed default tasks
            jdbc.update("""
                INSERT INTO task (id, project_id, title, description, status, priority, due_date, done, assignee_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, "t-1", p1, "Inline expandable side-drawer with fluid spring transitions", "Refine navigation UX with pure monochrome palette and zero layout shift", "Done", "High", "Today", true, defaultUserId);

            jdbc.update("""
                INSERT INTO task (id, project_id, title, description, status, priority, due_date, done, assignee_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, "t-2", p1, "Spring Boot enterprise persistence layer migration", "Full entity, repository, and controller parity with embedded H2/PostgreSQL engine", "In Progress", "High", "Tomorrow", false, defaultUserId);

            jdbc.update("""
                INSERT INTO task (id, project_id, title, description, status, priority, due_date, done, assignee_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, "t-3", p2, "Live PDF preview expand into full window mode", "Enable ultra-fast real-time rendering and multi-page inspection in LaTeX studio", "Done", "Normal", "Nov 25", true, defaultUserId);

            // Seed initial activity
            jdbc.update("""
                INSERT INTO activity_log (id, workspace_id, actor_id, actor_name, actor_avatar, verb, entity_type, summary)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, "act-1", defaultWorkspaceId, defaultUserId, "Studio Lead", "SL", "completed task", "task", "Inline expandable side-drawer with fluid spring transitions");

            jdbc.update("""
                INSERT INTO activity_log (id, workspace_id, actor_id, actor_name, actor_avatar, verb, entity_type, summary)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, "act-2", defaultWorkspaceId, defaultUserId, "Sarah Chen", "SC", "published document", "document", "Zynckle Architecture & System Design");

            // Seed initial document
            jdbc.update("""
                INSERT INTO document (id, workspace_id, title, content, type, owner_id)
                VALUES (?, ?, ?, ?, ?, ?)
            """, "doc-system", defaultWorkspaceId, "Zynckle Architecture & Engineering Manifesto",
                "\\documentclass[11pt,a4paper]{article}\n\\title{\\textbf{Zynckle Platform Specification}}\n\\author{Zynckle Engineering Team}\n\\date{\\today}\n\\begin{document}\n\\maketitle\n\\section{Introduction}\nZynckle is a high-performance, unified workspace combining design systems, responsive website previews, LaTeX authoring, task management, and neural AI assistance.\n\\end{document}",
                "latex", defaultUserId);

            // Seed initial website preview
            jdbc.update("""
                INSERT INTO website_preview (id, workspace_id, title, url, description, kind, owner_id, owner_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, "prev-1", defaultWorkspaceId, "Zynckle Production Portal", "https://zynckle.local", "Real-time production preview", "url", defaultUserId, "Studio Lead");
        }
    }
}
