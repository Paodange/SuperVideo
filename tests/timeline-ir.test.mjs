import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const shared = await import(pathToFileURL(path.join(root, "packages", "shared", "dist", "index.js")).href);
const fixturePath = path.join(root, "tests", "fixtures", "c01_timeline_ir_v1.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

test("Timeline IR V1 fixture validates with cross-object references", () => {
  const project = shared.validateTimelineProject(fixture);
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.tracks.length, 4);
  assert.equal(project.tracks.flatMap((track) => track.clips).length, 4);
  assert.equal(shared.isTimelineProject(fixture), true);
});

test("Timeline IR rejects source spans that do not equal clip duration", () => {
  const invalid = structuredClone(fixture);
  invalid.tracks[0].clips[0].sourceOutMs = 4_999;
  assert.equal(shared.isTimelineProject(invalid), false);
  assert.throws(() => shared.validateTimelineProject(invalid), shared.TimelineValidationException);
});

test("Timeline IR rejects cross-track, missing-source and out-of-range references", () => {
  const invalid = structuredClone(fixture);
  invalid.tracks[1].clips[0].trackId = "track-video";
  invalid.tracks[1].clips[0].sourceId = "not-declared";
  invalid.tracks[1].clips[0].volume = 5;
  assert.equal(shared.isTimelineProject(invalid), false);
  assert.throws(() => shared.validateTimelineProject(invalid), (error) => {
    assert.equal(error.name, "TimelineValidationException");
    assert.ok(error.errors.some((item) => item.path.endsWith("trackId")));
    assert.ok(error.errors.some((item) => item.path.endsWith("sourceId")));
    assert.ok(error.errors.some((item) => item.path.endsWith("volume")));
    return true;
  });
});

test("Timeline IR requires subtitle payloads and rejects unknown keys", () => {
  const invalid = structuredClone(fixture);
  invalid.tracks[2].clips[0].subtitle.text = "";
  invalid.tracks[2].clips[0].unexpected = true;
  assert.equal(shared.isTimelineProject(invalid), false);
  const unknown = structuredClone(fixture);
  unknown.unexpected = true;
  assert.equal(shared.isTimelineProject(unknown), false);
});

test("Timeline IR requires source provenance references to resolve", () => {
  const invalid = structuredClone(fixture);
  invalid.sources[0].provenanceIds = ["not-declared"];
  assert.equal(shared.isTimelineProject(invalid), false);
  assert.throws(() => shared.validateTimelineProject(invalid), shared.TimelineValidationException);
});
