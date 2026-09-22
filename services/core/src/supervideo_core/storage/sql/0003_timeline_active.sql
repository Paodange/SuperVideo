ALTER TABLE timeline_versions ADD COLUMN source_type_v3 TEXT NOT NULL DEFAULT 'root' CHECK(source_type_v3 IN ('root', 'edit'));
ALTER TABLE timeline_versions ADD COLUMN timeline_id TEXT NOT NULL DEFAULT '';
ALTER TABLE timeline_versions ADD COLUMN source_version_id TEXT;
ALTER TABLE timeline_versions ADD COLUMN determinism_digest TEXT;
ALTER TABLE timeline_versions ADD COLUMN idempotency_key TEXT;

UPDATE timeline_versions SET source_type_v3 = CASE
    WHEN parent_version_id IS NULL THEN 'root'
    ELSE 'edit'
END;

CREATE TABLE timeline_active (
    project_id TEXT PRIMARY KEY NOT NULL,
    active_version_id TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL DEFAULT 0 CHECK(updated_at_ms >= 0),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(active_version_id) REFERENCES timeline_versions(id) ON DELETE RESTRICT
);

CREATE INDEX timeline_active_version_idx ON timeline_active(active_version_id);
CREATE INDEX timeline_versions_timeline_idx ON timeline_versions(project_id, timeline_id, version_number, id);
CREATE UNIQUE INDEX timeline_versions_idempotency_idx ON timeline_versions(project_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER timeline_source_same_project_insert
BEFORE INSERT ON timeline_versions
WHEN NEW.source_version_id IS NOT NULL
 AND NOT EXISTS (
    SELECT 1 FROM timeline_versions
    WHERE id = NEW.source_version_id AND project_id = NEW.project_id
 )
BEGIN
    SELECT RAISE(ABORT, 'timeline source must belong to project');
END;

CREATE TRIGGER timeline_active_same_project_insert
BEFORE INSERT ON timeline_active
WHEN NOT EXISTS (
    SELECT 1 FROM timeline_versions
    WHERE id = NEW.active_version_id AND project_id = NEW.project_id
)
BEGIN
    SELECT RAISE(ABORT, 'active timeline must belong to project');
END;

CREATE TRIGGER timeline_active_same_project_update
BEFORE UPDATE OF active_version_id, project_id ON timeline_active
WHEN NOT EXISTS (
    SELECT 1 FROM timeline_versions
    WHERE id = NEW.active_version_id AND project_id = NEW.project_id
)
BEGIN
    SELECT RAISE(ABORT, 'active timeline must belong to project');
END;

CREATE TRIGGER timeline_active_immutable_project
BEFORE UPDATE OF project_id ON timeline_active
BEGIN
    SELECT RAISE(ABORT, 'active timeline project is immutable');
END;
