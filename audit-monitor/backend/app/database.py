"""SQLite database layer for Audit Monitor.

Creates and manages tables for order_intake, purchase_orders, audit_exceptions,
kris, runs, planner_items, and settings.
"""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

APP_DIR = Path(__file__).resolve().parent
SEED_PATH = APP_DIR / "seed.json"


def get_db_path() -> Path:
    data_dir = Path(os.environ.get("DATA_DIR", APP_DIR.parent / "data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "audit_monitor.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(force_reset: bool = False) -> None:
    db_path = get_db_path()
    if force_reset and db_path.exists():
        db_path.unlink()

    conn = get_connection()
    with conn:
        # 1. order_intake table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS order_intake (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id VARCHAR(100) NOT NULL,
                customer_name VARCHAR(255) NOT NULL,
                order_date DATE NOT NULL,
                order_amount FLOAT NOT NULL,
                currency VARCHAR(10) NOT NULL,
                po_reference VARCHAR(100),
                source_system VARCHAR(50) NOT NULL,
                status VARCHAR(50) NOT NULL,
                created_at DATETIME NOT NULL
            );
            """
        )

        # 2. purchase_orders table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS purchase_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                po_id VARCHAR(100) NOT NULL,
                order_id VARCHAR(100),
                vendor_id VARCHAR(100) NOT NULL,
                po_date DATE NOT NULL,
                po_amount FLOAT NOT NULL,
                currency VARCHAR(10) NOT NULL,
                source_system VARCHAR(50) NOT NULL,
                status VARCHAR(50) NOT NULL,
                created_at DATETIME NOT NULL
            );
            """
        )

        # 3. audit_exceptions table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_exceptions (
                id VARCHAR(50) PRIMARY KEY,
                run_id VARCHAR(50) NOT NULL,
                kri_id VARCHAR(50) NOT NULL,
                ref VARCHAR(100),
                wbs VARCHAR(100),
                project VARCHAR(255),
                region VARCHAR(50),
                bg VARCHAR(50),
                amount FLOAT NOT NULL,
                currency VARCHAR(10) DEFAULT 'EUR',
                category VARCHAR(100),
                classification VARCHAR(50),
                status VARCHAR(50) DEFAULT 'open',
                summary TEXT,
                evidence TEXT,
                reasoning TEXT,
                hypothesis TEXT,
                confirm TEXT,
                review_note TEXT,
                created_at DATETIME NOT NULL
            );
            """
        )

        # 4. kris table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS kris (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                area VARCHAR(50),
                kind VARCHAR(50),
                status VARCHAR(50) DEFAULT 'draft',
                risk TEXT,
                objective TEXT,
                sources TEXT,
                steps TEXT,
                thresholds TEXT,
                frequency VARCHAR(50),
                align_to_close BOOLEAN,
                fetch_offset_days INTEGER,
                sampling INTEGER,
                reviewer VARCHAR(100),
                hitl VARCHAR(50),
                owner VARCHAR(100),
                last_run VARCHAR(50),
                note TEXT,
                custom_date VARCHAR(50),
                category VARCHAR(100)
            );
            """
        )

        # 5. runs table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
                id VARCHAR(50) PRIMARY KEY,
                kri_id VARCHAR(50) NOT NULL,
                trigger VARCHAR(50),
                period VARCHAR(50),
                started_at VARCHAR(50),
                duration VARCHAR(50),
                status VARCHAR(50),
                population INTEGER,
                tested INTEGER,
                exceptions INTEGER,
                explainable INTEGER,
                unexplained INTEGER
            );
            """
        )

        # 6. planner_items table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS planner_items (
                id VARCHAR(50) PRIMARY KEY,
                type VARCHAR(50),
                source VARCHAR(50),
                title VARCHAR(255),
                region VARCHAR(50),
                bg VARCHAR(50),
                created_at VARCHAR(50),
                status VARCHAR(50),
                scope TEXT,
                suggested_length VARCHAR(50),
                policy_default VARCHAR(50),
                link VARCHAR(50),
                plan TEXT
            );
            """
        )

        # 7. settings table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(50) PRIMARY KEY,
                value TEXT
            );
            """
        )

    # Seed if tables are empty
    seed_data_if_needed(conn)
    conn.close()


def seed_data_if_needed(conn: sqlite3.Connection) -> None:
    cursor = conn.cursor()

    if not SEED_PATH.exists():
        # Seed Calendar settings if missing
        cursor.execute("SELECT COUNT(*) FROM settings WHERE key = 'calendar'")
        if cursor.fetchone()[0] == 0:
            default_calendar = {"pattern": "4-4-5", "fyStart": "January", "weekEnd": "Sunday"}
            cursor.execute(
                "INSERT INTO settings (key, value) VALUES ('calendar', ?)",
                (json.dumps(default_calendar),),
            )
        conn.commit()
        return

    seed_json: dict[str, Any] = json.loads(SEED_PATH.read_text(encoding="utf-8"))

    # Seed KRIs
    cursor.execute("SELECT COUNT(*) FROM kris")
    if cursor.fetchone()[0] == 0:
        for k in seed_json.get("kris", []):
            cursor.execute(
                """
                INSERT INTO kris (
                    id, name, area, kind, status, risk, objective, sources,
                    steps, thresholds, frequency, align_to_close, fetch_offset_days,
                    sampling, reviewer, hitl, owner, last_run, note, custom_date, category
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    k.get("id"),
                    k.get("name"),
                    k.get("area"),
                    k.get("kind"),
                    k.get("status", "draft"),
                    k.get("risk", ""),
                    k.get("objective", ""),
                    json.dumps(k.get("sources", [])),
                    json.dumps(k.get("steps", [])),
                    json.dumps(k.get("thresholds", [])),
                    k.get("frequency", "monthly"),
                    1 if k.get("alignToClose", True) else 0,
                    k.get("fetchOffsetDays", 3),
                    k.get("sampling", 100),
                    k.get("reviewer", "Audit Manager"),
                    k.get("hitl", "exceptions"),
                    k.get("owner", "Internal Audit"),
                    k.get("lastRun"),
                    k.get("note"),
                    k.get("customDate"),
                    k.get("category"),
                ),
            )

    # Seed Runs
    cursor.execute("SELECT COUNT(*) FROM runs")
    if cursor.fetchone()[0] == 0:
        for r in seed_json.get("runs", []):
            cursor.execute(
                """
                INSERT INTO runs (
                    id, kri_id, trigger, period, started_at, duration, status,
                    population, tested, exceptions, explainable, unexplained
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    r.get("id"),
                    r.get("kriId"),
                    r.get("trigger"),
                    r.get("period"),
                    r.get("startedAt"),
                    r.get("duration"),
                    r.get("status", "Complete"),
                    r.get("population", 0),
                    r.get("tested", 0),
                    r.get("exceptions", 0),
                    r.get("explainable", 0),
                    r.get("unexplained", 0),
                ),
            )

    # Seed Exceptions
    cursor.execute("SELECT COUNT(*) FROM audit_exceptions")
    if cursor.fetchone()[0] == 0:
        now_iso = datetime.now(timezone.utc).isoformat()
        for e in seed_json.get("exceptions", []):
            cursor.execute(
                """
                INSERT INTO audit_exceptions (
                    id, run_id, kri_id, ref, wbs, project, region, bg,
                    amount, currency, category, classification, status,
                    summary, evidence, reasoning, hypothesis, confirm,
                    review_note, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    e.get("id"),
                    e.get("runId"),
                    e.get("kriId"),
                    e.get("ref"),
                    e.get("wbs"),
                    e.get("project"),
                    e.get("region"),
                    e.get("bg"),
                    e.get("amount", 0.0),
                    e.get("currency", "EUR"),
                    e.get("category"),
                    e.get("classification"),
                    e.get("status", "open"),
                    e.get("summary"),
                    json.dumps(e.get("evidence", [])),
                    json.dumps(e.get("reasoning", [])),
                    json.dumps(e.get("hypothesis", {})),
                    e.get("confirm", ""),
                    e.get("reviewNote"),
                    now_iso,
                ),
            )

    # Seed Planner items
    cursor.execute("SELECT COUNT(*) FROM planner_items")
    if cursor.fetchone()[0] == 0:
        for p in seed_json.get("planner", []):
            cursor.execute(
                """
                INSERT INTO planner_items (
                    id, type, source, title, region, bg, created_at,
                    status, scope, suggested_length, policy_default, link, plan
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    p.get("id"),
                    p.get("type"),
                    p.get("source"),
                    p.get("title"),
                    p.get("region"),
                    p.get("bg"),
                    p.get("createdAt"),
                    p.get("status", "New"),
                    p.get("scope", ""),
                    p.get("suggestedLength", "1 week"),
                    p.get("policyDefault", "v4.1"),
                    p.get("link", "—"),
                    json.dumps(p.get("plan")) if p.get("plan") is not None else None,
                ),
            )

    # Seed Calendar settings
    cursor.execute("SELECT COUNT(*) FROM settings WHERE key = 'calendar'")
    if cursor.fetchone()[0] == 0:
        default_calendar = {"pattern": "4-4-5", "fyStart": "January", "weekEnd": "Sunday"}
        cursor.execute(
            "INSERT INTO settings (key, value) VALUES ('calendar', ?)",
            (json.dumps(default_calendar),),
        )

    # Seed Sample Source Tables: order_intake & purchase_orders
    cursor.execute("SELECT COUNT(*) FROM order_intake")
    if cursor.fetchone()[0] == 0:
        sample_orders = [
            ("ORD-2026-001", "Customer A (Nordics)", "2026-08-01", 120000.0, "EUR", "PO-7801-A", "SAP", "Booked", "2026-08-01 10:00:00"),
            ("ORD-2026-002", "Customer B (UK)", "2026-08-04", 450000.0, "EUR", "PO-9902-B", "SAP", "Booked", "2026-08-04 11:30:00"),
            ("ORD-2026-003", "Customer C (DACH)", "2026-08-10", 85000.0, "EUR", "PO-4411-C", "OBS", "Booked", "2026-08-10 09:15:00"),
            ("ORD-2026-004", "Customer D (MEA)", "2026-08-15", 310000.0, "EUR", "PO-1209-D", "OBS", "Reversed", "2026-08-15 14:00:00"),
            ("ORD-2026-005", "Customer E (APAC)", "2026-08-18", 95000.0, "USD", "PO-3320-E", "SAP", "Booked", "2026-08-18 16:45:00"),
            ("ORD-2026-006", "Customer F (North America)", "2026-08-22", 520000.0, "USD", "PO-8812-F", "SAP", "Booked", "2026-08-22 08:30:00"),
            ("ORD-2026-007", "Customer G (Iberia)", "2026-08-25", 64000.0, "EUR", "PO-5501-G", "OBS", "Booked", "2026-08-25 13:20:00"),
            ("ORD-2026-008", "Customer H (France)", "2026-08-28", 230000.0, "EUR", "PO-6623-H", "SAP", "Pending", "2026-08-28 17:10:00"),
        ]
        cursor.executemany(
            """
            INSERT INTO order_intake (
                order_id, customer_name, order_date, order_amount, currency,
                po_reference, source_system, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            sample_orders,
        )

    cursor.execute("SELECT COUNT(*) FROM purchase_orders")
    if cursor.fetchone()[0] == 0:
        sample_pos = [
            ("PO-7801-A", "ORD-2026-001", "VEND-101", "2026-08-01", 120000.0, "EUR", "SAP", "Approved", "2026-08-01 10:05:00"),
            ("PO-9902-B", "ORD-2026-002", "VEND-102", "2026-08-04", 450000.0, "EUR", "SAP", "Approved", "2026-08-04 11:35:00"),
            ("PO-4411-C", "ORD-2026-003", "VEND-103", "2026-08-10", 85000.0, "EUR", "OBS", "Approved", "2026-08-10 09:20:00"),
            ("PO-1209-D", "ORD-2026-004", "VEND-104", "2026-08-15", 310000.0, "EUR", "OBS", "Cancelled", "2026-08-15 14:05:00"),
            ("PO-3320-E", "ORD-2026-005", "VEND-105", "2026-08-18", 95000.0, "USD", "SAP", "Approved", "2026-08-18 16:50:00"),
            ("PO-8812-F", "ORD-2026-006", "VEND-106", "2026-08-22", 520000.0, "USD", "SAP", "Approved", "2026-08-22 08:35:00"),
            ("PO-5501-G", "ORD-2026-007", "VEND-107", "2026-08-25", 64000.0, "EUR", "OBS", "Approved", "2026-08-25 13:25:00"),
            ("PO-6623-H", "ORD-2026-008", "VEND-108", "2026-08-28", 230000.0, "EUR", "SAP", "Open", "2026-08-28 17:15:00"),
        ]
        cursor.executemany(
            """
            INSERT INTO purchase_orders (
                po_id, order_id, vendor_id, po_date, po_amount, currency,
                source_system, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            sample_pos,
        )

    conn.commit()
