"""Sanity-check migration 0001 against Neon: confirm every table exists, the
catalogue seed landed, and — per README.md's "blank slate" non-negotiable —
no transactional data snuck in.
"""
import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

EXPECTED_TABLES = [
    "users", "departments", "dept_access", "vcp_initiatives", "inv_initiatives",
    "lookup_values", "fiscal_years", "vcp_targets", "vcp_uploads", "vcp_upload_rows",
    "vcp_evidence", "vcp_validations", "vcp_validation_rows", "inv_bucket",
    "inv_requests", "inv_attachments", "audit_log", "notifications",
]

TRANSACTIONAL_TABLES = [
    "vcp_targets", "vcp_uploads", "vcp_upload_rows", "vcp_evidence",
    "vcp_validations", "vcp_validation_rows", "inv_requests", "inv_attachments",
    "audit_log", "notifications", "dept_access", "users",
]

def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv(repo_root / ".env")
    dsn = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set — add it to .env")
        return 2

    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select table_name from information_schema.tables where table_schema = 'public'"
            )
            found = {row[0] for row in cur.fetchall()}

            missing = [t for t in EXPECTED_TABLES if t not in found]
            print(f"Tables found: {len(found)} / expected {len(EXPECTED_TABLES)}")
            if missing:
                print(f"  MISSING: {missing}")
            else:
                print("  all expected tables present.")

            print()
            for kind, table in [
                ("fiscal years", "fiscal_years"),
                ("departments", "departments"),
                ("VCP initiatives", "vcp_initiatives"),
                ("investment initiatives", "inv_initiatives"),
                ("lookup values", "lookup_values"),
                ("investment bucket rows", "inv_bucket"),
            ]:
                cur.execute(f"select count(*) from {table}")
                print(f"  {kind}: {cur.fetchone()[0]}")

            print()
            print("Blank-slate check (should all be 0):")
            for table in TRANSACTIONAL_TABLES:
                cur.execute(f"select count(*) from {table}")
                count = cur.fetchone()[0]
                flag = "" if count == 0 else "  <-- NOT BLANK"
                print(f"  {table}: {count}{flag}")

            print()
            cur.execute("select constraint_name from information_schema.table_constraints where table_name = 'inv_bucket' and constraint_type = 'CHECK'")
            print("inv_bucket check constraints:", [r[0] for r in cur.fetchall()])
    finally:
        conn.close()

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
