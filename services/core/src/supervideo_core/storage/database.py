"""SQLite connection ownership, PRAGMA configuration, transactions and checks."""

from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .errors import StorageError, StorageErrorCode, map_sqlite_error


DATABASE_BUSY_TIMEOUT_MS = 5_000
DATABASE_JOURNAL_MODE = "wal"
DATABASE_SYNCHRONOUS = 1  # SQLite's NORMAL mode value.


@dataclass
class IntegrityReport:
    """Structured output from SQLite integrity diagnostics."""

    quick_check: list[str]
    integrity_check: list[str]
    foreign_key_violations: list[dict[str, object]]

    @property
    def ok(self) -> bool:
        return (
            self.quick_check == ["ok"]
            and self.integrity_check == ["ok"]
            and not self.foreign_key_violations
        )

    def as_dict(self) -> dict[str, object]:
        return {
            "ok": self.ok,
            "quickCheck": list(self.quick_check),
            "integrityCheck": list(self.integrity_check),
            "foreignKeyViolations": [dict(item) for item in self.foreign_key_violations],
        }

    def model_dump(self) -> dict[str, object]:
        """Provide a familiar typed-record spelling for callers and tests."""

        return self.as_dict()

    def __getitem__(self, key: str) -> object:
        return self.as_dict()[key]


class Database:
    """One SQLite connection owned and used by one thread.

    The class intentionally does not choose a default path, create project
    directories, or expose a SQL execution API.  The trusted project layer
    supplies an absolute database path and repositories issue the fixed SQL.
    ``connection`` is available for migrations and diagnostics; application
    code should use repositories for business writes.
    """

    def __init__(self, database_path: str | os.PathLike[str]) -> None:
        self.path = _normalize_database_path(database_path)
        self._owner_thread = threading.get_ident()
        self._connection: sqlite3.Connection | None = None
        self._transaction_depth = 0
        try:
            self._connection = sqlite3.connect(
                str(self.path),
                timeout=DATABASE_BUSY_TIMEOUT_MS / 1_000,
                isolation_level=None,
                check_same_thread=True,
            )
            self._configure_connection()
        except StorageError:
            self.close()
            raise
        except (OSError, sqlite3.Error) as error:
            self.close()
            raise map_sqlite_error(error, opening=True) from error

    @classmethod
    def open(cls, database_path: str | os.PathLike[str]) -> "Database":
        return cls(database_path)

    @property
    def connection(self) -> sqlite3.Connection:
        self._ensure_usable()
        assert self._connection is not None
        return self._connection

    @property
    def is_open(self) -> bool:
        return self._connection is not None

    def migrate(self):
        """Run the bundled migrations and return their typed report."""

        from .migrations import MigrationRunner

        return MigrationRunner(self).migrate()

    def pragma_values(self) -> dict[str, object]:
        """Return the verified connection settings without exposing the path."""

        connection = self.connection
        try:
            return {
                "foreign_keys": int(connection.execute("PRAGMA foreign_keys").fetchone()[0]),
                "journal_mode": str(connection.execute("PRAGMA journal_mode").fetchone()[0]).lower(),
                "synchronous": int(connection.execute("PRAGMA synchronous").fetchone()[0]),
                "busy_timeout": int(connection.execute("PRAGMA busy_timeout").fetchone()[0]),
            }
        except sqlite3.Error as error:
            raise map_sqlite_error(error) from error

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Open a deterministic write transaction.

        Repositories can be composed inside one outer transaction.  Nested
        calls share that transaction, while the outermost context owns commit
        and rollback.
        """

        connection = self.connection
        outermost = self._transaction_depth == 0
        if outermost:
            try:
                connection.execute("BEGIN IMMEDIATE")
            except sqlite3.Error as error:
                raise map_sqlite_error(error) from error
        self._transaction_depth += 1
        try:
            yield connection
        except BaseException:
            self._transaction_depth -= 1
            if outermost and connection.in_transaction:
                try:
                    connection.rollback()
                except sqlite3.Error as rollback_error:
                    raise map_sqlite_error(rollback_error) from rollback_error
            raise
        else:
            self._transaction_depth -= 1
            if outermost:
                try:
                    connection.commit()
                except sqlite3.Error as error:
                    if connection.in_transaction:
                        connection.rollback()
                    raise map_sqlite_error(error) from error

    def integrity_report(self) -> IntegrityReport:
        """Run quick, full and foreign-key checks without repairing anything."""

        connection = self.connection
        try:
            quick_rows = connection.execute("PRAGMA quick_check").fetchall()
            integrity_rows = connection.execute("PRAGMA integrity_check").fetchall()
            foreign_key_rows = connection.execute("PRAGMA foreign_key_check").fetchall()
        except sqlite3.Error as error:
            raise map_sqlite_error(error) from error
        return IntegrityReport(
            quick_check=[str(row[0]) for row in quick_rows],
            integrity_check=[str(row[0]) for row in integrity_rows],
            foreign_key_violations=[
                {
                    "table": str(row[0]),
                    "rowid": row[1],
                    "parent": str(row[2]),
                    "foreignKeyIndex": int(row[3]),
                }
                for row in foreign_key_rows
            ],
        )

    # Explicit aliases make the diagnostic API discoverable while keeping one
    # implementation and no automatic repair behavior.
    check_integrity = integrity_report
    diagnostics = integrity_report

    def close(self) -> None:
        connection = self._connection
        if connection is None:
            return
        if threading.get_ident() != self._owner_thread:
            raise StorageError("INVALID_RECORD")
        try:
            if connection.in_transaction:
                connection.rollback()
            connection.close()
        except sqlite3.Error as error:
            raise map_sqlite_error(error) from error
        finally:
            self._connection = None
            self._transaction_depth = 0

    def __enter__(self) -> "Database":
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.close()

    def _configure_connection(self) -> None:
        connection = self._connection
        assert connection is not None
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            foreign_keys = connection.execute("PRAGMA foreign_keys").fetchone()[0]
            if int(foreign_keys) != 1:
                raise StorageError("DATABASE_OPEN_FAILED")

            journal_mode = str(connection.execute("PRAGMA journal_mode = WAL").fetchone()[0]).lower()
            if journal_mode != DATABASE_JOURNAL_MODE:
                raise StorageError("DATABASE_READ_ONLY")

            connection.execute("PRAGMA synchronous = NORMAL")
            synchronous = int(connection.execute("PRAGMA synchronous").fetchone()[0])
            if synchronous != DATABASE_SYNCHRONOUS:
                raise StorageError("DATABASE_OPEN_FAILED")

            connection.execute(f"PRAGMA busy_timeout = {DATABASE_BUSY_TIMEOUT_MS}")
            busy_timeout = int(connection.execute("PRAGMA busy_timeout").fetchone()[0])
            if busy_timeout != DATABASE_BUSY_TIMEOUT_MS:
                raise StorageError("DATABASE_OPEN_FAILED")
        except StorageError:
            raise
        except (OSError, sqlite3.Error) as error:
            raise map_sqlite_error(error, opening=True) from error

    def _ensure_usable(self) -> None:
        if self._connection is None:
            raise StorageError("DATABASE_OPEN_FAILED")
        if threading.get_ident() != self._owner_thread:
            raise StorageError("INVALID_RECORD")


def _normalize_database_path(database_path: str | os.PathLike[str]) -> Path:
    try:
        raw_path = os.fspath(database_path)
    except TypeError as error:
        raise StorageError("DATABASE_OPEN_FAILED", cause=error) from error
    if not isinstance(raw_path, str) or not raw_path or "\x00" in raw_path or not os.path.isabs(raw_path):
        raise StorageError("DATABASE_OPEN_FAILED")
    return Path(os.path.normcase(os.path.abspath(os.path.normpath(raw_path))))
