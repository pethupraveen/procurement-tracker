# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # deps
npm run dev        # Vite dev server
npm run build      # production build to dist/
npm run preview    # serve the built dist/
```

There is no test suite, no linter, and no type checking. `npm run build` is the only automated check.

Deployment: pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes `dist/` to GitHub Pages. `dist/` is gitignored but a stale copy is checked in; ignore it.

## Shape of the codebase

Effectively a single-file React app. `src/App.jsx` (~5100 lines) holds everything: helpers, domain rules, styles, every component, and the root `App`. `src/main.jsx` only mounts it. The file is deliberately ordered by dependency — helpers → stages → data shapes → derived values → permissions → DB layer → CSS → components → `App` — and section banners (`/* ── N. TITLE ── */`) mark the boundaries. Keep new code in its matching section rather than appending to the end.

All CSS lives in one template literal (`const CSS`) injected at the top of the render tree; colours are CSS variables on `.app` so light/dark is a single attribute swap. No CSS files, no styling library. Icons come from `lucide-react`.

## Domain model

A **phone** walks a fixed pipeline defined once in `STAGES`:

`research → planned → ordered → production → received → live`, plus the off-line terminal stage `unprocured`.

Each stage carries `daysBeforeLaunch`, and every deadline/delay/progress number is derived from it — `plannedDate()` counts back from the phone's launch date (floored at the day the phone was added), `delayOf()` compares plan to actual. Anything that walks the pipeline in order must read `PIPELINE` (non-terminal stages only), never `STAGES`, or `unprocured` gets mistaken for a further step.

A phone owns one flat `skus` array (`skuRow()`). Each SKU carries its own material, unit count, `stpStatus`, receipt state (`receiptState`/`receivedQty`), and a per-marketplace `listings` map over `MARKETPLACES`. Listing, STP, and goods receipt are all per-SKU, never per-phone. Sales are append-only entries on the phone, summarised by `salesSummary()`.

**Nothing derived is ever stored.** `derive(model)` recomputes progress, delays, stock, sales, and runway on every render, so persisted state cannot disagree with what's shown. Add new computed fields there, not to the stored row.

## Rules live in one place

Three functions are the single source of truth for stage changes, and the board's drag-and-drop, the Detail panel footer, the quick-advance button and the "needs my action" filter all route through them:

- `gateBlock(model)` — is the *data* ready to leave this stage? (SKU codes present, PO recorded, no rejected/unsent STP, every SKU receipt-confirmed and live on every marketplace). Returns a human reason or `null`.
- `advanceStatus(model, role)` — the data gate plus the role check, for a one-step forward move.
- `moveStatus(model, role, stageKey)` — every move, forward, backward, or to/from `unprocured`.

Permissions are two tables: `ROLE_CAN_ADVANCE_TO` (which stage a role may move work *into* — the role that owns a stage makes the move into it) and `CAN` (per-action field-edit rights). Roles: `admin`, `procurement`, `warehouse`, `catalog`, `sales`. New rules belong in these tables, not in component-level conditionals.

Auth is a name + PIN hashed with djb2 (`hashPin`) — obfuscation, not security. Sessions persist in localStorage for 12 hours.

## Persistence and the shared-database constraint

Supabase is called over the plain REST API with `fetch` — there is no `@supabase/supabase-js` dependency. The URL and anon key are entered at runtime through the Admin-only DB Setup screen and stored in localStorage (`proc_tracker_sb`); nothing is baked into the build. RLS policies in `schema.sql` grant anon full access, so the anon key is the only gate.

`schema.sql` is the whole database: `users`, `phones` (most fields JSONB), a `stage_summary` view, and a trigger that stamps `updated_at`. It **drops the tables at the top** — running it wipes production data. Its seeded PINs are djb2 hashes and must stay in sync with `hashPin` in `App.jsx`.

The critical constraint: every save writes the *whole* phone row, and several people share one database. So:

- `dbUpsertPhone()` reads the server's `updated_at` first and returns `{ conflict: true }` rather than clobbering a colleague's edit; `persist()` in `App` then reloads and tells the user to redo the edit.
- `updatedAt` travels in via `rowToPhone` but is deliberately omitted from `phoneToRow` — it is a version stamp, never written by the client. After a successful write the fresh stamp is read back and held in local state, or the next save from the same tab would conflict with itself.
- `App` re-reads the whole dataset on window focus and every 90s while visible.

Any new write path must go through `persist()` and preserve `updatedAt` handling, or it will silently overwrite other users' work.

Mutations follow one pattern throughout `App`: update `phones` via `setPhones`, wrap the changed phone in `withAudit(phone, session, "what happened")`, and call `persist()` with the updated row inside the same updater. The audit trail is capped at `AUDIT_CAP` entries.

## Views

`App` switches on a `view` string: `dashboard`, `board`, `table`, `calendar`, `orders` (PO manager + bulk receive), `listing` (catalog queue), `reports`. `navigate()` jumps to a view with filters pre-applied, which is how dashboard KPI cards drill through. Filters are one `EMPTY_FILTERS`-shaped object resolved in `passesFilters()`.
