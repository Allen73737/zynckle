-- Relational schema for the modules added to the platform. Mirrors the collections the
-- running Node API persists (backend/data/workspace.json) so the PostgreSQL foundation can
-- take over without reshaping data. Binary content always lives in object storage.

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS google_subject VARCHAR(64) UNIQUE;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS title VARCHAR(80);
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS bio VARCHAR(400);
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}';
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}';

CREATE TABLE user_session (
    id VARCHAR(32) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    user_agent VARCHAR(200),
    ip VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX user_session_user_idx ON user_session(user_id);

CREATE TABLE one_time_token (
    token_hash CHAR(64) PRIMARY KEY,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('reset','verify','oauth-state')),
    user_id UUID REFERENCES app_user(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

ALTER TABLE project ADD COLUMN IF NOT EXISTS tags VARCHAR(24)[] NOT NULL DEFAULT '{}';
ALTER TABLE project ADD COLUMN IF NOT EXISTS color VARCHAR(16) NOT NULL DEFAULT 'terra';
ALTER TABLE project ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS project_workspace_archived_idx ON project(workspace_id, archived);
ALTER TABLE task ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE task ADD COLUMN IF NOT EXISTS reminded_for DATE;
CREATE INDEX IF NOT EXISTS task_assignee_due_idx ON task(assignee_id, due_date);

CREATE TABLE doc_folder (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, name)
);
ALTER TABLE document ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES doc_folder(id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN IF NOT EXISTS visibility VARCHAR(12) NOT NULL DEFAULT 'WORKSPACE' CHECK (visibility IN ('WORKSPACE','PRIVATE'));
ALTER TABLE document ADD COLUMN IF NOT EXISTS yjs_state BYTEA;

CREATE TABLE document_collaborator (
    document_id UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, user_id)
);

CREATE TABLE document_comment (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    author_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
    body VARCHAR(4000) NOT NULL,
    quote VARCHAR(400) DEFAULT '',
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX document_comment_doc_idx ON document_comment(document_id, created_at);

CREATE TABLE file_share (
    file_id UUID NOT NULL REFERENCES stored_file(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    PRIMARY KEY (file_id, user_id)
);
ALTER TABLE stored_file ADD COLUMN IF NOT EXISTS visibility VARCHAR(12) NOT NULL DEFAULT 'WORKSPACE';
ALTER TABLE stored_file ADD COLUMN IF NOT EXISTS storage_driver VARCHAR(8) NOT NULL DEFAULT 'local';

CREATE TABLE code_project (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    project_id UUID REFERENCES project(id) ON DELETE SET NULL,
    owner_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(2000) DEFAULT '',
    visibility VARCHAR(12) NOT NULL DEFAULT 'WORKSPACE',
    repo_url VARCHAR(300),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX code_project_workspace_idx ON code_project(workspace_id, updated_at DESC);

CREATE TABLE code_file (
    id UUID PRIMARY KEY,
    code_project_id UUID NOT NULL REFERENCES code_project(id) ON DELETE CASCADE,
    path VARCHAR(400) NOT NULL,
    language VARCHAR(24),
    size_bytes INTEGER NOT NULL,
    is_binary BOOLEAN NOT NULL DEFAULT FALSE,
    storage_key VARCHAR(200) NOT NULL,
    storage_driver VARCHAR(8) NOT NULL DEFAULT 'local',
    updated_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (code_project_id, path)
);

CREATE TABLE code_file_version (
    id UUID PRIMARY KEY,
    code_file_id UUID NOT NULL REFERENCES code_file(id) ON DELETE CASCADE,
    storage_key VARCHAR(200) NOT NULL,
    size_bytes INTEGER NOT NULL,
    updated_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE website_preview ADD COLUMN IF NOT EXISTS description VARCHAR(1000) DEFAULT '';
ALTER TABLE website_preview ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'url';
ALTER TABLE website_preview ADD COLUMN IF NOT EXISTS code_project_id UUID REFERENCES code_project(id) ON DELETE CASCADE;
ALTER TABLE website_preview ADD COLUMN IF NOT EXISTS visibility VARCHAR(12) NOT NULL DEFAULT 'WORKSPACE';

ALTER TABLE notification ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspace(id) ON DELETE CASCADE;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS link VARCHAR(300);
ALTER TABLE notification ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES app_user(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notification_user_unread_idx ON notification(user_id, read_at, created_at DESC);

CREATE TABLE activity_log (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
    verb VARCHAR(80) NOT NULL,
    entity_type VARCHAR(24) NOT NULL,
    entity_id UUID,
    project_id UUID REFERENCES project(id) ON DELETE SET NULL,
    summary VARCHAR(200),
    is_audit BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX activity_workspace_created_idx ON activity_log(workspace_id, created_at DESC);
CREATE INDEX activity_project_created_idx ON activity_log(project_id, created_at DESC);

CREATE TABLE ai_conversation (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL,
    mode VARCHAR(16) NOT NULL,
    context JSONB NOT NULL DEFAULT '{}',
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ai_conversation_user_idx ON ai_conversation(user_id, updated_at DESC);

CREATE TABLE ai_message (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
    role VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    provider VARCHAR(24),
    model VARCHAR(100),
    sources JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ai_message_conversation_idx ON ai_message(conversation_id, created_at);

CREATE TABLE architecture_design (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    project_id UUID REFERENCES project(id) ON DELETE SET NULL,
    owner_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
    title VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sections JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_usage (
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    usage_day DATE NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, usage_day)
);
