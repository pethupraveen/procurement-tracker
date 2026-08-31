-- Procurement Tracker — Auth migration: profiles and authenticated-only access
--
-- Run once in Supabase: Dashboard → SQL Editor → New query → Paste → Run.
-- This does NOT delete phones, users, or any existing data. It is safe to
-- re-run: every statement is idempotent.
--
-- What it does:
--   1. Creates `profiles`, keyed to auth.users(id), holding the display name,
--      avatar, and application role. Roles now live server-side instead of in
--      browser-editable data.
--   2. Creates `profile_allowlist`, the approved email → role mapping. Only an
--      allowlisted Auth user ever gets a profile, so an Auth account created by
--      mistake cannot open the tracker.
--   3. Removes anonymous access from `phones` and the `stage_summary` view,
--      grants the app's data access to authenticated callers, and keeps legacy
--      `users` (which contains PIN hashes) inaccessible to every client.
--
-- Before running: confirm the four email addresses in the allowlist seed below
-- are the real addresses of the four people. Create the matching Auth users in
-- the Dashboard afterwards — see AUTH-SETUP.md for the full procedure.
--
-- Sequencing: once this runs, the public key alone can no longer read or write
-- the database. A browser still running an older build — the one that signed in
-- with a name and a PIN — loses access until it loads the Auth sign-in build.

-- ── Approved accounts ───────────────────────────────────────────────────────
-- The source of truth for who may hold a profile, and with which role. Sales is
-- intentionally excluded: no Sales account is approved for the Auth cutover.
-- The seed is insert-only, so re-running this migration preserves intentional
-- Dashboard edits to existing allowlist rows.
create table if not exists public.profile_allowlist (
  email       text        not null,
  name        text        not null,
  role        text        not null check (role in ('admin','procurement','warehouse','catalog','sales')),
  avatar      text        not null default 'U',
  created_at  timestamptz not null default now(),

  constraint profile_allowlist_pkey primary key (email)
);

insert into public.profile_allowlist (email, name, role, avatar) values
  ('vikram@sprig.store',   'Vikram',   'admin',       'V'),
  ('praveen@sprig.store',  'Praveen',  'procurement', 'P'),
  ('krishna@sprig.store',  'Krishna',  'warehouse',   'K'),
  ('yabinesh@sprig.store', 'Yabinesh', 'catalog',     'Y')
on conflict (email) do nothing;

-- ── Profiles ────────────────────────────────────────────────────────────────
-- One row per approved Auth user. `id` is the Auth user id, so a profile cannot
-- outlive its account and a caller cannot claim a role that is not theirs.
create table if not exists public.profiles (
  id          uuid        not null references auth.users (id) on delete cascade,
  name        text        not null,
  role        text        not null check (role in ('admin','procurement','warehouse','catalog','sales')),
  avatar      text        not null default 'U',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_pkey primary key (id)
);

-- Shared with `phones`; created here too so this migration can run against a
-- project that has not had the other migrations applied.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── Profile creation for approved Auth users ────────────────────────────────
-- Runs when the Admin adds a user in the Dashboard. A non-allowlisted account
-- is left without a profile on purpose: it can authenticate, but it has no role
-- and the app has nothing to let it in with.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare approved public.profile_allowlist%rowtype;
begin
  select * into approved
  from public.profile_allowlist
  where lower(email) = lower(new.email);

  if not found then
    return new;
  end if;

  insert into public.profiles (id, name, role, avatar)
  values (new.id, approved.name, approved.role, approved.avatar)
  on conflict (id) do nothing;

  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Backfill for approved accounts that already exist. `do nothing` keeps a role
-- that was adjusted after provisioning: to change a role, update `profiles`
-- (and this allowlist) rather than re-running the migration.
insert into public.profiles (id, name, role, avatar)
select u.id, a.name, a.role, a.avatar
from auth.users u
join public.profile_allowlist a on lower(a.email) = lower(u.email)
on conflict (id) do nothing;

-- ── Row-Level Security ──────────────────────────────────────────────────────
alter table public.profile_allowlist enable row level security;
alter table public.profiles          enable row level security;
alter table public.phones            enable row level security;
alter table public.users             enable row level security;

-- Anonymous callers lose every path to the data.
drop policy if exists "anon full access phones" on public.phones;
drop policy if exists "anon full access users"  on public.users;

revoke all on public.phones            from anon;
revoke all on public.users             from anon;
revoke all on public.profiles          from anon;
revoke all on public.profile_allowlist from anon;

-- The allowlist has no policy at all: it is configuration, reachable only from
-- the Dashboard and from the service-role key the Edge Function uses.
revoke all on public.profile_allowlist from authenticated;

-- Profiles are readable by any signed-in user — the app shows colleagues' names
-- and avatars on audit entries — and writable by no client. Roles are set by
-- the allowlist trigger or by an Admin in the Dashboard.
drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);

grant select on public.profiles to authenticated;

-- The tracker data. Every signed-in user may read and write it.
--
-- This is not a per-transition authorization boundary: it does not enforce that
-- only Catalog receives stock or only Procurement assigns a PO. Those gates are
-- still frontend-only and need a server-side command/RPC design. This migration
-- removes anonymous access; it does not complete stage-level authorization.
drop policy if exists "phones full access authenticated" on public.phones;
create policy "phones full access authenticated"
  on public.phones for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.phones to authenticated;

-- The legacy name/PIN roster remains in place for an eventual managed cleanup,
-- but PIN hashes must never reach a browser client. Remove every policy that
-- could apply to a client (including prior public or authenticated policies)
-- and every
-- authenticated table privilege. With RLS enabled and no policies, REST callers
-- cannot read or write this table.
do $$
declare policy_name text;
begin
  for policy_name in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and roles && array['public'::name, 'authenticated'::name]
  loop
    execute format('drop policy if exists %I on public.users', policy_name);
  end loop;
end; $$;

revoke all on public.users from authenticated;

-- ── Stage summary view ──────────────────────────────────────────────────────
-- A view runs with its owner's rights unless told otherwise, which would let it
-- read `phones` straight past the policies above. `security_invoker` closes
-- that; on Postgres versions that lack it, revoking `anon` is the fallback.
do $$
begin
  if exists (
    select 1 from pg_views where schemaname = 'public' and viewname = 'stage_summary'
  ) then
    begin
      execute 'alter view public.stage_summary set (security_invoker = on)';
    exception when others then
      raise notice 'stage_summary: security_invoker unavailable on this Postgres version; relying on the anon revoke below';
    end;
    execute 'revoke all on public.stage_summary from anon';
    execute 'grant select on public.stage_summary to authenticated';
  end if;
end; $$;
