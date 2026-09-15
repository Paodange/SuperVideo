CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    project_root TEXT NOT NULL UNIQUE,
    target_platform TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
);

CREATE TABLE assets (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    absolute_path TEXT NOT NULL,
    kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
    modified_at_ms INTEGER NOT NULL CHECK(modified_at_ms >= 0),
    content_fingerprint TEXT NOT NULL,
    source_type TEXT NOT NULL,
    license_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, absolute_path)
);

CREATE INDEX assets_project_created_idx ON assets(project_id, created_at_ms, id);

CREATE TABLE jobs (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'retrying', 'cancelling', 'cancelled', 'needs_attention')),
    progress REAL NOT NULL CHECK(progress >= 0.0 AND progress <= 1.0),
    stage TEXT,
    input_json TEXT NOT NULL,
    result_json TEXT,
    error_code TEXT,
    idempotency_key TEXT,
    attempt INTEGER NOT NULL CHECK(attempt >= 0),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0),
    started_at_ms INTEGER CHECK(started_at_ms IS NULL OR started_at_ms >= 0),
    finished_at_ms INTEGER CHECK(finished_at_ms IS NULL OR finished_at_ms >= 0),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX jobs_project_created_idx ON jobs(project_id, created_at_ms, id);
CREATE UNIQUE INDEX jobs_idempotency_idx ON jobs(project_id, job_type, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE messages (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence >= 1),
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool', 'system')),
    message_type TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, conversation_id, sequence)
);

CREATE INDEX messages_conversation_idx ON messages(project_id, conversation_id, sequence, id);

CREATE TABLE timeline_versions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK(version_number >= 1),
    parent_version_id TEXT,
    schema_version INTEGER NOT NULL CHECK(schema_version >= 1),
    timeline_json TEXT NOT NULL,
    edit_intent_json TEXT NOT NULL,
    diff_summary_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(parent_version_id) REFERENCES timeline_versions(id) ON DELETE CASCADE,
    UNIQUE(project_id, version_number)
);

CREATE INDEX timeline_versions_project_idx ON timeline_versions(project_id, version_number, id);

CREATE TRIGGER timeline_parent_same_project_insert
BEFORE INSERT ON timeline_versions
WHEN NEW.parent_version_id IS NOT NULL
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM timeline_versions
            WHERE id = NEW.parent_version_id AND project_id = NEW.project_id
        ) THEN RAISE(ABORT, 'timeline parent must belong to project')
    END;
END;

CREATE TRIGGER timeline_versions_immutable_update
BEFORE UPDATE ON timeline_versions
BEGIN
    SELECT RAISE(ABORT, 'timeline versions are immutable');
END;
