"""Windows-first path policy for trusted project operations."""

from __future__ import annotations

import hashlib
import os
import stat
from pathlib import Path

from .errors import ProjectError

PROJECT_MANIFEST_FILENAME = "project.supervideo.json"
DATABASE_RELATIVE_PATH = "data/project.db"
STANDARD_PROJECT_DIRECTORIES = (
    "data",
    "cache",
    "generated",
    "previews",
    "exports",
    "exports/videos",
    "exports/jianying",
    "logs",
)
SUPPORTED_VIDEO_EXTENSIONS = frozenset({".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm"})
SUPPORTED_AUDIO_EXTENSIONS = frozenset({".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"})
SUPPORTED_ASSET_EXTENSIONS = SUPPORTED_VIDEO_EXTENSIONS | SUPPORTED_AUDIO_EXTENSIONS
MAX_ASSET_PATH_LENGTH = 32_767
MAX_ASSET_BASENAME_LENGTH = 255
FINGERPRINT_ALGORITHM = "sampled-sha256-v1"
FINGERPRINT_SAMPLE_BYTES = 64 * 1024


def normalize_project_root(value: str) -> Path:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ProjectError("INVALID_PROJECT_ROOT")
    if len(value) > MAX_ASSET_PATH_LENGTH or _is_unc_path(value):
        raise ProjectError("UNSUPPORTED_PROJECT_LOCATION" if _is_unc_path(value) else "INVALID_PROJECT_ROOT")
    if not os.path.isabs(value):
        raise ProjectError("INVALID_PROJECT_ROOT")
    normalized = Path(os.path.normcase(os.path.realpath(os.path.abspath(os.path.normpath(value)))))
    if _is_volume_root(normalized):
        raise ProjectError("INVALID_PROJECT_ROOT")
    try:
        if not normalized.is_dir():
            raise ProjectError("INVALID_PROJECT_ROOT")
    except OSError as error:
        raise ProjectError("FILE_ACCESS_DENIED", cause=error) from error
    return normalized


def ensure_project_directories(root: Path) -> list[Path]:
    created: list[Path] = []
    for relative in STANDARD_PROJECT_DIRECTORIES:
        directory = root / relative
        if directory.exists():
            if directory.is_symlink() or not directory.is_dir():
                raise ProjectError("INVALID_PROJECT_ROOT")
            continue
        try:
            directory.mkdir()
        except FileExistsError:
            if not directory.is_dir():
                raise ProjectError("INVALID_PROJECT_ROOT")
        except OSError as error:
            raise ProjectError("FILE_ACCESS_DENIED", cause=error) from error
        created.append(directory)
    return created


def database_path_for(root: Path) -> Path:
    database = root / DATABASE_RELATIVE_PATH
    try:
        if os.path.commonpath([str(root), str(database)]) != str(root):
            raise ProjectError("INVALID_PROJECT_ROOT")
    except ValueError as error:
        raise ProjectError("INVALID_PROJECT_ROOT", cause=error) from error
    return database


def canonical_asset_path(value: str) -> tuple[Path, os.stat_result]:
    if not isinstance(value, str) or not value or "\x00" in value or len(value) > MAX_ASSET_PATH_LENGTH:
        raise ProjectError("FILE_ACCESS_DENIED")
    if not os.path.isabs(value):
        raise ProjectError("FILE_ACCESS_DENIED")
    try:
        target = Path(os.path.normcase(os.path.realpath(value)))
        if len(target.name) > MAX_ASSET_BASENAME_LENGTH:
            raise ProjectError("FILE_ACCESS_DENIED")
        file_stat = target.stat()
    except ProjectError:
        raise
    except OSError as error:
        raise ProjectError("FILE_ACCESS_DENIED", cause=error) from error
    if not stat.S_ISREG(file_stat.st_mode):
        raise ProjectError("FILE_ACCESS_DENIED")
    return target, file_stat


def canonical_asset_directory(value: str) -> tuple[Path, os.stat_result]:
    """Resolve a user-selected scan directory to an accessible real directory."""

    if not isinstance(value, str) or not value or "\x00" in value or len(value) > MAX_ASSET_PATH_LENGTH:
        raise ProjectError("FILE_ACCESS_DENIED")
    if not os.path.isabs(value):
        raise ProjectError("FILE_ACCESS_DENIED")
    try:
        target = Path(os.path.normcase(os.path.realpath(value)))
        directory_stat = target.stat()
    except OSError as error:
        raise ProjectError("FILE_ACCESS_DENIED", cause=error) from error
    if not stat.S_ISDIR(directory_stat.st_mode) or _is_volume_root(target):
        raise ProjectError("FILE_ACCESS_DENIED")
    return target, directory_stat


def asset_kind_for(path: Path) -> str:
    extension = path.suffix.lower()
    if extension in SUPPORTED_VIDEO_EXTENSIONS:
        return "video"
    if extension in SUPPORTED_AUDIO_EXTENSIONS:
        return "audio"
    raise ProjectError("UNSUPPORTED_ASSET_TYPE")


def sampled_fingerprint(path: Path, file_stat: os.stat_result) -> str:
    try:
        with path.open("rb") as handle:
            if file_stat.st_size <= FINGERPRINT_SAMPLE_BYTES * 2:
                body = handle.read()
                if len(body) != file_stat.st_size:
                    raise ProjectError("FILE_ACCESS_DENIED")
                head = body
                tail = b""
            else:
                head = handle.read(FINGERPRINT_SAMPLE_BYTES)
                handle.seek(max(0, file_stat.st_size - FINGERPRINT_SAMPLE_BYTES), os.SEEK_SET)
                tail = handle.read(FINGERPRINT_SAMPLE_BYTES)
    except ProjectError:
        raise
    except OSError as error:
        raise ProjectError("FILE_ACCESS_DENIED", cause=error) from error
    digest = hashlib.sha256()
    digest.update(FINGERPRINT_ALGORITHM.encode("ascii"))
    digest.update(b"\0")
    digest.update(str(file_stat.st_size).encode("ascii"))
    digest.update(b"\0")
    digest.update(head)
    digest.update(b"\0")
    digest.update(tail)
    return f"{FINGERPRINT_ALGORITHM}:{digest.hexdigest()}"


def stat_signature(file_stat: os.stat_result) -> tuple[int, int]:
    return int(file_stat.st_size), int(file_stat.st_mtime_ns // 1_000_000)


def _is_unc_path(value: str) -> bool:
    return value.startswith("\\\\") or value.startswith("//")


def _is_volume_root(value: Path) -> bool:
    return value.parent == value and bool(value.anchor)
