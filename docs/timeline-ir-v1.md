# Timeline IR V1

`TimelineProject.schemaVersion = 1` is the renderer-neutral timeline contract
shared by TypeScript callers and the Python Core. The canonical JSON example is
[`tests/fixtures/c01_timeline_ir_v1.json`](../tests/fixtures/c01_timeline_ir_v1.json).

## Shape

- A project has a canvas, duration, ordered tracks, source references and
  provenance records.
- Tracks are `video`, `audio`, `subtitle` or `overlay`.
- Clips carry timeline start/duration, optional source in/out, optional
  transform/transitions, Jianying editability, and optional sentence,
  subtitle, provenance and metadata fields.
- Media clips (`video`, `audio`, `image`, `template`) require `sourceId`.
  Subtitle clips require a subtitle payload. Source and provenance IDs must
  resolve within the same project.

## Validation invariants

The TypeScript runtime guard and Python Pydantic model both reject unknown
fields, non-finite numbers, unbounded strings/arrays, duplicate IDs, clips past
the project duration, incompatible track/clip kinds, and invalid references.
When source in/out are present, their span must equal the clip duration and may
not exceed a declared source duration. The encoded project is limited to 512
KiB.

The version is intentionally literal. A future incompatible shape must use a
new `schemaVersion` and a separate compatibility/migration path; V1 consumers
must reject newer versions instead of guessing.
