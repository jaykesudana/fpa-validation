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
        cur.execute("select email, name, role from users order by role desc, name")
        print("users:")
        for row in cur.fetchall():
            print(f"  {row[2]:6s} {row[1]:24s} {row[0]}")

        print()
        cur.execute(
            "select u.name, d.tower, count(*) from dept_access d "
            "join users u on u.id = d.user_id group by 1, 2 order by 1, 2"
        )
        print("dept_access grants (per user, per tower):")
        for row in cur.fetchall():
            print(f"  {row[0]:24s} {row[1]:4s} {row[2]}")

        cur.execute("select count(*) from dept_access where tower = 'vcp'")
        print(f"\ntotal vcp grants: {cur.fetchone()[0]}")
        cur.execute("select count(*) from dept_access where tower = 'inv'")
        print(f"total inv grants: {cur.fetchone()[0]}")
finally:
    conn.close()
