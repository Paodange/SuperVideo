"""Auditable, versioned SQLite migrations with atomic application."""

from __future__ import annotations

import hashlib
import re
import sqlite3
from dataclasses import dataclass
from importlib import resources
from typing import Sequence

from .database import Database
from .errors import StorageError, map_sqlite_error
from .models import utc_now_ms


DATABASE_SCHEMA_VERSION = 1
_MIGRATION_NAME_PATTERN = re.compile(r"^(?P<version>[0-9]{4})_(?P<name>[a-z][a-z0-9_]*)$")
_SCHEMA_MIGRATIONS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at_ms INTEGER NOT NULL CHECK(applied_at_ms >= 0)
)
"""


def normalize_migration_text(sql: str) -> str:
    """Use one newline representation for source and checksum on all hosts."""

    return sql.replace("\r\n", "\n").replace("\r", "\n")


def migration_checksum(sql: str) -> str:
    return hashlib.sha256(normalize_migration_text(sql).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    sql: str

    def __post_init__(self) -> None:
        if (
            isinstance(self.version, bool)
            or not isinstance(self.version, int)
            or self.version < 1
            or not isinstance(self.name, str)
            or _MIGRATION_NAME_PATTERN.fullmatch(self.name) is None
            or int(self.name[:4]) != self.version
            or not isinstance(self.sql, str)
        ):
            raise StorageError("MIGRATION_FAILED")

    @property
    def normalized_sql(self) -> str:
        return normalize_migration_text(self.sql)

    @property
    def checksum(self) -> str:
        return migration_checksum(self.sql)

    @classmethod
    def from_text(cls, filename_stem: str, sql: str) -> "Migration":
        match = _MIGRATION_NAME_PATTERN.fullmatch(filename_stem)
        if match is None:
            raise StorageError("MIGRATION_FAILED")
        return cls(version=int(match.group("version")), name=filename_stem, sql=sql)


@dataclass(frozen=True)
class MigrationReport:
    current_version: int
    applied_versions: tuple[int, ...]
    changed: bool

    @property
    def no_op(self) -> bool:
        return not self.changed

    def as_dict(self) -> dict[str, object]:
        return {
            "currentVersion": self.current_version,
            "appliedVersions": list(self.applied_versions),
            "changed": self.changed,
            "noOp": self.no_op,
        }


def discover_migrations() -> list[Migration]:
    """Read only bundled SQL files; no caller-supplied names or paths."""

    try:
        sql_directory = resources.files("supervideo_core.storage").joinpath("sql")
        migrations: list[Migration] = []
        for entry in sql_directory.iterdir():
            if not entry.is_file():
                continue
            if entry.name == "__init__.py" or not entry.name.endswith(".sql"):
                continue
            if not _MIGRATION_NAME_PATTERN.fullmatch(entry.name[:-4]):
                raise StorageError("MIGRATION_FAILED")
            sql = entry.read_text(encoding="utf-8")
            migrations.append(Migration.from_text(entry.name[:-4], sql))
    except StorageError:
        raise
    except (OSError, UnicodeError, TypeError) as error:
        raise StorageError("MIGRATION_FAILED", cause=error) from error
    # importlib.resources does not promise directory iteration order.  Sort by
    # the parsed migration version before applying the structural validation so
    # an equivalent package layout upgrades deterministically on every host.
    migrations.sort(key=lambda migration: migration.version)
    return validate_migrations(migrations)


def validate_migrations(migrations: Sequence[Migration]) -> list[Migration]:
    """Reject gaps, duplicates and out-of-order migration registrations."""

    values = list(migrations)
    if not values:
        raise StorageError("MIGRATION_FAILED")
    previous_version = 0
    seen: set[int] = set()
    for migration in values:
        if not isinstance(migration, Migration):
            raise StorageError("MIGRATION_FAILED")
        if migration.version in seen or migration.version <= previous_version:
            raise StorageError("MIGRATION_FAILED")
        if migration.version != previous_version + 1:
            raise StorageError("MIGRATION_FAILED")
        expected_name = f"{migration.version:04d}_{migration.name.split('_', 1)[1]}" if "_" in migration.name else ""
        if migration.name != expected_name or _MIGRATION_NAME_PATTERN.fullmatch(migration.name) is None:
            raise StorageError("MIGRATION_FAILED")
        seen.add(migration.version)
        previous_version = migration.version
    return values


class MigrationRunner:
    def __init__(self, database: Database, migrations: Sequence[Migration] | None = None) -> None:
        self.database = database
        self.migrations = validate_migrations(migrations if migrations is not None else discover_migrations())

    def migrate(self) -> MigrationReport:
        connection = self.database.connection
        try:
            with self.database.transaction():
                # The metadata table is bootstrapped inside the same transaction
                # as the first migration, so a failed fresh migration leaves no
                # half-created schema or version record.
                connection.execute(_SCHEMA_MIGRATIONS_TABLE_SQL)
                rows = connection.execute(
                    "SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC"
                ).fetchall()
                applied = {int(row[0]): (str(row[1]), str(row[2])) for row in rows}
                highest_applied = max(applied, default=0)
                supported_version = self.migrations[-1].version
                if highest_applied > supported_version:
                    raise StorageError("SCHEMA_TOO_NEW")

                self._validate_applied(connection, applied)
                changed = False
                for migration in self.migrations:
                    if migration.version in applied:
                        continue
                    try:
                        _execute_sql_statements(connection, migration.normalized_sql)
                        connection.execute(
                            "INSERT INTO schema_migrations(version, name, checksum, applied_at_ms) VALUES (?, ?, ?, ?)",
                            (migration.version, migration.name, migration.checksum, utc_now_ms()),
                        )
                    except StorageError:
                        raise
                    except sqlite3.Error as error:
                        raise map_sqlite_error(error, migrating=True) from error
                    changed = True
                current_version = self.migrations[-1].version
        except StorageError:
            raise
        except sqlite3.Error as error:
            raise map_sqlite_error(error, migrating=True) from error
        return MigrationReport(
            current_version=current_version,
            applied_versions=tuple(migration.version for migration in self.migrations),
            changed=changed,
        )

    def _validate_applied(self, connection: sqlite3.Connection, applied: dict[int, tuple[str, str]]) -> None:
        expected_by_version = {migration.version: migration for migration in self.migrations}
        for version in sorted(applied):
            migration = expected_by_version.get(version)
            if migration is None:
                raise StorageError("MIGRATION_CHECKSUM_MISMATCH")
            name, checksum = applied[version]
            if name != migration.name or checksum != migration.checksum:
                raise StorageError("MIGRATION_CHECKSUM_MISMATCH")
        expected_versions = list(range(1, max(applied, default=0) + 1))
        if sorted(applied) != expected_versions:
            raise StorageError("MIGRATION_FAILED")


def _execute_sql_statements(connection: sqlite3.Connection, sql: str) -> None:
    """Execute statements one-by-one so sqlite3 cannot auto-commit a script."""

    statement = ""
    for character in sql:
        statement += character
        # Checking only at semicolons handles multiple statements on one line
        # while keeping BEGIN...END trigger bodies as one SQLite statement.
        if character == ";" and sqlite3.complete_statement(statement):
            candidate = statement.strip()
            if candidate:
                connection.execute(candidate)
            statement = ""
    if _contains_non_comment_sql(statement):
        raise StorageError("MIGRATION_FAILED")


def _contains_non_comment_sql(value: str) -> bool:
    for line in value.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("--"):
            return True
    return False
