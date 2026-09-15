"""Minimal executable health entry point for the Python Core."""

from __future__ import annotations

import json


def health_status() -> dict[str, str]:
    """Return the stable health payload used by the workspace checks."""

    return {"service": "python-core", "status": "ok"}


def main() -> None:
    print(json.dumps(health_status(), separators=(",", ":")))


if __name__ == "__main__":
    main()
