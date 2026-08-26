# Deploying FP&A Control Tower to Netlify

Everything code-side is ready for this (Netlify Blobs wired up, `netlify.toml` set for the zero-config Next.js adapter). The steps below all require a browser/CLI session with your Netlify and GitHub accounts, which is why they're yours to run rather than something done for you in this session.

## 1. Push to GitHub

You said you'd handle this yourself — create the repo and push the contents of this folder. Nothing here needs special handling; `.gitignore` already excludes `node_modules`, `.next`, and `.env`.

## 2. Create the Netlify site

1. [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project** → connect the GitHub repo you just pushed.
2. Build settings should auto-detect (`npm run build`, Next.js). Leave the publish directory as `.next` if asked.
3. Don't deploy yet — set environment variables first (next step), or the first build will fail on a missing `DATABASE_URL`.

## 3. Environment variables (Site settings → Environment variables)

Copy every key from `.env.example` into Netlify, split by context:

**Same in every context:**
| Key | Value |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `DATABASE_URL_UNPOOLED` | Neon direct/unpooled connection string |
| `FIELD_ENCRYPTION_KEY` | Generate a **new** one for this environment — don't reuse the local dev key. `python -c "import secrets, base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"`. Rotating this later makes every previously-stored `ee_id` undecryptable, so treat it as a real secret from day one, not something to regenerate casually. |
| `ADMIN_EMAILS` | Real bootstrap admin email(s) |
| `BLOB_STORE_NAME` | `fpa-control-tower` (or your choice — just stay consistent) |
| `MAX_UPLOAD_BYTES` | `10485760` |
| `NOTIFY_EMAIL_FROM` | `fpa-no-reply@idc.com` (unused until real email is built) |
| `NOTIFY_EMAIL_ENABLED` | `false` |
| `TZ` | `America/New_York` |

**Production only:**
| Key | Value |
|---|---|
| `ALLOW_DEV_AUTH` | `false` |

**Deploy Previews / Branch deploys** — already forced to `false` in `netlify.toml`, so you don't need to set `ALLOW_DEV_AUTH` per-context there; override only if you deliberately want a preview to allow dev sign-in for QA.

⚠️ **Real SSO still isn't wired up** (see README — this was deliberately deferred to your FDEs). If you set `ALLOW_DEV_AUTH=false` in production with no real SSO provider configured, **nobody will be able to sign in at all**. Until Azure AD (or whichever provider) lands, either:
- Keep `ALLOW_DEV_AUTH=true` in a *non-production* context (a branch deploy or a password-protected Netlify site) for internal review, or
- Hold off on a production cutover until SSO is in.

## 4. Netlify Blobs

Nothing to configure — it's zero-config once deployed. The first upload/attachment call auto-provisions the `fpa-control-tower` store. Locally, plain `npm run dev` **cannot** exercise blob-touching routes (uploads, attachments) — you need `netlify dev` instead (`netlify link` the site first), since blob credentials are only ambient in Netlify's own runtime.

## 5. Database branching for previews (recommended, not required for a first deploy)

The architecture doc recommends a Neon branch per deploy preview so preview traffic never touches real data. Neon's Netlify integration (via the Neon dashboard or the Netlify "Neon" extension) can wire this up automatically — each deploy preview gets its own `DATABASE_URL` pointing at a fresh branch. Skip this for now if you just want a first deploy working; add it before real users start filing real data through previews.

## 6. Deploy and smoke test

Once env vars are set, trigger a deploy. Then, mirroring `06-ARCHITECTURE-NETLIFY-NEON.md`'s own smoke test:

1. Confirm the site loads.
2. `POST /api/dev/sign-in` as your bootstrap admin (or however auth is wired by then) → `GET /api/me` shows `role: "admin"`.
3. Set and lock a Gate 1 target for a department.
4. Download the Gate 2 template, fill it, upload it, approve it.
5. Download the validation baseline, fill it, upload a version, approve it.
6. `GET /api/vcp/departments/:deptId` shows the right target/identified/delivered numbers.
7. Create, submit, screen, and approve an investment request; confirm the bucket draws down (`GET /api/inv/bucket`).
8. `GET /api/audit` and `GET /api/notifications` show a row for every step above.

## 7. Later

- Turn on `NOTIFY_EMAIL_ENABLED` only once the in-app feed above is verified end to end, and only once the email sender is actually built (still deferred — see conversation history).
- Real SSO integration (Azure AD) replaces `src/lib/auth/session.ts`'s dev cookie — see that file's comments for the exact swap point.
