"""Provide parameterized reads and atomic short-lived file transactions."""
from contextlib import contextmanager
import hashlib
from pathlib import Path
import sqlite3
from typing import Any, Iterator, Protocol, Sequence


class EntityRepository(Protocol):
    """Expose the minimal storage boundary consumed by domain services."""
    def read(self, query: str, parameters: Sequence[Any] = ()) -> list[dict[str, Any]]:
        """Read supplied SQL using bound values."""
        ...


class SqliteRepository:
    """Own a file path, never a shared request connection."""
    def __init__(self, path: str) -> None:
        """Retain a file path without creating storage.

        Raises:
            ValueError: When configured storage is not file-backed.
        """
        if not path or path == ':memory:' or path.startswith('file:'):
            raise ValueError('A real SQLite file is required')
        self.path = Path(path)

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Commit one unit of work and close its connection even on failure.

        Yields:
            Connection with foreign keys enabled.
        Raises:
            sqlite3.Error: When execution or commit fails; no automatic retry.
        """
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute('PRAGMA foreign_keys = ON')
            connection.execute('BEGIN')
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def read(self, query: str, parameters: Sequence[Any] = ()) -> list[dict[str, Any]]:
        """Return detached records from a short read transaction.

        Args:
            query: Trusted application SQL, not user supplied text.
            parameters: Values to bind independently of SQL syntax.
        """
        with self.transaction() as connection:
            return [dict(row) for row in connection.execute(query, parameters).fetchall()]

    def migrate(self) -> None:
        """Apply ordered immutable migrations and reject unknown schema history.

        Raises:
            RuntimeError: When migration history or checksums are unsupported.
        """
        self.path.parent.mkdir(parents=True, exist_ok=True)
        files = sorted((Path(__file__).parent / 'migrations').glob('[0-9][0-9][0-9]_*.sql'))
        with self.transaction() as connection:
            connection.execute('CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL)')
            history = connection.execute('SELECT * FROM schema_migration ORDER BY version').fetchall()
            if len(history) > len(files):
                raise RuntimeError('Unsupported schema version')
            for index, file in enumerate(files, start=1):
                if int(file.name[:3]) != index:
                    raise RuntimeError('Migration numbering must be contiguous')
                sql = file.read_text(encoding='utf-8')
                checksum = hashlib.sha256(sql.encode('utf-8')).hexdigest()
                if index <= len(history):
                    row = history[index - 1]
                    if row['version'] != index or row['name'] != file.name or row['checksum'] != checksum:
                        raise RuntimeError('Unsupported or modified schema migration')
                    continue
                for statement in sql.split(';'):
                    if statement.strip():
                        connection.execute(statement)
                connection.execute('INSERT INTO schema_migration VALUES (?, ?, ?)', (index, file.name, checksum))
