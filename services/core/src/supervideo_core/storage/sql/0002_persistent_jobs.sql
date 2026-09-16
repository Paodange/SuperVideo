ALTER TABLE jobs ADD COLUMN checkpoint_json TEXT;
ALTER TABLE jobs ADD COLUMN checkpoint_version INTEGER;
ALTER TABLE jobs ADD COLUMN executor_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE jobs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN last_event_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN cancel_requested_at_ms INTEGER;
ALTER TABLE jobs ADD COLUMN recovery_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE job_events (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence >= 1),
    event_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'retrying', 'cancelling', 'cancelled', 'needs_attention')),
    progress REAL NOT NULL CHECK(progress >= 0.0 AND progress <= 1.0),
    stage TEXT,
    attempt INTEGER NOT NULL CHECK(attempt >= 0),
    payload_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    UNIQUE(job_id, sequence)
);

CREATE INDEX job_events_project_created_idx ON job_events(project_id, created_at_ms, id);
CREATE INDEX job_events_job_sequence_idx ON job_events(job_id, sequence);

CREATE TRIGGER job_events_same_project_insert
BEFORE INSERT ON job_events
WHEN NOT EXISTS (SELECT 1 FROM jobs WHERE id = NEW.job_id AND project_id = NEW.project_id)
BEGIN
    SELECT RAISE(ABORT, 'job event must belong to job project');
END;
