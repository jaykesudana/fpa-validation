# FP&A Control Tower

Internal finance dashboard for IDC — Value Creation Plan (savings) and Investment Requests (spend), plus a read-only Summary rollup. Built against the spec in `design_handoff_fpa_control_tower/` (see that folder's `README.md` for the full domain writeup).

## Status

Build order follows `CLAUDE_CODE_PROMPT.md`. Landed:

1. **Schema** — `migrations/0001_init.sql` (verbatim `04-DATA-MODEL.sql`) + `migrations/0002_seed_roster.sql` (the real FBP roster and per-tower grants from `01-DOMAIN-AND-ROLES.md §1`, not just catalogue seed, so the mechanics have real multi-user data).
2. **Calc module** — `src/lib/calc/vcp.ts` and `investments.ts`, ported formula-for-formula from the reference JS. Both API and any future UI import from here — numbers can't drift between towers.
3. **Auth + scope** — `requireScope()` in `src/lib/auth/scope.ts` is the one authorization gate every route calls. **Real SSO is intentionally deferred** (FDEs will wire in Azure AD later); until then `src/lib/auth/session.ts` reads a dev-only "acting as" cookie, gated by `ALLOW_DEV_AUTH`. Swapping in real SSO only touches that one file.
4. **Workbook engine** — `src/lib/workbook/`: header aliasing, Gate 2/3 parsers (exact reject messages from the spec), template/export generators.
5. **VCP tower** — Gate 1 (targets set/lock/unlock), Gate 2 (upload/approve/reject), Gate 3 (validation versions, monotonic with retry-on-conflict, approve/reject), department read endpoints.
6. **Investment Requests tower** — bucket, full request lifecycle (draft → submit → screen → approve/reject, return, withdraw), attachments.
7. **Summary tower** — `GET /api/summary`, both lenses (by department / by initiative), reusing the same calc functions as the VCP tower rather than re-deriving the numbers.
8. **Audit + notifications** — every mutation writes its audit row in the same transaction as the change; `GET /api/notifications`, `POST /api/notifications/read`, `GET /api/audit` (scoped per-tower for partners).
9. **File storage** — Netlify Blobs (`src/lib/blob-storage.ts`), wired into workbook uploads and request attachments. Zero-config once deployed; see `DEPLOY.md`.

**Not built**: the actual UI (everything above is API-only so far — `src/app/page.tsx` is still a placeholder), real email notifications (deliberately deferred — the `notifications` table's `emailed_at` column is ready whenever that's picked up), real SSO, and the two remaining VCP endpoints from `05-API.md` that never got built: evidence attach/download (`POST /api/vcp/uploads/:id/evidence`, `GET /api/vcp/evidence/:id/download`) and the baseline re-export (`GET /api/vcp/uploads/:id/export`).

See **`DEPLOY.md`** for the Netlify/GitHub steps that need a browser session and are yours to run.

## Running this

The machine this was authored on has no Node.js installed, so `npm install` / `npm test` / `npm run build` have **not** been executed locally — only hand-verified against the ported formulas (and, for a couple of external APIs — the Neon driver's `.transaction()` shape and Netlify Blobs — checked directly against current docs rather than assumed). Run these yourself, or let `.github/workflows/ci.yml` do it on push:

```
npm install
npm test        # vitest
npm run build   # next build
```

### Running a migration against Neon

Also Node-free, via a small Python script (see `scripts/run_migration.py` for why):

```
pip install psycopg2-binary python-dotenv
cp .env.example .env   # fill in DATABASE_URL_UNPOOLED
python scripts/run_migration.py migrations/0001_init.sql
python scripts/run_migration.py migrations/0002_seed_roster.sql
python scripts/verify_schema.py    # tables + seed + blank slate
python scripts/verify_roster.py    # roster + per-tower grant counts
```

### Trying the mechanics without real SSO

With `ALLOW_DEV_AUTH=true` in `.env`:

```
GET  /api/dev/users            # list the roster (email/name/role) to pick from
POST /api/dev/sign-in          # { "email": "margaret.yin@idc.com" }
POST /api/dev/sign-out
GET  /api/me                   # confirms role + per-tower department access for whoever's signed in
```

Note: routes that touch Netlify Blobs (workbook uploads, attachments) need `netlify dev`, not plain `npm run dev` — blob credentials are only ambient in Netlify's own runtime.

## A standing rule this codebase follows

`@neondatabase/serverless` is a drop-in for `node-postgres` and inherits its default type parsing: `bigint`/`numeric` columns (and `SUM()`/`COUNT()` results) come back as **strings**, not numbers. Every route wraps these in `Number(...)` at the read site — if you add a new query touching a `_cents`, `size_bytes`, or count column, wrap it too.

## Structure

```
migrations/                    Neon Postgres schema + seed (0001 catalogue, 0002 roster/grants)
src/lib/calc/                  vcp.ts, investments.ts, format.ts — the shared calc module
src/lib/auth/                  session.ts (dev cookie), current-user.ts, scope.ts (requireScope)
src/lib/workbook/              constants, header-alias, parse, generate, read — the Excel engine
src/lib/crypto/field-crypto.ts AES-256-GCM encryption for ee_id at rest
src/lib/blob-storage.ts        Netlify Blobs wrapper (putBlob/getBlob/deleteBlob)
src/lib/notify.ts               notifyDept / notifyAdmins / notifyAllPartners — notification fan-out
src/lib/notify-meta.ts         Per-(tower, event) label/colour lookup
src/lib/vcp/load-department.ts DB rows → the exact shape vcp.ts's calc functions expect
src/lib/inv/last-action.ts     Reads audit_log for a request's last action (per business-rules §B4)
src/app/api/vcp/               Gate 1/2/3 routes, department reads
src/app/api/inv/               Bucket, request lifecycle, attachments
src/app/api/summary/           Read-only rollup across both towers
src/app/api/notifications/     Feed + mark-as-read
src/app/api/audit/             Scoped audit trail read
src/app/api/dev/               Dev-only sign-in/sign-out/roster routes (ALLOW_DEV_AUTH gated)
scripts/                       Python helpers for running SQL without Node
DEPLOY.md                      Netlify/GitHub steps — yours to run, needs a browser session
```
