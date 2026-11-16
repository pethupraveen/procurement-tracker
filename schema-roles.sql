-- ════════════════════════════════════════════════════════════════
--  Role permissions — run this on an EXISTING database.
--
--  Additive only: it creates nothing that is already there and drops
--  nothing. Safe to re-run. schema.sql is the from-scratch file; this
--  is the migration for a project that is already live.
--
--  Two things:
--    1. Lets the users table hold the new customer_care role.
--    2. Moves permissions out of the app bundle and into a table the
--       Admin > Permissions matrix edits.
--
--  If you skip this file the app still works — it falls back to the
--  permissions compiled into src/App.jsx (DEFAULT_PERMS).
-- ════════════════════════════════════════════════════════════════

-- ── 1. Widen the role check so customer_care is accepted ────────
alter table users drop constraint if exists users_role_check;
alter table users add  constraint users_role_check
  check (role in ('admin','procurement','warehouse','catalog','sales','customer_care'));

-- ── 2. The permissions table ────────────────────────────────────
--  can         — { "addPhone": true, "archive": false, ... }
--  advance_to  — the stages this role may move work INTO, e.g.
--                ["production","received","live"]. An empty array
--                means the role never moves anything along.
create table if not exists role_permissions (
  role        text         not null,
  label       text         not null,
  color       text         not null default 'var(--dim)',
  sort        int          not null default 0,
  can         jsonb        not null default '{}'::jsonb,
  advance_to  jsonb        not null default '[]'::jsonb,
  updated_at  timestamptz  not null default now(),

  constraint role_permissions_pkey primary key (role)
);

-- Same open policy the other tables already use. See the warning in
-- README.md: the anon key is public, so this is not a security
-- boundary — the app's role gates are enforced in the browser only.
alter table role_permissions enable row level security;
drop policy if exists "anon full access role_permissions" on role_permissions;
create policy "anon full access role_permissions"
  on role_permissions for all using (true) with check (true);

-- ── 3. Seed the six roles ───────────────────────────────────────
--  These mirror DEFAULT_PERMS in src/App.jsx. `do update` keeps the
--  labels and colours in step on a re-run but leaves `can` and
--  `advance_to` alone, so re-running never undoes edits made in the
--  Admin matrix.
insert into role_permissions (role, label, color, sort, can, advance_to) values
  ('admin', 'Admin', 'var(--bad)', 0,
   '{"addPhone":true,"archive":true,"editResearch":true,"editSKUs":true,"savePO":true,"updateSTP":true,"setStpRequired":true,"saveReceipt":true,"saveListing":true,"logSales":true,"manageUsers":true,"reset":true}'::jsonb,
   '["research","planned","ordered","production","received","live","unprocured"]'::jsonb),

  ('procurement', 'Procurement', 'var(--accent)', 1,
   '{"addPhone":true,"archive":true,"editResearch":true,"editSKUs":true,"savePO":true,"updateSTP":false,"setStpRequired":false,"saveReceipt":false,"saveListing":false,"logSales":false,"manageUsers":false,"reset":false}'::jsonb,
   '["research","planned","ordered","production","unprocured"]'::jsonb),

  ('warehouse', 'Warehouse', 'var(--warn)', 2,
   '{"addPhone":false,"archive":false,"editResearch":false,"editSKUs":false,"savePO":false,"updateSTP":true,"setStpRequired":false,"saveReceipt":false,"saveListing":false,"logSales":false,"manageUsers":false,"reset":false}'::jsonb,
   '["production"]'::jsonb),

  ('catalog', 'Catalog', 'var(--ok)', 3,
   '{"addPhone":true,"archive":false,"editResearch":false,"editSKUs":false,"savePO":false,"updateSTP":false,"setStpRequired":true,"saveReceipt":true,"saveListing":true,"logSales":false,"manageUsers":false,"reset":false}'::jsonb,
   '["production","received","live"]'::jsonb),

  ('sales', 'Sales', 'var(--dim)', 4,
   '{"addPhone":false,"archive":false,"editResearch":false,"editSKUs":false,"savePO":false,"updateSTP":false,"setStpRequired":false,"saveReceipt":false,"saveListing":false,"logSales":true,"manageUsers":false,"reset":false}'::jsonb,
   '[]'::jsonb),

  -- Customer Care files new models and otherwise only looks. Creating a
  -- phone always lands it in Research, and an empty advance_to means they
  -- cannot move it anywhere afterwards.
  ('customer_care', 'Customer Care', 'var(--role6)', 5,
   '{"addPhone":true,"archive":false,"editResearch":false,"editSKUs":false,"savePO":false,"updateSTP":false,"setStpRequired":false,"saveReceipt":false,"saveListing":false,"logSales":false,"manageUsers":false,"reset":false}'::jsonb,
   '[]'::jsonb)
on conflict (role) do update
  set label = excluded.label,
      color = excluded.color,
      sort  = excluded.sort;

-- ── 4. The Customer Care demo account ───────────────────────────
-- PIN 5555, djb2-hashed exactly as hashPin() in src/App.jsx does it.
-- Change it from Admin > Accounts before anyone real uses this.
insert into users (id, name, role, pin, avatar) values
  ('u6', 'Meena (Customer Care)', 'customer_care', 'yhspqd', 'M')
on conflict (id) do nothing;
