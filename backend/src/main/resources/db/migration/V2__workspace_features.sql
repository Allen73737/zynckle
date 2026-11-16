CREATE TABLE invitation (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    email VARCHAR(320) NOT NULL,
    role VARCHAR(16) NOT NULL CHECK (role IN ('ADMIN','MEMBER','VIEWER')),
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    invited_by UUID NOT NULL REFERENCES app_user(id),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX invitation_workspace_created_idx ON invitation(workspace_id,created_at DESC);

CREATE TABLE task_comment (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    body VARCHAR(5000) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX task_comment_task_created_idx ON task_comment(task_id,created_at);

CREATE TABLE document_version (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    title VARCHAR(240) NOT NULL,
    content TEXT NOT NULL,
    edited_by UUID NOT NULL REFERENCES app_user(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_id,version_number)
);

CREATE TABLE folder (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES folder(id) ON DELETE CASCADE,
    name VARCHAR(180) NOT NULL,
    created_by UUID NOT NULL REFERENCES app_user(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX folder_workspace_parent_idx ON folder(workspace_id,parent_id);

CREATE TABLE stored_file (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES folder(id) ON DELETE SET NULL,
    name VARCHAR(180) NOT NULL,
    content_type VARCHAR(160) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    storage_key VARCHAR(512) NOT NULL UNIQUE,
    uploaded_by UUID NOT NULL REFERENCES app_user(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX stored_file_workspace_name_idx ON stored_file(workspace_id,name);

CREATE TABLE website_preview (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    project_id UUID REFERENCES project(id) ON DELETE SET NULL,
    title VARCHAR(120) NOT NULL,
    url TEXT NOT NULL,
    description VARCHAR(1000) DEFAULT '',
    created_by UUID NOT NULL REFERENCES app_user(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX website_preview_workspace_created_idx ON website_preview(workspace_id,created_at DESC);

CREATE TABLE activity_log (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id UUID,
    summary VARCHAR(500) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX activity_log_workspace_created_idx ON activity_log(workspace_id,created_at DESC);

CREATE TABLE ai_conversation (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    title VARCHAR(240) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ai_conversation_workspace_updated_idx ON ai_conversation(workspace_id,updated_at DESC);

CREATE TABLE ai_message (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL CHECK (role IN ('USER','ASSISTANT','SYSTEM')),
    content TEXT NOT NULL,
    model VARCHAR(120),
    usage_tokens INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ai_message_conversation_created_idx ON ai_message(conversation_id,created_at);
