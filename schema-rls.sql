-- ════════════════════════════════════════════════════════════════
--  Row-Level Security — AUD-002 and AUD-003
--
--  ⚠ READ THIS BEFORE RUNNING. This file will break the application
--    as it stands today, deliberately and immediately.
--
--  The app has no server of its own. It talks to PostgREST directly
--  with the project's anon key, which is shipped in the browser bundle
--  and readable by every visitor. Today's policies are
--  `using (true) with check (true)` on every table, so that key grants
--  unrestricted read, write and delete on all application data to
--  anyone who opens the page — and the role gates the app enforces run
--  in a place the user controls (AUD-002, AUD-003).
--
--  Closing that means the database has to be able to tell who is
--  asking. It cannot, until PIN login is replaced with Supabase Auth
--  (AUD-001 — "Batch C item 1" in the remediation plan). The policies
--  below are written against `auth.uid()`, so with the current PIN
--  client every one of them evaluates to false and:
--
--    • the login screen cannot read the users table, so nobody can
--      sign in at all;
--    • no phone can be read, written or deleted.
--
--  SO: apply this file ONLY once Supabase Auth is in place, and only
--  after reading the "Order of work" section below. There is a
--  rollback at the foot of this file.
--
--  Safe to re-run: every statement is idempotent.
-- ════════════════════════════════════════════════════════════════
--
--  ── Order of work ──────────────────────────────────────────────
--  1. Take a backup, and turn on Point-In-Time Recovery if the
--     project's plan offers it. Until now the open DELETE policy has
--     meant one bad actor or one bad script could empty both tables
--     with a single request and nothing would be recoverable. Do this
--     first regardless of whether you go on to apply the rest.
--  2. Replace the PIN login with Supabase Auth. Each row in `users`
--     needs its `auth_id` set to the matching `auth.users.id`.
--  3. Run section 1 of this file (the auth_id column and the helper
--     functions). It changes no behaviour on its own.
--  4. Backfill `auth_id` for every account, and verify with the query
--     in section 5. An account with a null `auth_id` can do nothing
--     once section 3 is applied, including signing in.
--  5. Run sections 2, 3 and 4 in one transaction. Verify. Roll back if
--     anything is wrong — the rollback restores the open policies, so
--     the app works again at the cost of being wide open.
--
--  ── What this can and cannot enforce ───────────────────────────
--  It CAN enforce, in the database, beyond the browser's reach:
--    • only a signed-in user reads anything;
--    • the users table — which holds credentials — is readable only by
--      its owner and by whoever holds manageUsers;
--    • only roles holding addPhone may insert a phone;
--    • only roles holding a phone-mutating permission may update one;
--    • only an admin may delete a phone, or write role_permissions.
--
--  It CANNOT enforce which FIELDS a role may change. Every save writes
--  the whole phone row, SKUs and sales entries included, as one JSONB
--  blob (AUD-004). So "Warehouse may set STP status but not the PO"
--  stays a browser-side rule: at the database level Warehouse either
--  may update the row or may not. Making that boundary real needs SKUs
--  and sales promoted to child tables — Phase 2, item 23. Until then,
--  do not describe field-level permissions as enforced.
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════
--  SECTION 1 — identity plumbing. Changes no behaviour on its own.
-- ════════════════════════════════════════════════════════════════

begin;

-- Links an application account to the Supabase Auth user that signs in
-- as it. Nullable so this can be added and backfilled before any policy
-- depends on it; once section 3 is applied, a null auth_id means the
-- account can do nothing at all.
alter table public.users
  add column if not exists auth_id uuid unique references auth.users(id) on delete set null;

create index if not exists users_auth_id_idx on public.users (auth_id);

-- The caller's application role, or null when the caller is anonymous or
-- has no application account.
--
-- security definer, because this reads `users` and is itself used in the
-- policies ON `users` — without it the policy would recurse. The empty
-- search_path is required: a definer function that resolves names
-- against the caller's search_path can be hijacked by a shadowing
-- object in a schema the caller controls.
create or replace function public.app_role()
returns text
language sql stable security definer set search_path = ''
as $$ select u.role from public.users u where u.auth_id = auth.uid() limit 1 $$;

-- Does the caller's role hold this permission? Reads the same
-- role_permissions table the Admin matrix edits, so the database follows
-- the matrix instead of hardcoding a second copy of the rules that would
-- drift from DEFAULT_PERMS in src/roles.js.
--
-- A role with no row, or a missing key, is denied: `->> key` yields null
-- and `is true` makes null false. Admin is granted manageUsers and reset
-- unconditionally, mirroring LOCKED_TO_ADMIN in src/roles.js — a bad
-- matrix edit must not be able to lock everyone out of the database the
-- way it must not lock them out of the app.
create or replace function public.has_perm(p_key text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when public.app_role() is null then false
    when public.app_role() = 'admin' and p_key in ('manageUsers', 'reset') then true
    else (select (rp.can ->> p_key)::boolean
          from public.role_permissions rp
          where rp.role = public.app_role()) is true
  end
$$;

-- Holds any permission that writes a phone row. Field-level permissions
-- cannot be expressed here — see "What this can and cannot enforce".
create or replace function public.may_write_phone()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_perm('editResearch') or public.has_perm('editSKUs')
      or public.has_perm('savePO')       or public.has_perm('updateSTP')
      or public.has_perm('setStpRequired') or public.has_perm('saveReceipt')
      or public.has_perm('saveListing')  or public.has_perm('logSales')
      or public.has_perm('archive')
$$;

revoke all on function public.app_role()         from public, anon;
revoke all on function public.has_perm(text)     from public, anon;
revoke all on function public.may_write_phone()  from public, anon;
grant execute on function public.app_role()        to authenticated;
grant execute on function public.has_perm(text)    to authenticated;
grant execute on function public.may_write_phone() to authenticated;

commit;


-- ════════════════════════════════════════════════════════════════
--  SECTION 2 — users. This table holds credentials.
--
--  AUD-003: the anon key could read every row, so every account's name,
--  role and PIN hash was downloadable by any visitor. AUD-001: those
--  hashes are djb2 over a 4-digit PIN, which is brute-forced instantly,
--  and the app compares them in the browser. Closing anon read does not
--  fix the weak hash — it removes the public list of targets.
--
--  Once Auth is in place the `pin` column is dead weight and should be
--  dropped; it is left alone here because the PIN client still reads it
--  until that cutover is complete.
-- ════════════════════════════════════════════════════════════════

begin;

alter table public.users enable row level security;
alter table public.users force row level security;   -- applies to the table owner too

drop policy if exists "anon full access users"        on public.users;
drop policy if exists "users read own or admin"       on public.users;
drop policy if exists "users managed by manageUsers"  on public.users;

-- You can see yourself; whoever holds manageUsers can see everyone.
create policy "users read own or admin" on public.users
  for select to authenticated
  using (auth_id = auth.uid() or public.has_perm('manageUsers'));

-- Creating, re-roling and deleting accounts is the manageUsers job. No
-- self-service: an account must not be able to promote itself, which the
-- browser-only check could not prevent.
create policy "users managed by manageUsers" on public.users
  for all to authenticated
  using (public.has_perm('manageUsers'))
  with check (public.has_perm('manageUsers'));

revoke all on public.users from anon;
grant select, insert, update, delete on public.users to authenticated;

commit;


-- ════════════════════════════════════════════════════════════════
--  SECTION 3 — phones. The business data.
--
--  AUD-003: `for all using (true) with check (true)` meant the public
--  anon key could read, alter and delete every phone, SKU, goods
--  receipt, sales entry, note, attachment and audit line.
-- ════════════════════════════════════════════════════════════════

begin;

alter table public.phones enable row level security;
alter table public.phones force row level security;

drop policy if exists "anon full access phones"    on public.phones;
drop policy if exists "phones read authenticated"  on public.phones;
drop policy if exists "phones insert addPhone"     on public.phones;
drop policy if exists "phones update writers"      on public.phones;
drop policy if exists "phones delete admin"        on public.phones;

-- Everyone signed in sees the whole pipeline. That is the business
-- reality — Sales needs to see what Procurement ordered — and it is the
-- app's existing behaviour, so no per-row read rule is invented here.
create policy "phones read authenticated" on public.phones
  for select to authenticated
  using (public.app_role() is not null);

create policy "phones insert addPhone" on public.phones
  for insert to authenticated
  with check (public.has_perm('addPhone'));

-- `using` gates which rows may be updated, `with check` what they may
-- become. Both are the same test: this is row-level, not field-level.
create policy "phones update writers" on public.phones
  for update to authenticated
  using (public.may_write_phone())
  with check (public.may_write_phone());

-- Deletion is irreversible and the app only does it from the admin reset
-- and the single-model delete. AUD-003 called out unrestricted DELETE as
-- the total-data-loss path; `reset` is locked to admin in src/roles.js.
create policy "phones delete admin" on public.phones
  for delete to authenticated
  using (public.has_perm('reset'));

revoke all on public.phones from anon;
grant select, insert, update, delete on public.phones to authenticated;

commit;


-- ════════════════════════════════════════════════════════════════
--  SECTION 4 — role_permissions. The rules themselves.
--
--  This was the most dangerous open table of the three: anyone could
--  rewrite the permission matrix and then hold every permission.
-- ════════════════════════════════════════════════════════════════

begin;

alter table public.role_permissions enable row level security;
alter table public.role_permissions force row level security;

drop policy if exists "anon full access role_permissions" on public.role_permissions;
drop policy if exists "roles readable by signed in"       on public.role_permissions;
drop policy if exists "roles written by manageUsers"      on public.role_permissions;

-- Readable by anyone signed in: the app needs the matrix to build its
-- own CAN table, and it reads it before it knows what the caller holds.
-- Knowing the rules is not a secret; being able to change them is.
create policy "roles readable by signed in" on public.role_permissions
  for select to authenticated
  using (public.app_role() is not null);

create policy "roles written by manageUsers" on public.role_permissions
  for all to authenticated
  using (public.has_perm('manageUsers'))
  with check (public.has_perm('manageUsers'));

revoke all on public.role_permissions from anon;
grant select, insert, update, delete on public.role_permissions to authenticated;

commit;


-- ════════════════════════════════════════════════════════════════
--  SECTION 5 — verification. Read-only; run after applying.
-- ════════════════════════════════════════════════════════════════

-- (a) No table should still carry an unconditional policy. Any row this
--     returns is a table still open to the anon key.
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true')
order by tablename, policyname;

-- (b) Every table that holds application data should report rls_enabled
--     and rls_forced true.
select c.relname as table_name,
       c.relrowsecurity  as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('users', 'phones', 'role_permissions',
                    'report_approvals', 'report_send_log')
order by c.relname;

-- (c) Accounts with no auth_id can do nothing, including sign in.
--     This must return no rows before section 3 is applied.
select id, name, role from public.users where auth_id is null order by id;

-- (d) There must be at least one admin, and it must be linked.
--     Compare with AUD-011: the app now refuses to demote the last
--     admin, but nothing stops the last admin's auth_id being cleared.
select count(*) as linked_admins
from public.users where role = 'admin' and auth_id is not null;


-- ════════════════════════════════════════════════════════════════
--  ROLLBACK — restores the open policies.
--
--  This puts the database back the way AUD-002/003 found it: the public
--  anon key regains unrestricted read, write and delete. Use it to get
--  a broken app working again while you fix the cutover, not as a
--  resting state. Uncomment the block to run it.
-- ════════════════════════════════════════════════════════════════

-- begin;
--
-- drop policy if exists "users read own or admin"      on public.users;
-- drop policy if exists "users managed by manageUsers" on public.users;
-- drop policy if exists "phones read authenticated"    on public.phones;
-- drop policy if exists "phones insert addPhone"       on public.phones;
-- drop policy if exists "phones update writers"        on public.phones;
-- drop policy if exists "phones delete admin"          on public.phones;
-- drop policy if exists "roles readable by signed in"  on public.role_permissions;
-- drop policy if exists "roles written by manageUsers" on public.role_permissions;
--
-- alter table public.users            no force row level security;
-- alter table public.phones           no force row level security;
-- alter table public.role_permissions no force row level security;
--
-- create policy "anon full access users"  on public.users  for all using (true) with check (true);
-- create policy "anon full access phones" on public.phones for all using (true) with check (true);
-- create policy "anon full access role_permissions"
--   on public.role_permissions for all using (true) with check (true);
--
-- grant select, insert, update, delete
--   on public.users, public.phones, public.role_permissions to anon;
--
-- commit;
