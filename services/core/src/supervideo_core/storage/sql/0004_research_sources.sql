CREATE TABLE research_searches (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_digest TEXT NOT NULL CHECK(length(request_digest) = 64),
    result_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, request_id),
    UNIQUE(project_id, idempotency_key)
);

CREATE INDEX research_searches_project_created_idx ON research_searches(project_id, created_at_ms, id);

CREATE TABLE source_records (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    site_name TEXT,
    author TEXT,
    fetched_at_ms INTEGER NOT NULL CHECK(fetched_at_ms >= 0),
    content_digest TEXT NOT NULL CHECK(length(content_digest) = 64),
    source_digest TEXT NOT NULL CHECK(length(source_digest) = 64),
    evidence_json TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, source_digest),
    UNIQUE(project_id, idempotency_key)
);

CREATE INDEX source_records_project_created_idx ON source_records(project_id, created_at_ms, id);
CREATE INDEX source_records_project_url_idx ON source_records(project_id, url, created_at_ms, id);

CREATE TRIGGER research_searches_immutable_update
BEFORE UPDATE ON research_searches
BEGIN
    SELECT RAISE(ABORT, 'research searches are immutable');
END;

CREATE TRIGGER source_records_immutable_update
BEFORE UPDATE ON source_records
BEGIN
    SELECT RAISE(ABORT, 'source records are immutable');
END;
