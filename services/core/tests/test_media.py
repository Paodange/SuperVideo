from __future__ import annotations

import asyncio
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from supervideo_core.media import MediaService
from supervideo_core.media.errors import MediaError
from supervideo_core.media.models import MediaProbeParams, MediaProxyParams
from supervideo_core.project import AssetReferenceRequest, ProjectCreateRequest, ProjectError, ProjectService


class MediaServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_root = Path(tempfile.mkdtemp(prefix="supervideo media test "))
        self.project_root = self.temp_root / "project"
        self.project_root.mkdir()
        self.asset_path = self.temp_root / "fixture.mp4"
        self.skipTestUnlessTools()
        subprocess.run(
            [shutil.which("ffmpeg") or "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=0.4", "-f", "lavfi", "-i", "sine=frequency=1000:duration=0.4", "-shortest", "-c:v", "libx264", "-c:a", "aac", str(self.asset_path)],
            check=True,
            capture_output=True,
        )
        self.service = ProjectService()
        summary = self.service.create(ProjectCreateRequest(name="Media", targetPlatform="douyin", projectRoot=str(self.project_root)))
        reference = self.service.reference_assets(AssetReferenceRequest(projectId=summary.project_id, paths=[str(self.asset_path)]))
        self.project_id = summary.project_id
        self.asset_id = reference.items[0].asset_id

    def tearDown(self) -> None:
        self.service.close()
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def skipTestUnlessTools(self) -> None:
        if shutil.which("ffprobe") is None or shutil.which("ffmpeg") is None:
            self.skipTest("B02 media integration fixture requires allowlisted ffprobe and FFmpeg")

    def test_probe_proxy_cache_invalidation_and_original_immutability(self) -> None:
        original = self.asset_path.read_bytes()

        async def scenario() -> None:
            probe = await self.service.probe_media(MediaProbeParams(projectId=self.project_id, assetId=self.asset_id), asyncio.Event())
            self.assertEqual(probe.cache_status, "created")
            self.assertTrue(probe.metadata.streams)
            self.assertEqual((await self.service.probe_media(MediaProbeParams(projectId=self.project_id, assetId=self.asset_id), asyncio.Event())).cache_status, "cache-hit")
            proxy = await self.service.proxy_media(MediaProxyParams(projectId=self.project_id, assetId=self.asset_id), asyncio.Event())
            self.assertEqual(proxy.cache_status, "created")
            self.assertEqual(len(proxy.outputs), 3)
            self.assertEqual((await self.service.proxy_media(MediaProxyParams(projectId=self.project_id, assetId=self.asset_id), asyncio.Event())).cache_status, "cache-hit")

        asyncio.run(scenario())
        self.assertEqual(self.asset_path.read_bytes(), original)
        self.asset_path.write_bytes(original + b"changed")
        with self.assertRaises(ProjectError) as error:
            asyncio.run(self.service.probe_media(MediaProbeParams(projectId=self.project_id, assetId=self.asset_id), asyncio.Event()))
        self.assertEqual(error.exception.code, "ASSET_CHANGED")

    def test_bad_probe_output_is_stable_and_cancel_kills_child(self) -> None:
        with self.assertRaises(MediaError) as error:
            MediaService._parse_probe(b"not-json")
        self.assertEqual(error.exception.code, "MEDIA_PROBE_PARSE_ERROR")

        async def scenario() -> None:
            service = MediaService()
            cancelled = asyncio.Event()
            task = asyncio.create_task(service._run([shutil.which("python") or "python", "-c", "import time; time.sleep(30)"], 120_000, cancelled))
            await asyncio.sleep(0.05)
            cancelled.set()
            with self.assertRaises(MediaError) as cancelled_error:
                await task
            self.assertEqual(cancelled_error.exception.code, "MEDIA_CANCELLED")

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
