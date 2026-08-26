"""One-off: drop the fpa-control-tower objects from the OLD shared database.

Deliberately does NOT read .env — takes the target DSN from OLD_DATABASE_URL
in the process environment for this single invocation only, so the old
connection string never gets written back into a persisted file.

Usage (PowerShell):
    $env:OLD_DATABASE_URL = "postgresql://..."
    python scripts/drop_fpa_objects.py
"""
import os
import sys
from pathlib import Path

import psycopg2

def main() -> int:
    dsn = os.environ.get("OLD_DATABASE_URL")
    if not dsn:
        print("set OLD_DATABASE_URL in the environment for this command", file=sys.stderr)
        return 2

    sql_path = Path(__file__).resolve().parent / "drop_fpa_objects.sql"
    sql = sql_path.read_text(encoding="utf-8")

    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        print("Dropped fpa-control-tower objects from the shared database.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
