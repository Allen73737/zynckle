-- Fields the Previews screen already used: a linked project, code-project sites, and private sharing.
ALTER TABLE website_preview ADD COLUMN IF NOT EXISTS project_id VARCHAR(64);
ALTER TABLE website_preview ADD COLUMN IF NOT EXISTS code_project_id VARCHAR(64);
ALTER TABLE website_preview ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) DEFAULT 'workspace';
ALTER TABLE website_preview ADD COLUMN IF NOT EXISTS shared_with VARCHAR(4000) DEFAULT '';
-- Older rows stored code-project sites as plain URLs pointing at /code/<id>.
UPDATE website_preview SET kind = 'code-site', code_project_id = SUBSTRING(url, POSITION('/code/' IN url) + 6)
  WHERE kind <> 'code-site' AND url LIKE '%/code/%' AND code_project_id IS NULL
    AND SUBSTRING(url, POSITION('/code/' IN url) + 6) IN (SELECT id FROM code_project WHERE workspace_id = website_preview.workspace_id);
