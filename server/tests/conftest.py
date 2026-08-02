"""Test fixtures.

Everything runs against a throwaway `interior_design_test` database so a test
run can never touch real saved plans. DATABASE_URL is set before the app is
imported, because db.py reads it at import time to build the engine.
"""
from __future__ import annotations

import os

TEST_DB = "interior_design_test"
ADMIN_URL = "postgresql+psycopg://localhost/postgres"
os.environ["DATABASE_URL"] = f"postgresql+psycopg://localhost/{TEST_DB}"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _database() -> None:
    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": TEST_DB}
        ).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{TEST_DB}"'))
    admin.dispose()

    from app import db as store

    store.init_db()
    yield


@pytest.fixture(autouse=True)
def _clean_tables() -> None:
    from app import db as store

    with store.engine.begin() as conn:
        conn.execute(text("TRUNCATE TABLE floorplans"))
    yield


@pytest.fixture()
def client() -> TestClient:
    from app.main import app

    with TestClient(app) as c:
        yield c
