package com.zynckle.api.storage;

import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Tables for Drive and code projects. Binary content lives in {@link BlobStore}. */
@Component
public class StorageSchema {
    private final JdbcTemplate jdbc;

    public StorageSchema(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @PostConstruct
    void create() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS drive_folder (
                id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) NOT NULL, parent_id VARCHAR(64),
                name VARCHAR(80) NOT NULL, owner_id VARCHAR(64), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""");
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS drive_file (
                id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) NOT NULL, folder_id VARCHAR(64), owner_id VARCHAR(64) NOT NULL,
                name VARCHAR(180) NOT NULL, mime_type VARCHAR(160) NOT NULL, size_bytes BIGINT NOT NULL, storage_key VARCHAR(200) NOT NULL,
                visibility VARCHAR(16) DEFAULT 'workspace', shared_with VARCHAR(4000) DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""");
        jdbc.execute("CREATE INDEX IF NOT EXISTS drive_file_ws_idx ON drive_file(workspace_id, folder_id)");
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS code_project (
                id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) NOT NULL, owner_id VARCHAR(64) NOT NULL, name VARCHAR(100) NOT NULL,
                description VARCHAR(2000) DEFAULT '', project_id VARCHAR(64), repo_url VARCHAR(300) DEFAULT '', branch VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""");
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS code_file (
                id VARCHAR(64) PRIMARY KEY, code_project_id VARCHAR(64) NOT NULL, workspace_id VARCHAR(64) NOT NULL, path VARCHAR(500) NOT NULL,
                language VARCHAR(40), size_bytes BIGINT NOT NULL, is_binary BOOLEAN DEFAULT FALSE, storage_key VARCHAR(200) NOT NULL,
                updated_by VARCHAR(64), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""");
        jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS code_file_path_idx ON code_file(code_project_id, path)");
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS code_file_version (
                id VARCHAR(64) PRIMARY KEY, code_file_id VARCHAR(64) NOT NULL, storage_key VARCHAR(200) NOT NULL, size_bytes BIGINT NOT NULL,
                updated_by VARCHAR(64), updated_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""");
        jdbc.execute("CREATE INDEX IF NOT EXISTS code_file_version_idx ON code_file_version(code_file_id, created_at)");
    }
}
