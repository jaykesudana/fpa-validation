-- ============================================================================
-- FP&A Control Tower — roster + department access seed
--
-- Ports the FBP roster and per-tower grants from 01-DOMAIN-AND-ROLES.md §1
-- so the gates, uploads, and investment-request mechanics can be exercised
-- end-to-end as different people before real SSO is wired in.
--
-- Email addresses are PLACEHOLDERS (firstname.lastname@idc.com) — the
-- domain doc names people but not addresses. Confirm the real ones before
-- go-live; today they're just the dev sign-in key (see /api/dev/sign-in).
-- ============================================================================

insert into users (email, name, role) values
  ('tina.pan@idc.com',            'Tina Pan',            'admin'),
  ('sumanth.ravulakollu@idc.com', 'Sumanth Ravulakollu', 'fbp'),
  ('margaret.yin@idc.com',        'Margaret Yin',        'fbp'),
  ('nick.bunnell@idc.com',        'Nick Bunnell',        'fbp'),
  ('pete.swallen@idc.com',        'Pete Swallen',        'fbp'),
  ('prabhat.gupta@idc.com',       'Prabhat Gupta',       'fbp'),
  ('jackie.cheng@idc.com',        'Jackie Cheng',        'fbp')
on conflict (email) do nothing;

-- VCP grants — gates-data.js → ASSIGNMENTS
insert into dept_access (user_id, department_id, tower)
select u.id, g.department_id, 'vcp'
from (values
  ('sumanth.ravulakollu@idc.com', 'custom'),
  ('sumanth.ravulakollu@idc.com', 'data-analytics'),
  ('sumanth.ravulakollu@idc.com', 'events'),
  ('sumanth.ravulakollu@idc.com', 'operations'),
  ('sumanth.ravulakollu@idc.com', 'research'),
  ('sumanth.ravulakollu@idc.com', 'customer-success'),
  ('sumanth.ravulakollu@idc.com', 'marketing'),
  ('sumanth.ravulakollu@idc.com', 'product-mktg'),
  ('sumanth.ravulakollu@idc.com', 'sales'),
  ('sumanth.ravulakollu@idc.com', 'product-dev'),

  ('margaret.yin@idc.com', 'custom'),
  ('margaret.yin@idc.com', 'data-analytics'),
  ('margaret.yin@idc.com', 'events'),
  ('margaret.yin@idc.com', 'operations'),
  ('margaret.yin@idc.com', 'research'),
  ('margaret.yin@idc.com', 'product-mktg'),
  ('margaret.yin@idc.com', 'product-dev'),

  ('nick.bunnell@idc.com', 'customer-success'),
  ('nick.bunnell@idc.com', 'marketing'),
  ('nick.bunnell@idc.com', 'sales'),

  ('pete.swallen@idc.com', 'custom'),
  ('pete.swallen@idc.com', 'data-analytics'),
  ('pete.swallen@idc.com', 'events'),
  ('pete.swallen@idc.com', 'operations'),
  ('pete.swallen@idc.com', 'research'),
  ('pete.swallen@idc.com', 'product-mktg'),
  ('pete.swallen@idc.com', 'product-dev'),

  ('prabhat.gupta@idc.com', 'customer-success'),
  ('prabhat.gupta@idc.com', 'marketing'),
  ('prabhat.gupta@idc.com', 'sales')
) as g(email, department_id)
join users u on lower(u.email) = g.email
on conflict do nothing;

-- Investment grants — investments-data.js → INV_ASSIGNMENTS (independent of VCP)
insert into dept_access (user_id, department_id, tower)
select u.id, g.department_id, 'inv'
from (values
  ('margaret.yin@idc.com', 'research'),
  ('margaret.yin@idc.com', 'data-analytics'),
  ('margaret.yin@idc.com', 'product-dev'),

  ('prabhat.gupta@idc.com', 'sales'),
  ('prabhat.gupta@idc.com', 'marketing'),

  ('pete.swallen@idc.com', 'product-dev'),
  ('pete.swallen@idc.com', 'research'),

  ('sumanth.ravulakollu@idc.com', 'events'),
  ('sumanth.ravulakollu@idc.com', 'operations'),
  ('sumanth.ravulakollu@idc.com', 'custom'),

  ('nick.bunnell@idc.com', 'marketing'),
  ('nick.bunnell@idc.com', 'customer-success')
) as g(email, department_id)
join users u on lower(u.email) = g.email
on conflict do nothing;
