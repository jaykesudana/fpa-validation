"""Run a numbered SQL migration against Neon using psycopg2.

This exists because the machine that authored this repo has no Node.js
installed, so the Node-based migration tooling recommended in
06-ARCHITECTURE-NETLIFY-NEON.md (node-pg-migrate / drizzle-kit) can't run
here. Postgres's wire protocol doesn't care what ran the SQL, so this script
is a legitimate one-off bootstrap — but once CI (or any machine with Node) is
available, prefer the real migration tool so future migrations are tracked
consistently.

Usage:
    python scripts/run_migration.py migrations/0001_init.sql

Reads DATABASE_URL_UNPOOLED (falling back to DATABASE_URL) from a .env file
in the repo root, or from the real environment.
"""
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scripts/run_migration.py <path-to-sql-file>", file=sys.stderr)
        return 2

    sql_path = Path(sys.argv[1])
    if not sql_path.exists():
        print(f"no such file: {sql_path}", file=sys.stderr)
        return 2

    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv(repo_root / ".env")

    dsn = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set — add it to .env", file=sys.stderr)
        return 2

    sql = sql_path.read_text(encoding="utf-8")

    print(f"Connecting to Neon and running {sql_path.name} ...")
    conn = psycopg2.connect(dsn)
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        print("Migration applied and committed.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
