from __future__ import annotations

import unittest
from uuid import UUID

from pydantic import ValidationError

from supervideo_core.providers import ProviderConfig, ProviderHealth, provider_capabilities

PROJECT = "11111111-1111-4111-8111-111111111111"


def make_config(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "schemaVersion": 1, "protocolVersion": 1, "projectId": PROJECT,
        "serviceKind": "llm", "providerId": "fake", "displayName": "Offline fake",
        "model": "fake-pass", "endpoint": None, "credentialRef": "cred-test",
        "capabilities": ["chat.generate", "chat.stream"], "enabled": True,
        "createdAtMs": 1, "updatedAtMs": 1,
    }
    value.update(overrides)
    return value


class ProviderTests(unittest.TestCase):
    def test_config_is_strict_and_secret_free(self) -> None:
        parsed = ProviderConfig.model_validate(make_config())
        self.assertEqual(parsed.project_id, UUID(PROJECT))
        self.assertIn("chat.generate", provider_capabilities("llm"))
        with self.assertRaises(ValidationError):
            ProviderConfig.model_validate(make_config(secret="DO_NOT_USE"))

    def test_endpoint_rejects_arbitrary_plain_http(self) -> None:
        with self.assertRaises(ValidationError):
            ProviderConfig.model_validate(make_config(endpoint="http://example.invalid/api"))
        self.assertIsNotNone(ProviderConfig.model_validate(make_config(endpoint="http://127.0.0.1:8080/v1")).endpoint)

    def test_health_shape_forbids_unbounded_fields(self) -> None:
        parsed = ProviderHealth.model_validate({
            "schemaVersion": 1, "protocolVersion": 1, "projectId": PROJECT,
            "serviceKind": "tts", "providerId": "fake", "status": "unconfigured",
            "capabilities": ["speech.synthesize"], "checkedAtMs": 1, "latencyMs": None,
            "error": {"code": "MISSING_CREDENTIAL", "retryable": False},
        })
        self.assertEqual(parsed.status, "unconfigured")


if __name__ == "__main__":
    unittest.main()
