-- Procurement Tracker — Phase 3 migration: optimistic locking
--
-- Run this in Supabase SQL Editor for an EXISTING project.
-- Unlike schema.sql, this migration does not delete your data.

alter table phones
  add column if not exists updated_at timestamptz not null default now();

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists phones_updated_at on phones;
create trigger phones_updated_at
  before update on phones
  for each row execute function touch_updated_at();

-- The app sends PATCH /phones?id=eq.<id>&updated_at=eq.<known timestamp>.
-- If another editor has saved first, this filter matches zero rows and the
-- browser preserves its local edit, marks a conflict, and asks for a refresh.
