"""URL policy for E01 source records.

The V1 transport is offline, but source records still validate the same public
URL boundary that a future HTTP transport must enforce before every request
and redirect.
"""

from __future__ import annotations

import ipaddress
import re
from urllib.parse import parse_qsl, unquote, urlsplit, urlunsplit

from .errors import ResearchError

_MAX_URL_LENGTH = 2_048
_SENSITIVE_QUERY_KEY = re.compile(
    r"(?:^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|credential|authorization|auth|cookie|signature|sig)(?:$|[_-])",
    re.IGNORECASE,
)
_SENSITIVE_QUERY_VALUE = re.compile(r"(?:bearer\s+|sk-[A-Za-z0-9]{12,}|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=])", re.IGNORECASE)
_FORBIDDEN_PATH_ESCAPE = re.compile(r"%(?:2e|2f|5c)", re.IGNORECASE)
_HOST_SUFFIXES = (".localhost", ".local", ".internal", ".intranet", ".lan")


def canonicalize_public_url(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > _MAX_URL_LENGTH:
        raise ResearchError("RESEARCH_URL_INVALID")
    if any(character.isspace() or ord(character) < 32 or ord(character) == 127 for character in value):
        raise ResearchError("RESEARCH_URL_INVALID")
    if "\\" in value or _FORBIDDEN_PATH_ESCAPE.search(value) is not None:
        raise ResearchError("RESEARCH_URL_INVALID")
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except (ValueError, UnicodeError):
        raise ResearchError("RESEARCH_URL_INVALID") from None
    if parsed.scheme.lower() not in {"http", "https"} or not hostname or parsed.username or parsed.password or parsed.fragment:
        raise ResearchError("RESEARCH_URL_INVALID")
    hostname = hostname.rstrip(".").lower()
    if not hostname or hostname == "localhost" or hostname.endswith(_HOST_SUFFIXES) or "." not in hostname:
        raise ResearchError("RESEARCH_URL_INVALID")
    try:
        address = ipaddress.ip_address(hostname.strip("[]"))
    except ValueError:
        address = None
    if address is not None and (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    ):
        raise ResearchError("RESEARCH_URL_INVALID")
    path = parsed.path or "/"
    decoded_path = unquote(path)
    if any(part in {".", ".."} for part in decoded_path.split("/")):
        raise ResearchError("RESEARCH_URL_INVALID")
    query_pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=False)
    for key, item in query_pairs:
        if _SENSITIVE_QUERY_KEY.search(key) or _SENSITIVE_QUERY_VALUE.search(item):
            raise ResearchError("RESEARCH_URL_INVALID")
        if any(character.isspace() or ord(character) < 32 or ord(character) == 127 for character in key + item):
            raise ResearchError("RESEARCH_URL_INVALID")
    canonical_query = "&".join(f"{key}={item}" for key, item in sorted(query_pairs))
    netloc = hostname
    if ":" in hostname and not hostname.startswith("["):
        netloc = f"[{hostname}]"
    if port is not None and not ((parsed.scheme.lower() == "http" and port == 80) or (parsed.scheme.lower() == "https" and port == 443)):
        netloc = f"{netloc}:{port}"
    return urlunsplit((parsed.scheme.lower(), netloc, path, canonical_query, ""))
