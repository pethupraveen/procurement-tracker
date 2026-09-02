-- ═══════════════════════════════════════════════════════════════
-- Procurement Tracker — Supabase Schema  (v3 — fixed upsert)
--
-- Run this entire file in the Supabase SQL Editor:
-- Dashboard → SQL Editor → New query → Paste → Run
-- ═══════════════════════════════════════════════════════════════

-- ── Drop everything cleanly ─────────────────────────────────────
drop view  if exists stage_summary;
drop table if exists phones  cascade;
drop table if exists users   cascade;

-- ── Users ──────────────────────────────────────────────────────
create table users (
  id          text        not null,
  name        text        not null,
  role        text        not null check (role in ('admin','procurement','warehouse','catalog','sales')),
  pin         text        not null,
  avatar      text        not null default 'U',
  created_at  timestamptz not null default now(),

  constraint users_pkey primary key (id)
);

-- ── Phones ─────────────────────────────────────────────────────
create table phones (
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

-- Auto-update updated_at
-- This timestamp is also the optimistic-lock version token. The app updates a
-- phone only when the timestamp it originally loaded still matches; a zero-row
-- PATCH is a conflict, never a permitted last-write-wins overwrite.
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger phones_updated_at
  before update on phones
  for each row execute function touch_updated_at();

-- ── Row-Level Security ──────────────────────────────────────────
alter table users  enable row level security;
alter table phones enable row level security;

create policy "anon full access users"  on users  for all using (true) with check (true);
create policy "anon full access phones" on phones for all using (true) with check (true);

-- ── Stage summary view ──────────────────────────────────────────
create or replace view stage_summary as
select
  stage,
  count(*)                                             as phone_count,
  sum(jsonb_array_length(skus))                        as sku_count,
  coalesce(sum((
    select sum((v->>'units')::int)
    from jsonb_array_elements(skus) v
  )), 0)                                               as total_units
from phones
where not archived
group by stage
order by array_position(
  array['research','planned','ordered','production','received','live','unprocured'], stage);

-- ── Default users ───────────────────────────────────────────────
-- PINs hashed with djb2 (same as the app):
--   admin=1234  procurement=1111  warehouse=2222  catalog=3333  sales=4444
insert into users (id, name, role, pin, avatar) values
  ('u1', 'Arjun (Admin)',       'admin',       '1vnp9v', 'A'),
  ('u2', 'Priya (Procurement)', 'procurement', '11ky2l', 'P'),
  ('u3', 'Ravi (Warehouse)',    'warehouse',   '11kp2h', 'R'),
  ('u4', 'Sunita (Catalog)',    'catalog',     '11kq2i', 'S'),
  ('u5', 'Kiran (Sales)',       'sales',       '11kr2j', 'K')
on conflict (id) do update
  set name   = excluded.name,
      role   = excluded.role,
      pin    = excluded.pin,
      avatar = excluded.avatar;
