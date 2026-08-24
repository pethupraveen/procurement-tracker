# Procurement Tracker

A single-page React app for tracking phone-case procurement from first research
through to listings going live on the marketplaces. Built with Vite, deployed to
GitHub Pages, backed by Supabase.

**Live:** https://pethupraveen.github.io/procurement-tracker/

---

## Quick start

```bash
npm install
npm run dev        # Vite dev server
npm run build      # production build to dist/
npm run preview    # serve the built dist/
```

There is no test suite, linter, or type checking — `npm run build` is the only
automated check.

To talk to a database locally, create `.env.local` in the project root:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon or publishable key>
```

`.env.local` is gitignored. Without it the app starts on the Admin-only **DB
Setup** screen, where the same two values can be entered by hand and are then
kept in that browser's localStorage (`proc_tracker_sb`). A config saved in the
browser always wins over the build-time one.

## Database setup

`schema.sql` is the whole database — `users`, `phones` (most fields JSONB), a
`stage_summary` view, an `updated_at` trigger, and seed users. Run it in the
Supabase SQL editor.

> **Warning:** it drops the tables at the top. Running it against a populated
> project wipes production data.

The seeded PINs are djb2 hashes and must stay in sync with `hashPin()` in
`src/App.jsx`.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and
publishes `dist/` to GitHub Pages.

One-time setup:

1. **Settings → Pages → Source** → select **GitHub Actions**.
2. **Settings → Secrets and variables → Actions** → add two repository secrets,
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The workflow passes these
   into the build so visitors never see the DB Setup screen.

`vite.config.js` uses `base: "./"`, so the build works under the
`/procurement-tracker/` subpath without further changes.

### Security note

The Supabase key is embedded in the public JavaScript bundle — unavoidable for a
browser-only app on a public Pages site. `schema.sql` grants `anon` full access
via RLS, so anyone who finds the URL can read and write the database directly.
The name + PIN login is djb2 obfuscation, not security. If the data needs real
protection, tighten the RLS policies to require Supabase Auth.

## How it works

A **phone** walks a fixed pipeline, each stage carrying a `daysBeforeLaunch`
that every deadline, delay, and progress number is derived from:

| Stage | Days before launch | Meaning |
| --- | --- | --- |
| Research | 100 | Found the phone. Deciding if it's worth it. |
| Planned | 85 | Decided to buy. Covers and quantities chosen. |
| Ordered | 75 | Purchase order sent to the supplier. |
| Production | 60 | Supplier is manufacturing the covers. |
| Received | 25 | Stock arrived, checked, in the warehouse. |
| Live | 0 | Listed and selling on the marketplaces. |
| Un-Procurement | — | Looked at it, decided not to buy. Terminal, no deadlines. |

Each phone owns a flat `skus` array. Listing, STP, and goods receipt are all
per-SKU, never per-phone; each SKU carries its own material, unit count, receipt
state, and a listings map over the marketplaces (Flipkart, Amazon, Meesho,
Shopify).

**Nothing derived is ever stored.** `derive(model)` recomputes progress, delays,
stock, sales, and runway on every render, so persisted state can never disagree
with what's shown.

### Roles

| Role | Can move work into |
| --- | --- |
| `admin` | every stage |
| `procurement` | Research, Planned, Ordered, Un-Procurement |
| `warehouse` | Production, Received, Live |
| `catalog` | Live |
| `sales` | — (read and sales entry only) |

Stage changes route through three functions that are the single source of truth
— `gateBlock()` (is the data ready to leave this stage?), `advanceStatus()` (the
gate plus the role check) and `moveStatus()` (every move, forward or back).
Permissions live in the `ROLE_CAN_ADVANCE_TO` and `CAN` tables, not in
component-level conditionals.

### Views

`dashboard`, `board` (drag-and-drop pipeline), `table`, `calendar`, `orders` (PO
manager and bulk receive), `listing` (catalog queue), and `reports`. Dashboard
KPI cards drill through to other views with filters pre-applied.

## Shared-database constraint

Several people share one database and every save writes the whole phone row, so:

- `dbUpsertPhone()` reads the server's `updated_at` first and returns
  `{ conflict: true }` rather than clobbering a colleague's edit.
- `updatedAt` is a version stamp — read back after each write, never sent by the
  client.
- The app re-reads the whole dataset on window focus and every 90 seconds.

Any new write path must go through `persist()` and preserve this handling, or it
will silently overwrite other users' work.

## Layout

```
index.html
schema.sql            the entire database
vite.config.js
src/main.jsx          mounts App, nothing else
src/App.jsx           ~5100 lines: the whole app
CLAUDE.md             working notes for Claude Code
```

`src/App.jsx` is ordered by dependency — helpers → stages → data shapes →
derived values → permissions → DB layer → CSS → components → `App` — with
section banners (`/* ── N. TITLE ── */`) marking the boundaries. New code belongs
in its matching section. All CSS lives in one `CSS` template literal; colours are
CSS variables on `.app`, so light/dark is a single attribute swap. Icons come
from `lucide-react`.
