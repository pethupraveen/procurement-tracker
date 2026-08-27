-- Procurement Tracker — compatibility migration for existing projects
--
-- Run once in Supabase: Dashboard → SQL Editor → New query → Paste → Run.
-- This does NOT delete phones, users, or any existing data.
--
-- Older project installations can be missing some of these fields. The app
-- writes a complete phone record, so the columns must exist before imports
-- and new-phone saves will work.

alter table phones
  add column if not exists po            text,
  add column if not exists done          jsonb   not null default '{}'::jsonb,
  add column if not exists skus          jsonb   not null default '[]'::jsonb,
  add column if not exists sales_entries jsonb   not null default '[]'::jsonb,
  add column if not exists notes         jsonb   not null default '[]'::jsonb,
  add column if not exists attachments   jsonb   not null default '[]'::jsonb,
  add column if not exists audit         jsonb   not null default '[]'::jsonb,
  add column if not exists archived      boolean not null default false,
  add column if not exists updated_at    timestamptz not null default now();

-- Allow the current terminal status while retaining the six normal stages.
alter table phones drop constraint if exists phones_stage_check;
alter table phones add constraint phones_stage_check
  check (stage in ('research','planned','ordered','production','received','live','unprocured'));

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists phones_updated_at on phones;
create trigger phones_updated_at
  before update on phones
  for each row execute function touch_updated_at();
