-- Baseline of the schema the Spring Boot API actually uses.
--
-- Until now these tables were created by Java code at startup (DatabaseInitializer and
-- @PostConstruct methods), and the old V1–V3 files described a different, Node-era schema.
-- This file replaces both: it is now the single source of truth for the schema.
--
-- Every statement is idempotent (IF NOT EXISTS), so it is safe on:
--   * a new database (creates everything),
--   * an existing database created by the old Java code (Flyway baselines it at version 0,
--     then this file only adds what is missing),
--   * H2 in PostgreSQL mode (local development) and PostgreSQL (production).
--
-- Future schema changes go in new files: V5__<description>.sql, V6__..., never edits to this one.

-- from config/DatabaseInitializer.java
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
);

CREATE TABLE IF NOT EXISTS workspace (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(400) DEFAULT '',
    owner_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_member (
    workspace_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    role VARCHAR(16) NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, user_id)
);

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
);

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
);

CREATE TABLE IF NOT EXISTS task_comment (
    id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(64) NOT NULL,
    author_id VARCHAR(64),
    author_name VARCHAR(100) DEFAULT 'Team Member',
    body VARCHAR(5000) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document (
    id VARCHAR(64) PRIMARY KEY,
    workspace_id VARCHAR(64) NOT NULL,
    title VARCHAR(240) NOT NULL,
    content TEXT,
    type VARCHAR(32) DEFAULT 'rich-text',
    owner_id VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS notification (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    title VARCHAR(240) NOT NULL,
    body VARCHAR(4000) DEFAULT '',
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
);

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS active_workspace_id VARCHAR(64);

CREATE TABLE IF NOT EXISTS user_session (
    id VARCHAR(32) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    user_agent VARCHAR(200),
    ip VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS user_session_user_idx ON user_session(user_id);

CREATE TABLE IF NOT EXISTS one_time_token (
    token_hash CHAR(64) PRIMARY KEY,
    kind VARCHAR(16) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS invitation (
    id VARCHAR(64) PRIMARY KEY,
    workspace_id VARCHAR(64) NOT NULL,
    email VARCHAR(320) NOT NULL,
    role VARCHAR(16) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    invite_url VARCHAR(200) NOT NULL,
    invited_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS audit BOOLEAN DEFAULT FALSE;

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS project_id VARCHAR(64);

ALTER TABLE notification ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64);

ALTER TABLE notification ADD COLUMN IF NOT EXISTS link VARCHAR(500);

ALTER TABLE task ADD COLUMN IF NOT EXISTS created_by VARCHAR(64);

-- from storage/StorageSchema.java
CREATE TABLE IF NOT EXISTS drive_folder (
    id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) NOT NULL, parent_id VARCHAR(64),
    name VARCHAR(80) NOT NULL, owner_id VARCHAR(64), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS drive_file (
    id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) NOT NULL, folder_id VARCHAR(64), owner_id VARCHAR(64) NOT NULL,
    name VARCHAR(180) NOT NULL, mime_type VARCHAR(160) NOT NULL, size_bytes BIGINT NOT NULL, storage_key VARCHAR(200) NOT NULL,
    visibility VARCHAR(16) DEFAULT 'workspace', shared_with VARCHAR(4000) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS drive_file_ws_idx ON drive_file(workspace_id, folder_id);

CREATE TABLE IF NOT EXISTS code_project (
    id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) NOT NULL, owner_id VARCHAR(64) NOT NULL, name VARCHAR(100) NOT NULL,
    description VARCHAR(2000) DEFAULT '', project_id VARCHAR(64), repo_url VARCHAR(300) DEFAULT '', branch VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS code_file (
    id VARCHAR(64) PRIMARY KEY, code_project_id VARCHAR(64) NOT NULL, workspace_id VARCHAR(64) NOT NULL, path VARCHAR(500) NOT NULL,
    language VARCHAR(40), size_bytes BIGINT NOT NULL, is_binary BOOLEAN DEFAULT FALSE, storage_key VARCHAR(200) NOT NULL,
    updated_by VARCHAR(64), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

CREATE UNIQUE INDEX IF NOT EXISTS code_file_path_idx ON code_file(code_project_id, path);

CREATE TABLE IF NOT EXISTS code_file_version (
    id VARCHAR(64) PRIMARY KEY, code_file_id VARCHAR(64) NOT NULL, storage_key VARCHAR(200) NOT NULL, size_bytes BIGINT NOT NULL,
    updated_by VARCHAR(64), updated_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS code_file_version_idx ON code_file_version(code_file_id, created_at);

-- from document/DocumentsController.java
ALTER TABLE document ADD COLUMN IF NOT EXISTS folder_id VARCHAR(64);

ALTER TABLE document ADD COLUMN IF NOT EXISTS project_id VARCHAR(64);

ALTER TABLE document ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) DEFAULT 'workspace';

ALTER TABLE document ADD COLUMN IF NOT EXISTS collaborator_ids VARCHAR(4000) DEFAULT '';

ALTER TABLE document ADD COLUMN IF NOT EXISTS updated_by VARCHAR(64);

CREATE TABLE IF NOT EXISTS doc_version (
    id VARCHAR(64) PRIMARY KEY, document_id VARCHAR(64) NOT NULL, number INT NOT NULL, title VARCHAR(240) NOT NULL,
    content TEXT, created_by VARCHAR(64), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS doc_version_doc_idx ON doc_version(document_id, number);

CREATE TABLE IF NOT EXISTS doc_folder (
    id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) NOT NULL, name VARCHAR(80) NOT NULL,
    owner_id VARCHAR(64), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS doc_comment (
    id VARCHAR(64) PRIMARY KEY, document_id VARCHAR(64) NOT NULL, author_id VARCHAR(64) NOT NULL, body VARCHAR(4000) NOT NULL,
    quote VARCHAR(400) DEFAULT '', resolved BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS doc_comment_doc_idx ON doc_comment(document_id, created_at);

-- from task/TaskFeatures.java
ALTER TABLE task ADD COLUMN IF NOT EXISTS recurrence VARCHAR(16);

ALTER TABLE task ADD COLUMN IF NOT EXISTS reminded_for VARCHAR(10);

-- from ai/ConversationRepository.java
CREATE TABLE IF NOT EXISTS ai_chat (
    id VARCHAR(64) PRIMARY KEY,
    workspace_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    title VARCHAR(240) NOT NULL,
    mode VARCHAR(24) DEFAULT 'general',
    context_json VARCHAR(4000) DEFAULT '{}',
    pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_chat_message (
    id VARCHAR(64) PRIMARY KEY,
    chat_id VARCHAR(64) NOT NULL,
    seq INT NOT NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    provider VARCHAR(120),
    model VARCHAR(160),
    sources_json TEXT,
    retrieval_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ai_chat_message ADD COLUMN IF NOT EXISTS feedback INT DEFAULT 0;

ALTER TABLE ai_chat_message ADD COLUMN IF NOT EXISTS feedback_note VARCHAR(1000);

CREATE INDEX IF NOT EXISTS ai_chat_user_idx ON ai_chat(workspace_id, user_id, updated_at);

CREATE INDEX IF NOT EXISTS ai_chat_message_chat_idx ON ai_chat_message(chat_id, seq);

-- from ai/ArchitectureController.java
CREATE TABLE IF NOT EXISTS ai_architecture (
    id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) NOT NULL, owner_id VARCHAR(64) NOT NULL, title VARCHAR(120) NOT NULL,
    description VARCHAR(8000) DEFAULT '', project_id VARCHAR(64), sections_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

-- from integration/IntegrationsController.java
CREATE TABLE IF NOT EXISTS workspace_integration (
    workspace_id VARCHAR(64) NOT NULL, kind VARCHAR(24) NOT NULL, config VARCHAR(1000) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (workspace_id, kind));

-- from share/ShareController.java
CREATE TABLE IF NOT EXISTS share_link (
    id VARCHAR(64) PRIMARY KEY, token_hash CHAR(64) NOT NULL UNIQUE, workspace_id VARCHAR(64) NOT NULL, document_id VARCHAR(64) NOT NULL,
    created_by VARCHAR(64) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP, views INT DEFAULT 0);

-- from auth/AuthController.java
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS google_subject VARCHAR(64);
