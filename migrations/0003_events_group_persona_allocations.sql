-- ============================================================================
-- Migration 0003
--   1. Events becomes its own Summary group instead of falling into "Other".
--   2. Jayke Sudana (fbp) — a distinct test persona from the jsudana@idc.com
--      admin bootstrap login, so both the admin and a scoped-partner view can
--      be exercised. Placeholder email matching the roster's
--      firstname.lastname convention (see 0002) — confirm before this
--      represents a real second person.
--   3. Investment bucket allocations — earmarks portions of the FY pool to
--      specific departments, so "pool / unallocated" can be scoped to what's
--      actually assigned to the departments a viewer can see, rather than
--      always showing the whole company-wide pool. Extends beyond the
--      original 04-DATA-MODEL.sql per an explicit follow-up request.
-- ============================================================================

update departments set summary_group = 'Events' where id = 'events';

insert into users (email, name, role) values
  ('jayke.sudana@idc.com', 'Jayke Sudana', 'fbp')
on conflict (email) do nothing;

insert into dept_access (user_id, department_id, tower)
select u.id, g.department_id, 'vcp'
from (values ('cto'), ('exec'), ('finance'), ('hr'), ('it'), ('legal'), ('real-estate')) as g(department_id)
join users u on u.email = 'jayke.sudana@idc.com'
on conflict do nothing;

insert into dept_access (user_id, department_id, tower)
select u.id, g.department_id, 'inv'
from (values ('cto'), ('exec'), ('finance'), ('hr'), ('it'), ('legal'), ('real-estate')) as g(department_id)
join users u on u.email = 'jayke.sudana@idc.com'
on conflict do nothing;

create table if not exists inv_bucket_allocations (
  fiscal_year_id  text not null references fiscal_years(id),
  department_id   text not null references departments(id),
  allocated_cents bigint not null default 0,
  set_by          uuid references users(id),
  set_by_name     text,
  set_at          timestamptz not null default now(),
  primary key (fiscal_year_id, department_id)
);
