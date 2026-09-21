from __future__ import annotations

import io
import json
import math
import unittest
from pathlib import Path

from supervideo_core.observability import StructuredDiagnosticLogger, redact_value


class ObservabilityTests(unittest.TestCase):
    def test_shared_fixtures_match_python_redaction(self) -> None:
        root = Path(__file__).resolve().parents[3]
        fixtures = json.loads((root / "contracts" / "redaction-fixtures.json").read_text(encoding="utf-8"))
        for fixture in fixtures:
            self.assertEqual(redact_value(fixture["input"]), fixture["expected"], fixture["name"])

    def test_hostile_values_are_bounded_and_json_safe(self) -> None:
        value: dict[str, object] = {"secret": "A08_FAKE_SENTINEL", "nested": {"prompt": "A08_FAKE_SENTINEL"}, "number": math.nan, "items": list(range(100))}
        value["self"] = value
        output = redact_value(value)
        encoded = json.dumps(output, allow_nan=False)
        self.assertNotIn("A08_FAKE_SENTINEL", encoded)
        self.assertIn("[CIRCULAR]", encoded)

    def test_logger_emits_only_bounded_structured_stderr(self) -> None:
        stream = io.StringIO()
        logger = StructuredDiagnosticLogger(stream)
        logger.emit("core-request-started", request_id="rpc-a08", details={"method": "core.health", "prompt": "A08_FAKE_SENTINEL"})
        logger.emit("not-allowlisted", details={"message": "A08_FAKE_SENTINEL"})
        lines = stream.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        event = json.loads(lines[0])
        self.assertEqual(event["component"], "python-core")
        self.assertEqual(event["requestId"], "rpc-a08")
        self.assertNotIn("A08_FAKE_SENTINEL", lines[0])


if __name__ == "__main__":
    unittest.main()
