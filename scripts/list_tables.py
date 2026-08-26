import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

repo_root = Path(__file__).resolve().parent.parent
load_dotenv(repo_root / ".env")
dsn = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")

conn = psycopg2.connect(dsn)
try:
    with conn.cursor() as cur:
        cur.execute(
            "select table_name, table_type from information_schema.tables "
            "where table_schema = 'public' order by table_type, table_name"
        )
        for name, ttype in cur.fetchall():
            print(f"{ttype:12s} {name}")
finally:
    conn.close()
