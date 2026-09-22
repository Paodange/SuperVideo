# D02 TTS adapter V1

D02 exposes the fixed `job.tts.start` and `job.tts.result` Core methods and the
Desktop `startTtsJob` / `getTtsJobResult` capabilities. The public contract is
`tts-contract` V1. A start request carries only a project ID, idempotency key,
provider ID, voice and bounded sentence inputs. Main resolves the D01 TTS
configuration and copies its model into the Core payload; `credentialRef` is
used only for Main-side configuration validation and is not sent to the
Worker, Core, SQLite job input, event payload, logs or Renderer.

The default `fake` provider is an offline deterministic adapter. It writes a
mono 22.05 kHz WAV below:

```text
<project-root>/generated/tts-v1/<sha256-cache-key>.wav
```

The result contains the relative output path, byte size, SHA-256 fingerprint,
duration, ordered sentence timestamps, provider/model/voice and generated
provenance. The output and a versioned JSON manifest are written atomically;
cache reads verify the manifest, project/selection fields, regular-file
boundary, size and fingerprint before returning `cache-hit`.

The cache key is SHA-256 over the versioned project ID, adapter version, every
sentence text and provenance ID, provider, model and voice. Consequently, a
changed adapter, voice or model cannot reuse another selection's artifact. A different idempotency key
creates a new durable Job but may reuse the same verified cache artifact; the
same key and normalized input returns the original Job, while a conflicting
input returns `IDEMPOTENCY_CONFLICT`.

TTS jobs use the A07 `tts.synthesize` executor. SQLite remains the source of
truth for status, checkpoint, result and append-only events. Checkpoints are
versioned by executor and contain only cache-key and sentence progress. Core
reopens queued/running/retrying jobs, recomputes deterministic output and
never writes a success event until the output and result validate. Retry is
bounded by the A07 three-attempt limit. Job status/events use the existing
project-scoped allowlist; the full non-sensitive result is retrieved through
the fixed `job.tts.result` method.

The Python `TtsAdapterRegistry` is the offline Core seam for deterministic
adapters. The D01 Main provider boundary remains the future real-provider
seam: a real adapter may receive a secret only inside a Main-owned
`CredentialVault.runWithSecret` callback. No future transport or provider
secret may be added to the Worker/Core protocol, job payload, manifest or
diagnostics.

Offline verification:

```powershell
npm run tts:smoke
```

This command runs only the D02 Core tests and creates no tracked output or
network request.
