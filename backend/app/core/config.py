"""Load deployment settings without opening storage at import time."""
from pathlib import Path
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Describe local prototype runtime and explicitly configured limits."""
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[2] / '.env', extra='ignore')
    database_path: str = 'data/digiai.db'
    seed_on_startup: bool = True
    cors_origins: str = 'http://localhost:5173'
    bind_host: str = '0.0.0.0'
    bind_port: int = 8000
    log_level: str = 'INFO'
    upload_max_bytes: int = 5242880
    upload_max_rows: int = 5000
    upload_max_columns: int = 100
    xlsx_max_expanded_bytes: int = 52428800
    query_default_limit: int = 50
    query_max_limit: int = 100

    @field_validator('database_path')
    @classmethod
    def require_file(cls, value: str) -> str:
        """Reject fileless storage.

        Raises:
            ValueError: When a non-file database is configured.
        """
        if not value.strip() or value == ':memory:' or value.startswith('file:'):
            raise ValueError('DATABASE_PATH must be a filesystem path')
        return value

    @property
    def origins(self) -> list[str]:
        """Return configured browser origins, omitting blank entries."""
        return [item.strip() for item in self.cors_origins.split(',') if item.strip()]
