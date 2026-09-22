# A05 SQLite storage

SuperVideo uses one SQLite database per project. The trusted project layer
creates a project directory and its manifest in A06; the storage module opens
only the fixed database path supplied by that layer and applies the bundled
schema:

```text
<project-root>/
├─ project.supervideo.json   # A06
└─ data/
   └─ project.db             # A05 SQLite database
```

The storage module does not choose a current working directory, use a user
home directory, create a project, scan media, or expose a database path through
Agent/Renderer RPC. Original media remains an external, read-only reference.

## Connection and transactions

`supervideo_core.storage.Database` owns one `sqlite3` connection and one
thread. Every connection verifies these settings before it is made available:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

The connection uses explicit autocommit mode and repositories wrap writes in
`BEGIN IMMEDIATE`. Repositories can be composed inside an outer
`database.transaction()`; the outermost caller owns commit and rollback. The
connection is not shared between threads and repositories never return a
cursor or hold an unbounded cursor open.

`Database.integrity_report()` (also available as `check_integrity()` and
`diagnostics()`) runs `quick_check`, `integrity_check`, and
`foreign_key_check`. It returns a structured summary and never repairs or
deletes data. SQLite failures are mapped to stable `StorageError` codes such
as `DATABASE_BUSY`, `DATABASE_READ_ONLY`, and `DATABASE_CORRUPT`; public error
messages do not contain SQL, paths, or raw exception text.

## Migrations

Migration files live in `supervideo_core/storage/sql` and are included as
Python package data. Names use a fixed four-digit version and a source-level
name, for example `0001_initial.sql`. The runner normalizes CRLF and LF to LF
before calculating a SHA-256 checksum. It rejects missing or duplicate
versions, out-of-order registrations, changed names or checksums, and a
database version newer than the supported version.

The `schema_migrations` table stores `version`, `name`, `checksum`, and
`applied_at_ms`. The metadata table, each migration's SQL statements, and its
record are applied in one `BEGIN IMMEDIATE` transaction. SQL statements are
executed individually rather than with `sqlite3.executescript()`, whose
implicit commit behavior would undermine rollback. A failed migration rolls
back the complete transaction, including the metadata table on a fresh
database. Reopening a current database is a no-op.

Historical migrations are immutable. A schema change must add a new higher
numbered migration and update `DATABASE_SCHEMA_VERSION`; it must not edit an
already-applied SQL file.

## Initial schema

The first migration creates these tables and fixed indexes:

- `projects` stores project identity, normalized absolute project root,
  target platform, non-secret JSON configuration, timestamps, and a revision.
  Project roots are unique.
- `assets` stores external asset metadata only. A project/path pair is unique,
  `size_bytes` cannot be negative, and `project_id` is a cascading foreign
  key. A05 does not inspect, fingerprint, copy, move, rename, or delete a
  media file.
- `jobs` is the durable record used by A07. A05 supplies the base row and A07's
  `0002_persistent_jobs.sql` adds checkpoint/version, compare-and-swap revision,
  event sequence, cancellation and recovery fields. A07 adds the controlled
  state transitions, retries, events, checkpoints and scheduling.
- `job_events` is append-only audit history. Each event is scoped to its project
  and job, has a unique per-job sequence, bounded JSON payload and indexes for
  project-time and job-sequence queries.
- `messages` is append-oriented conversation storage. Roles are restricted to
  `user`, `assistant`, `tool`, and `system`; sequence numbers are positive and
  unique within a project conversation.
- `timeline_versions` stores append-only Timeline IR JSON, an independent
  Timeline `schema_version`, edit intent, and diff summary. C10 adds the
  immutable source/timeline metadata, deterministic edit digest, and optional
  idempotency key. Version numbers are positive and unique within a project.
  A parent and source version must belong to the same project. Parent deletion
  cascades to its child versions, and the database trigger rejects updates.
- `timeline_active` stores one active-version pointer per project. Pointer
  changes are transactional and use a compare-and-swap revision, so stale
  undo/redo or activation requests fail without changing the active version.

All resource IDs are application-generated lowercase UUID strings. Timestamps
use UTC Unix epoch milliseconds and end in `_at_ms`. JSON is validated as
finite, bounded JSON-safe data and stored as UTF-8 text using
`ensure_ascii=False`, sorted keys, and compact separators. The repository API
does not store Pydantic objects, Python objects, or pickle.

Deleting a project at the database level cascades only database rows. It never
deletes `project_root`, an external asset, or any other filesystem entry.

## A06 controlled project updates

A06 extends the repository surface only with `ProjectRepository.get_by_root`,
`ProjectRepository.update_location`, `AssetRepository.get_by_path`, and
`AssetRepository.create_many`. These methods keep project ID/path scope in the
fixed SQL and provide no arbitrary update, delete, SQL, or filesystem API.
When a moved project is opened, the Core service verifies manifest ID/name/
platform, checks the unique project root, and updates root, updated time and
revision. It never changes an asset's external absolute path. A06's original
schema was version 1. A07 keeps `0001_initial.sql` immutable and adds version 2
in `0002_persistent_jobs.sql`; existing v1 project databases are upgraded
transactionally on the next open.

## Repository API

The public Python API is deliberately small and typed:

```python
from supervideo_core.storage import (
    AssetRepository, Database, JobRepository, MessageRepository,
    ProjectRepository, TimelineVersionRepository,
)

database = Database.open(database_path)  # absolute path from trusted A06
database.migrate()
projects = ProjectRepository(database)
project = projects.create(project_record)
assets = AssetRepository(database).list_for_project(project.id, limit=100)
messages = MessageRepository(database).list_for_conversation(project.id, "conversation-id")
```

Project, asset, job, message, and timeline inputs are strict Pydantic records.
All list operations have a bounded limit and deterministic ordering; child
queries include the project ID in their SQL conditions. `MessageRepository`
and `TimelineVersionRepository` append records and provide no update method.
There is no arbitrary SQL, table-name, `WHERE`-clause, or dictionary-to-UPDATE
repository entry point.

## Verification

After the Python environment is initialized, run the focused suite and the
cross-process storage smoke from the repository root:

```powershell
npm run core:setup
npm run core:test
npm run core:storage:smoke
```

The smoke command creates a temporary project path containing spaces and
Chinese characters, starts two real Python processes, writes fixed non-secret
fixtures in the first process, reopens and migrates the same database in the
second process, checks all five tables and integrity constraints, and removes
the temporary tree in a `finally` path. It does not create a tracked report.

WAL may create `project.db-wal` and `project.db-shm` while a connection is
active. Always close every connection before removing or moving a project
database. The smoke and tests use temporary directories and clean these files
with the temporary tree.

## Version boundaries and current limits

`DATABASE_SCHEMA_VERSION` is currently 3 and versions SQLite migrations. It is independent from
A04 `CORE_RPC_PROTOCOL_VERSION` and from the Timeline IR `schemaVersion` stored
in `timeline_versions`. None of these constants may be reused for another
boundary.

A05's base tables and A07's job migration remain immutable. C10's `0003` is a
forward-only migration for the active pointer and version metadata; it also
backfills `source_type_v3` from existing parent links. C10 does not rewrite or
delete old Timeline IR rows. The version service exposes bounded create,
edit-save, list/get, activate, undo, redo, and diff operations; it does not
render media. Downstream renderers consume the complete `version.timeline`
snapshot returned by the version contract.
