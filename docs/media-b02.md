# B02 media probe and proxy

B02 adds two fixed Core RPC methods:

- `media.probe({ projectId, assetId, timeoutMs? })`
- `media.proxy({ projectId, assetId, timeoutMs? })`

The `assetId` must belong to the active project and must still match the
registered canonical path, size, modification time and B01 fingerprint. A
changed or missing external file returns a stable asset error; the original
file is never opened for writing.

The Core owns the only media subprocess boundary. `ffprobe` and FFmpeg are
resolved from the configured `SUPERVIDEO_FFPROBE_PATH` and
`SUPERVIDEO_FFMPEG_PATH`, or from an allowlisted executable name on the host.
The RPC cannot provide a command, executable, filter, or path. Every process
is started with an argument array and `shell=false`; timeout, non-zero exit,
invalid JSON, unavailable tools and cancellation have stable error codes.

Probe metadata is schema version 1 and includes container format, duration,
bit rate, and bounded video/audio stream fields. Proxy outputs are an AAC
`.m4a` audio proxy, a low-bitrate H.264/AAC `.mp4` video proxy, and a JPEG
thumbnail. Output is written below `cache/media-cache-v1/` using temporary
files/directories followed by atomic replacement. Temporary output is removed
after cancellation or failure.

The cache key is SHA-256 over the cache version, canonical asset path, size,
mtime, fingerprint, and fixed probe/proxy parameters. Cache manifests contain
only versioned project-relative output paths. A cache hit verifies every output
is a regular file with the recorded size; a missing or invalid manifest is
regenerated. This is a filesystem cache and does not change the SQLite schema
or the immutable migrations.

`core.cancel` cancels an active `media.probe` or `media.proxy` request and the
Core kills its corresponding child process. The stable `MEDIA_CANCELLED` code
is preserved through Core RPC and the Worker operation boundary. Reissuing the
fixed operation is safe and acts as recovery because incomplete temporary
output is not treated as a cache hit.
