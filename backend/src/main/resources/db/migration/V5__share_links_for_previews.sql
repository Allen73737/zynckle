-- Public share links can point at a website preview as well as a document.
-- Exactly one of document_id / preview_id is set on each row.
ALTER TABLE share_link ADD COLUMN IF NOT EXISTS preview_id VARCHAR(64);
ALTER TABLE share_link ALTER COLUMN document_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS share_link_document_idx ON share_link(document_id);
CREATE INDEX IF NOT EXISTS share_link_preview_idx ON share_link(preview_id);
