"""Application configuration and environment management with Pydantic.

Loads configuration from environment variables and optional .env files.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
ROOT_DIR = BACKEND_DIR.parent


class Settings(BaseModel):
    # Server & Environment
    app_name: str = "Audit Monitor API"
    app_version: str = "1.0.0"
    environment: str = Field(default="development")
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)
    log_level: str = Field(default="INFO")

    # Security & CORS
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8000",
            "http://127.0.0.1:8000",
        ]
    )

    # Storage & Persistence Paths
    data_dir: Path = Field(default_factory=lambda: BACKEND_DIR / "data")
    seed_path: Path = Field(default_factory=lambda: APP_DIR / "seed.json")
    static_dir: Path = Field(default_factory=lambda: ROOT_DIR / "frontend" / "dist")

    @classmethod
    def load_from_env(cls) -> Settings:
        cors_raw = os.environ.get("CORS_ORIGINS")
        cors_list = (
            [o.strip() for o in cors_raw.split(",") if o.strip()]
            if cors_raw
            else None
        )
        data_dir_env = os.environ.get("DATA_DIR")
        static_dir_env = os.environ.get("STATIC_DIR")

        kwargs = {}
        if os.environ.get("ENVIRONMENT"):
            kwargs["environment"] = os.environ["ENVIRONMENT"]
        if os.environ.get("HOST"):
            kwargs["host"] = os.environ["HOST"]
        if os.environ.get("PORT"):
            kwargs["port"] = int(os.environ["PORT"])
        if os.environ.get("LOG_LEVEL"):
            kwargs["log_level"] = os.environ["LOG_LEVEL"]
        if cors_list:
            kwargs["cors_origins"] = cors_list
        if data_dir_env:
            kwargs["data_dir"] = Path(data_dir_env)
        if static_dir_env:
            kwargs["static_dir"] = Path(static_dir_env)

        return cls(**kwargs)


settings = Settings.load_from_env()
