-- ============================================================================
-- FP&A Control Tower — Neon Postgres schema
-- Run against a fresh Neon branch. Idempotent-ish: uses IF NOT EXISTS.
--
-- Design notes
--   • VCP and Investment data live in separate tables and never join on money.
--   • Money is stored in CENTS as bigint. Never use float for currency.
--   • Workbook uploads are append-only; line rows belong to an upload, not to
--     a department directly, so history is reconstructable.
--   • Actor names are denormalised onto history rows so they survive roster
--     changes.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────────────
do $$ begin
  create type user_role       as enum ('admin', 'fbp');
  create type tower           as enum ('vcp', 'inv', 'admin');
  create type upload_state    as enum ('review', 'locked', 'rejected');
  create type version_state   as enum ('pending', 'approved', 'rejected');
  create type line_frequency  as enum ('Run rate', 'One-time');
  create type line_status     as enum ('Identified', 'Confirmed', 'Not confirmed');
  create type req_status      as enum ('draft','submitted','screened','approved','rejected','returned','withdrawn');
  create type inv_type        as enum ('Headcount','Vendor','Capex','Program');
  create type region_code     as enum ('AMAS','EMEA','APAC');
exception when duplicate_object then null; end $$;

-- ── Identity & access ───────────────────────────────────────────────────────
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null,
  role          user_role not null default 'fbp',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists departments (
  id            text primary key,               -- slug, e.g. 'data-analytics'
  name          text not null unique,           -- 'Data & Analytics'
  l1            text not null,                  -- 'COGS' | 'S&M' | 'R&D' | 'G&A'
  summary_group text not null,                  -- 'RDI' | 'Sales' | ... | 'Other'
  sort_order    int  not null default 0,
  active        boolean not null default true
);

-- Per-tower department grants. A user may hold a department in one tower only.
create table if not exists dept_access (
  user_id       uuid not null references users(id) on delete cascade,
  department_id text not null references departments(id) on delete cascade,
  tower         tower not null check (tower in ('vcp','inv')),
  granted_by    uuid references users(id),
  granted_at    timestamptz not null default now(),
  primary key (user_id, department_id, tower)
);
create index if not exists dept_access_user_idx on dept_access(user_id, tower);

-- ── Catalogues (admin-editable; two SEPARATE initiative lists) ──────────────
create table if not exists vcp_initiatives (
  id          text primary key,                 -- 'ai', 'entity', ...
  name        text not null unique,
  sort_order  int not null default 0,
  active      boolean not null default true
);

create table if not exists inv_initiatives (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int not null default 0,
  active      boolean not null default true
);

create table if not exists lookup_values (
  kind        text not null,                    -- 'category' | 'country' | 'frequency' | 'line_status'
  value       text not null,
  sort_order  int not null default 0,
  primary key (kind, value)
);

-- ── Fiscal period ───────────────────────────────────────────────────────────
create table if not exists fiscal_years (
  id          text primary key,                 -- 'FY2026-27'
  label       text not null,                    -- 'FY2026–27'
  is_current  boolean not null default false
);

-- ============================================================================
-- VCP · Gate 1 — targets per department × initiative
-- ============================================================================
create table if not exists vcp_targets (
  id             uuid primary key default gen_random_uuid(),
  fiscal_year_id text not null references fiscal_years(id),
  department_id  text not null references departments(id),
  initiative_id  text not null references vcp_initiatives(id),
  target_cents   bigint not null default 0,
  locked         boolean not null default false,
  set_by_user_id uuid references users(id),
  set_by_name    text,
  set_at         timestamptz,
  unique (fiscal_year_id, department_id, initiative_id)
);

-- ============================================================================
-- VCP · Gate 2 — the identified baseline (one workbook per department)
-- ============================================================================
create table if not exists vcp_uploads (
  id                 uuid primary key default gen_random_uuid(),
  fiscal_year_id     text not null references fiscal_years(id),
  department_id      text not null references departments(id),
  file_name          text not null,
  storage_key        text not null,             -- original bytes in blob storage
  row_count          int  not null default 0,
  state              upload_state not null default 'review',
  uploaded_by        uuid references users(id),
  uploaded_by_name   text not null,
  uploaded_at        timestamptz not null default now(),
  approved_by        uuid references users(id),
  approved_by_name   text,
  approved_at        timestamptz,
  reject_note        text,
  superseded_by      uuid references vcp_uploads(id)
);
create index if not exists vcp_uploads_dept_idx on vcp_uploads(department_id, fiscal_year_id, state);

-- Exactly one locked baseline per department per fiscal year.
create unique index if not exists vcp_one_locked_baseline
  on vcp_uploads(fiscal_year_id, department_id)
  where state = 'locked' and superseded_by is null;

create table if not exists vcp_upload_rows (
  id               uuid primary key default gen_random_uuid(),
  upload_id        uuid not null references vcp_uploads(id) on delete cascade,
  row_no           int not null,                -- 1-based position in the file
  initiative_id    text not null references vcp_initiatives(id),
  dept_no          text,                        -- 'Dept #'
  name             text not null,
  category         text not null,
  ee_id            text,
  country          text,
  frequency        line_frequency not null default 'Run rate',
  target_date      date,
  identified_cents bigint not null default 0,
  notes            text
);
create index if not exists vcp_upload_rows_upload_idx on vcp_upload_rows(upload_id);
create index if not exists vcp_upload_rows_init_idx   on vcp_upload_rows(initiative_id);

create table if not exists vcp_evidence (
  id            uuid primary key default gen_random_uuid(),
  upload_id     uuid not null references vcp_uploads(id) on delete cascade,
  file_name     text not null,
  storage_key   text not null,
  size_bytes    bigint,
  mime_type     text,
  uploaded_by   uuid references users(id),
  uploaded_at   timestamptz not null default now()
);

-- ============================================================================
-- VCP · Gate 3 — rolling validation versions, each individually approved
-- ============================================================================
create table if not exists vcp_validations (
  id                     uuid primary key default gen_random_uuid(),
  fiscal_year_id         text not null references fiscal_years(id),
  department_id          text not null references departments(id),
  baseline_upload_id     uuid not null references vcp_uploads(id),
  version                int not null,
  file_name              text not null,
  storage_key            text not null,
  row_count              int not null default 0,
  validated_subtotal_cents bigint not null default 0,  -- excl. 'Not confirmed'
  state                  version_state not null default 'pending',
  uploaded_by            uuid references users(id),
  uploaded_by_name       text not null,
  uploaded_at            timestamptz not null default now(),
  approved_by            uuid references users(id),
  approved_by_name       text,
  approved_at            timestamptz,
  note                   text,
  unique (fiscal_year_id, department_id, version)
);
create index if not exists vcp_validations_dept_idx
  on vcp_validations(department_id, fiscal_year_id, state, version desc);

create table if not exists vcp_validation_rows (
  id               uuid primary key default gen_random_uuid(),
  validation_id    uuid not null references vcp_validations(id) on delete cascade,
  row_no           int not null,
  initiative_id    text not null references vcp_initiatives(id),
  dept_no          text,
  name             text not null,
  category         text not null,
  ee_id            text,
  country          text,
  frequency        line_frequency not null default 'Run rate',
  target_date      date,
  identified_cents bigint not null default 0,
  notes            text,
  status           line_status not null default 'Identified',
  validated_cents  bigint not null default 0,
  validated_date   date,
  status_update    text
);
create index if not exists vcp_validation_rows_v_idx on vcp_validation_rows(validation_id);

-- ============================================================================
-- Investment Requests
-- ============================================================================
create table if not exists inv_bucket (
  fiscal_year_id text primary key references fiscal_years(id),
  total_cents    bigint not null default 0,
  reserve_cents  bigint not null default 0,
  locked         boolean not null default true,
  note           text,
  set_by         uuid references users(id),
  set_by_name    text,
  set_at         timestamptz not null default now(),
  constraint reserve_inside_total check (reserve_cents < total_cents)
);

create sequence if not exists inv_request_ref_seq;

create table if not exists inv_requests (
  id                    uuid primary key default gen_random_uuid(),
  ref                   text not null unique,        -- 'INV-001'
  fiscal_year_id        text not null references fiscal_years(id),
  title                 text not null,
  department_id         text not null references departments(id),
  initiative_id         uuid references inv_initiatives(id),
  type                  inv_type not null default 'Headcount',
  country               text not null,
  region                region_code not null,        -- derived from country
  amount_cents          bigint not null default 0,
  phase_q1_cents        bigint not null default 0,
  phase_q2_cents        bigint not null default 0,
  phase_q3_cents        bigint not null default 0,
  phase_q4_cents        bigint not null default 0,
  expected_return_cents bigint not null default 0,
  payback               text,
  sponsor               text,
  exec_sponsor          text,
  business_case         text,
  risk                  text,
  status                req_status not null default 'draft',
  created_by            uuid references users(id),
  created_at            timestamptz not null default now(),
  submitted_by_name     text,
  submitted_at          timestamptz,
  screened_by_name      text,
  screened_at           timestamptz,
  screen_note           text,
  decided_by_name       text,                        -- 'CFO + ELT'
  decided_at            timestamptz,
  decision_note         text,
  approved_amount_cents bigint,
  constraint approved_not_more_than_requested
    check (approved_amount_cents is null or approved_amount_cents <= amount_cents)
);
create index if not exists inv_requests_dept_idx   on inv_requests(department_id, status);
create index if not exists inv_requests_init_idx   on inv_requests(initiative_id);
create index if not exists inv_requests_status_idx on inv_requests(fiscal_year_id, status);

create table if not exists inv_attachments (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references inv_requests(id) on delete cascade,
  file_name     text not null,
  storage_key   text not null,
  size_bytes    bigint,
  mime_type     text,
  uploaded_by   uuid references users(id),
  uploaded_at   timestamptz not null default now()
);
create index if not exists inv_attachments_req_idx on inv_attachments(request_id);

-- ============================================================================
-- Audit log — immutable, one row per mutation, written in the same transaction
-- ============================================================================
create table if not exists audit_log (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  actor_user_id uuid references users(id),
  actor_name    text not null,
  actor_role    user_role not null,
  tower         tower not null,
  entity_type   text not null,      -- 'target' | 'upload' | 'validation' | 'request' | 'bucket' | 'access' | ...
  entity_id     text,
  department_id text references departments(id),
  action        text not null,      -- see 01-DOMAIN-AND-ROLES.md §6
  from_state    text,
  to_state      text,
  note          text,
  payload       jsonb not null default '{}'::jsonb
);
create index if not exists audit_entity_idx on audit_log(entity_type, entity_id, at desc);
create index if not exists audit_dept_idx   on audit_log(department_id, at desc);
create index if not exists audit_actor_idx  on audit_log(actor_user_id, at desc);

-- Append-only guard
create or replace function audit_immutable() returns trigger as $$
begin raise exception 'audit_log is append-only'; end $$ language plpgsql;

drop trigger if exists audit_no_update on audit_log;
create trigger audit_no_update before update or delete on audit_log
  for each row execute function audit_immutable();

-- ============================================================================
-- Notifications — one row per recipient so read state is per-user
-- ============================================================================
create table if not exists notifications (
  id              bigserial primary key,
  tower           tower not null,             -- keep vcp / inv streams separate
  event           text not null,              -- 'target' | 'baseline' | 'approve' | 'submit' | 'screen' | ...
  at              timestamptz not null default now(),
  recipient_id    uuid not null references users(id) on delete cascade,
  is_cc           boolean not null default false,
  subject         text not null,
  body            text not null,
  link_kind       text,                       -- 'department' | 'request'
  link_ref        text,                       -- department id or request ref
  read_at         timestamptz,
  emailed_at      timestamptz,
  audit_id        bigint references audit_log(id)
);
create index if not exists notif_recipient_idx on notifications(recipient_id, tower, at desc);
create index if not exists notif_unread_idx on notifications(recipient_id, tower) where read_at is null;

-- ============================================================================
-- Convenience views (optional — the API may compute these instead)
-- ============================================================================

-- Latest approved validation version per department
create or replace view v_latest_approved_validation as
select distinct on (fiscal_year_id, department_id)
       id, fiscal_year_id, department_id, version, validated_subtotal_cents, approved_at
from vcp_validations
where state = 'approved'
order by fiscal_year_id, department_id, version desc;

-- Department target rollup
create or replace view v_dept_target as
select fiscal_year_id, department_id, sum(target_cents) as target_cents,
       bool_and(locked) as all_locked, bool_or(locked or target_cents > 0) as any_started
from vcp_targets group by 1, 2;

-- Investment rollup by department (approved vs in flight)
create or replace view v_inv_dept_rollup as
select fiscal_year_id, department_id,
       sum(case when status = 'approved'
                then coalesce(approved_amount_cents, amount_cents) else 0 end) as approved_cents,
       sum(case when status in ('submitted','screened') then amount_cents else 0 end) as pending_cents,
       count(*) filter (where status = 'approved')                    as approved_count,
       count(*) filter (where status in ('submitted','screened'))     as pending_count,
       count(*) filter (where status in ('approved','submitted','screened','rejected')) as request_count
from inv_requests group by 1, 2;

-- ============================================================================
-- Seed — catalogues only. NO transactional data (deliberate blank slate).
-- ============================================================================
insert into fiscal_years (id, label, is_current) values ('FY2026-27', 'FY2026–27', true)
  on conflict (id) do nothing;

insert into departments (id, name, l1, summary_group, sort_order) values
  ('custom',        'Custom',               'COGS', 'RDI',                  1),
  ('data-analytics','Data & Analytics',     'COGS', 'RDI',                  2),
  ('events',        'Events',               'COGS', 'Other',                3),
  ('operations',    'Operations',           'COGS', 'RDI',                  4),
  ('research',      'Research',             'COGS', 'RDI',                  5),
  ('exec',          'Executive Leadership', 'G&A',  'Executive Leadership', 6),
  ('finance',       'Finance',              'G&A',  'Finance',              7),
  ('hr',            'HR',                   'G&A',  'HR',                   8),
  ('it',            'IT',                   'G&A',  'IT',                   9),
  ('legal',         'Legal',                'G&A',  'Legal',               10),
  ('real-estate',   'Real Estate',          'G&A',  'Finance',             11),
  ('cto',           'CTO',                  'R&D',  'CTO',                 12),
  ('product-dev',   'Product Development',  'R&D',  'RDI',                 13),
  ('customer-success','Customer Success',   'S&M',  'Customer Success',    14),
  ('marketing',     'Marketing',            'S&M',  'Marketing',           15),
  ('product-mktg',  'Product Marketing',    'S&M',  'RDI',                 16),
  ('sales',         'Sales',                'S&M',  'Sales',               17)
  on conflict (id) do nothing;

insert into vcp_initiatives (id, name, sort_order) values
  ('ai',     'AI Automation',              1),
  ('entity', 'Entity Rationalization',     2),
  ('events', 'Events Productivity',        3),
  ('spans',  'Spans & Layers',             4),
  ('vendor', 'Vendor Long Tail',           5),
  ('erp',    'Post ERP/CPQ Optimization',  6),
  ('spend',  'Spend Custom Org',           7)
  on conflict (id) do nothing;

insert into inv_initiatives (name, sort_order) values
  ('Asia coverage expansion', 1),
  ('AI Automation',           2),
  ('Events modernization',    3),
  ('Data platform',           4),
  ('Demand generation',       5)
  on conflict (name) do nothing;

insert into lookup_values (kind, value, sort_order) values
  ('category','Revenue increase',1),('category','HC savings',2),
  ('category','Vendor elimination',3),('category','Process efficiency',4),
  ('category','Risk / compliance reduction',5),('category','HC reinvestment',6),
  ('category','Vendor reinvestment',7),('category','Implementation',8),
  ('frequency','Run rate',1),('frequency','One-time',2),
  ('line_status','Identified',1),('line_status','Confirmed',2),('line_status','Not confirmed',3)
  on conflict do nothing;

-- Country list (workbook + investment request pickers)
insert into lookup_values (kind, value, sort_order)
select 'country', c, ord from unnest(array[
  'US','Australia','China','Hong Kong','India','Indonesia','Japan','Korea','Malaysia',
  'New Zealand','Philippines','Singapore','Taiwan','Thailand','Austria','Belgium',
  'Bulgaria','Czech Republic','Denmark','Egypt','France','Germany','Greece','Hungary',
  'Ireland','Israel','Italy','Kazakhstan','Kenya','Netherlands','Nigeria','Poland',
  'Portugal','Romania','Russia','Saudi Arabia','Serbia','South Africa','Spain','Sweden',
  'Turkey','UAE','UK','Ukraine','Argentina','Brazil','Chile','Mexico','Peru','Canada'
]) with ordinality as t(c, ord)
on conflict do nothing;

-- Bucket starts at the board-approved FY27 pool (admin can change it in-app).
insert into inv_bucket (fiscal_year_id, total_cents, reserve_cents, locked, note, set_by_name)
values ('FY2026-27', 1400000000, 250000000, true,
        'Board-approved investment pool for the FY27 planning round.', 'Tina Pan (Central FP&A)')
  on conflict (fiscal_year_id) do nothing;

-- Roster + grants: create these via the app's access-management screen, or seed
-- from 01-DOMAIN-AND-ROLES.md §1 once the users exist in your identity provider.
