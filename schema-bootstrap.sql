-- ═══════════════════════════════════════════════════════════════
-- Procurement Tracker — NON-DESTRUCTIVE bootstrap
--
-- Run this on a project that may already hold data. It creates what is
-- missing and leaves everything that already exists exactly as it is:
-- no drops, no truncates, and no overwriting of live user accounts.
--
-- Use schema.sql instead ONLY when you intend to wipe the database and
-- start again. That file begins by dropping the phones and users tables.
--
-- Dashboard → SQL Editor → New query → Paste → Run.
-- Then run schema-roles.sql to add the role_permissions table.
-- ═══════════════════════════════════════════════════════════════

-- ── Users ──────────────────────────────────────────────────────
create table if not exists users (
  id          text        not null,
  name        text        not null,
  role        text        not null check (role in ('admin','procurement','warehouse','catalog','sales','customer_care')),
  pin         text        not null,
  avatar      text        not null default 'U',
  created_at  timestamptz not null default now(),

  constraint users_pkey primary key (id)
);

-- ── Phones ─────────────────────────────────────────────────────
create table if not exists phones (
  id            integer     not null,
  brand         text        not null,
  name          text        not null,
  segment       text        not null default 'Mid Range',
  launch        date        not null,
  stage         text        not null default 'research'
                check (stage in ('research','planned','ordered','production','received','live','unprocured')),
  po            text,
  done          jsonb       not null default '{}'::jsonb,
  skus          jsonb       not null default '[]'::jsonb,
  sales_entries jsonb       not null default '[]'::jsonb,
  notes         jsonb       not null default '[]'::jsonb,
  attachments   jsonb       not null default '[]'::jsonb,
  audit         jsonb       not null default '[]'::jsonb,
  archived      boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint phones_pkey primary key (id)
);

-- ── Optimistic-lock version stamp ───────────────────────────────
-- updated_at is the version token. The app updates a phone only while the
-- timestamp it loaded still matches; a zero-row PATCH is a conflict, never
-- a permitted last-write-wins overwrite. Without this trigger the token
-- never moves and concurrent edits silently overwrite each other.
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists phones_updated_at on phones;
create trigger phones_updated_at
  before update on phones
  for each row execute function touch_updated_at();

-- ── Row-Level Security ──────────────────────────────────────────
-- WARNING: these policies allow anyone holding the project's anon key —
-- which is shipped in the browser bundle and readable by every visitor —
-- to read, change and delete every row in both tables. They exist because
-- the application has no server of its own and no authenticated identity
-- the database can check. See audit findings AUD-002 and AUD-003.
-- Do not put commercially sensitive data behind them.
alter table users  enable row level security;
alter table phones enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where tablename = 'users' and policyname = 'anon full access users') then
    create policy "anon full access users" on users for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies
                 where tablename = 'phones' and policyname = 'anon full access phones') then
    create policy "anon full access phones" on phones for all using (true) with check (true);
  end if;
end $$;

-- ── Default users, only on a genuinely empty table ──────────────
-- schema.sql seeds these with `on conflict do update`, which resets the PIN
-- of a live account that happens to share an id. Here they are inserted only
-- when no account exists at all, so running this file against a working
-- database cannot change anyone's credentials.
--
-- PINs hashed with djb2, matching the app's hashPin():
--   admin=1234  procurement=1111  warehouse=2222  catalog=3333
--   sales=4444  customer_care=5555
-- Change every one of them before anybody relies on this database.
insert into users (id, name, role, pin, avatar)
select * from (values
  ('u1', 'Arjun (Admin)',        'admin',         'yhvold', 'A'),
  ('u2', 'Priya (Procurement)',  'procurement',   'yhvpdx', 'P'),
  ('u3', 'Ravi (Warehouse)',     'warehouse',     'yhwepx', 'R'),
  ('u4', 'Sunita (Catalog)',     'catalog',       'yhx77p', 'S'),
  ('u5', 'Kiran (Sales)',        'sales',         'yhrx8l', 'K'),
  ('u6', 'Meena (Customer Care)','customer_care', 'yhspqd', 'M')
) as seed(id, name, role, pin, avatar)
where not exists (select 1 from users);
