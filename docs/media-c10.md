# C10 Timeline versions, undo/redo and diff V1

C10 persists complete Timeline IR V1 snapshots as immutable project-scoped
versions. It adds navigation and comparison around the pure `timeline.edit`
engine from C09; it does not render media, call a network service, or create
an MP4.

## Versioned contract

Every C10 request and result carries:

```json
{
  "schemaVersion": 1,
  "versioningVersion": "timeline-version-v1"
}
```

The public RPC methods are:

| Method | Purpose |
| --- | --- |
| `timeline.version.create` | Store a complete root snapshot, or a supplied snapshot based on the active version. |
| `timeline.version.apply_edit` | Run one C09 edit against the selected/active snapshot and persist the accepted result. |
| `timeline.version.list` | Return bounded snapshots in deterministic version order. |
| `timeline.version.get` | Return one complete snapshot. |
| `timeline.version.activate` | Move the active pointer to an existing snapshot. |
| `timeline.version.undo` | Activate the parent of the active snapshot. |
| `timeline.version.redo` | Activate the only child, or require `versionId` when a branch is ambiguous. |
| `timeline.version.diff` | Return a bounded, deterministic clip/source/provenance diff between two versions. |

Result field `version` is the full immutable snapshot, including the complete
`timeline`, `versionId`, `versionNumber`, `parentVersionId`, `sourceType`,
`editIntent`, `diffSummary`, and `isActive`. `apply_edit` also returns the
C09 `editResult`, preserving the parsed intent, exact candidate Timeline and
`determinismDigest`.

## Persistence and consistency

Storage migration `0003_timeline_active.sql` upgrades schema v2 to v3. The
existing `timeline_versions` rows remain append-only: the database trigger
rejects updates. New metadata records the Timeline identity, source version,
root/edit kind, C09 digest and optional idempotency key. The `timeline_active`
table contains one project-scoped active version, `updated_at_ms` and a
monotonic `revision`. Activation uses compare-and-swap on that revision, so a
stale `expectedActiveVersionId` fails with `TIMELINE_VERSION_CONFLICT`.

All reads and writes include `projectId`; a version from another project is
not addressable through the service. Parent, source and active references are
also validated against the same project. Repeating a request with the same
project and idempotency key returns the existing version instead of appending
another row.

Undo follows `parentVersionId`. Redo follows direct children. When more than
one child exists, redo returns `TIMELINE_REDO_AMBIGUOUS` unless the caller
selects a child explicitly. A root cannot be undone and a leaf cannot be
redone.

## Bounds and stable errors

The complete Timeline payload is limited to 220 KiB, version lists to 100
items, diff clip/source/provenance IDs to 64 entries per category, and the
diff summary to 16 KiB. Inputs use strict Pydantic models with unknown fields
rejected and exactly one of natural-language `instruction` or structured
`intent` required for `apply_edit`.

The stable C10 error codes are `TIMELINE_VERSION_NOT_FOUND`,
`TIMELINE_VERSION_PROJECT_MISMATCH`, `TIMELINE_ACTIVE_VERSION_MISSING`,
`TIMELINE_NO_UNDO`, `TIMELINE_NO_REDO`, `TIMELINE_REDO_AMBIGUOUS`,
`TIMELINE_VERSION_CONFLICT`, `TIMELINE_VERSION_INVALID`, and
`TIMELINE_DIFF_NOT_AVAILABLE`. Error payloads do not expose SQL, paths,
tokens, or raw exception text.

## Boundary with C09

C09 `timeline.edit` remains pure and does not write storage. C10 invokes it
with the full source IR, and only an accepted result becomes a new immutable
version. Reopening, undoing, redoing or diffing a version consumes the stored
IR; it never reparses the original natural-language instruction. Rendering is
left to later consumers of the active complete Timeline.
