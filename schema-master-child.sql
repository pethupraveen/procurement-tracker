-- ════════════════════════════════════════════════════════════════
--  Master / child models — run this on an EXISTING database.
--
--  Additive only: one nullable column and one index. It drops
--  nothing, changes no existing row, and is safe to re-run.
--
--  WHY
--  Two phones can be the same handset under different names. A Vivo
--  V70 case fits a V70FE exactly, so ordering a case for each buys
--  the same stock twice. One model becomes the MASTER and the other
--  its CHILD:
--
--    * the master is ordered, produced and received, once;
--    * the child is never ordered and never receives goods;
--    * both are listed and tracked on every marketplace, because
--      each marketplace needs its own listing;
--    * the child's stock is the master's stock.
--
--  RUN THIS BEFORE DEPLOYING the build that introduces the feature.
--  The app omits master_id from a save while a model has no master,
--  so an un-migrated database keeps saving every existing model
--  normally — but the first attempt to link a child will fail on an
--  unknown column.
--
--  Dashboard -> SQL Editor -> New query -> Paste -> Run.
-- ════════════════════════════════════════════════════════════════

begin;

-- The master this model is a child of, or null when it is not a child.
--
-- on delete set null, not cascade: deleting a master must never delete the
-- child models with it. The child is a real phone with its own launch date
-- and its own marketplace listings; losing the link is recoverable, losing
-- the model is not.
alter table public.phones
  add column if not exists master_id integer
    references public.phones(id) on delete set null;

-- A model cannot be its own master. The chain rule — a child may not itself
-- be a master — is enforced in the application (masterLinkProblem in
-- src/rules.js), because expressing it here needs a trigger, and a trigger
-- that rejects a write the UI already prevents only turns a clear message
-- into a failed save.
alter table public.phones
  drop constraint if exists phones_master_not_self;
alter table public.phones
  add constraint phones_master_not_self check (master_id is null or master_id <> id);

-- Children are looked up by master on nearly every render.
create index if not exists phones_master_id_idx
  on public.phones (master_id) where master_id is not null;

commit;


-- ── Verification ────────────────────────────────────────────────
-- (a) The column and its constraint are in place.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'phones' and column_name = 'master_id';

-- (b) Current links, if any. A child's stage should never be ahead of its
--     master's, and a child should never carry a PO of its own.
select c.id, c.brand || ' ' || c.name as child, c.stage as child_stage, c.po as child_po,
       m.brand || ' ' || m.name as master, m.stage as master_stage
from public.phones c
join public.phones m on m.id = c.master_id
order by master, child;

-- (c) Nothing should appear here: a child whose master is itself a child.
select c.id, c.brand || ' ' || c.name as child
from public.phones c
join public.phones m on m.id = c.master_id
where m.master_id is not null;


-- ── Rollback ────────────────────────────────────────────────────
-- Drops the links as well as the column. Note the data loss: which model was
-- a child of which is not recorded anywhere else.
--
-- begin;
-- alter table public.phones drop constraint if exists phones_master_not_self;
-- drop index if exists public.phones_master_id_idx;
-- alter table public.phones drop column if exists master_id;
-- commit;
