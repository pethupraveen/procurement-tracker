# Procurement Tracker

> A shared workspace for taking a phone-case range from market research to a live marketplace listing.

[Open the live app](https://procurement-tracker-tau.vercel.app)

## At a glance

~~~mermaid
flowchart LR
    R[Research<br/>Is this phone worth buying?]
    P[Planned<br/>Choose SKUs and quantities]
    O[Ordered<br/>Record the purchase order]
    PR[Production<br/>Manage required STP files]
    RE[Received<br/>Confirm stock received]
    L[Live<br/>Listed on every marketplace]
    U[Un-Procurement<br/>Decided not to buy]

    R --> P --> O --> PR --> RE --> L
    R -. stop procurement .-> U
    U -. revisit .-> R
~~~

The tracker is a single-page React application built with Vite. It stores shared
procurement data in Supabase and deploys automatically to Vercel.

## What it tracks

~~~mermaid
flowchart TD
    Phone[Phone model<br/>Brand, model, launch date, stage]
    SKU[SKU<br/>Code, material, quantity]
    PO[Purchase order<br/>PO number and supplier order]
    STP[STP file<br/>Requirement and status]
    Receipt[Goods receipt<br/>Received quantity and confirmation]
    Listing[Marketplace listing<br/>Flipkart, Amazon, Meesho, Shopify]
    Sales[Sales and stock<br/>Sales entries, runway, low-stock signals]

    Phone --> SKU
    Phone --> PO
    SKU --> STP
    SKU --> Receipt
    SKU --> Listing
    SKU --> Sales
~~~

A model can have many SKUs. Receiving, STP, and listing data are recorded per
SKU, so one colour or material can be delayed without hiding the rest of the
range.

## Workflow gates

The app does not let a model advance until its current stage is ready.

| Move | Required before the move |
| --- | --- |
| Research -> Planned | Decision to procure the phone model |
| Planned -> Ordered | At least one SKU and a code for every SKU |
| Ordered -> Production | A PO number |
| Production -> Received | At least one SKU; all required STP files sent; no required STP file rejected |
| Received -> Live | Every SKU received and live on Flipkart, Amazon, Meesho, and Shopify |

<code>Un-Procurement</code> is an off-ramp for models that are not worth buying.
It keeps the research record but removes the model from deadline tracking.

## Who does what

~~~mermaid
flowchart LR
    Procurement[Procurement] -->|Research, SKUs, PO,<br/>move to production| Production[Production]
    Warehouse[Warehouse] -->|Move to production<br/>and update STP status| Production[Production]
    Catalog[Catalog] -->|Decide STP requirement,<br/>receive stock, list SKUs| Live[Live]
    Sales[Sales] -->|Record sales| Metrics[Sales and stock metrics]
    Admin[Admin] -->|Manage every stage and users| All[All workflow work]
~~~

| Role | Main responsibilities |
| --- | --- |
| Admin | Full workflow access, user management, and reset/configuration actions |
| Procurement | Create models, research, maintain SKUs, assign POs, and move work through planned, ordered, and production stages |
| Warehouse | Move models into production and update supplier STP-file status |
| Catalog | Create models, decide whether an STP file is required, receive stock, maintain listings, and move work from production to received to live |
| Sales | Record sales and review stock/sales information |

## Screens

| Screen | Use it for |
| --- | --- |
| Dashboard | See progress, blockers, deadlines, low stock, and links to the next action |
| Board | Drag models through the procurement pipeline |
| Table | Review and filter all models in a compact list |
| Calendar | See model launches and target completion dates |
| Planning | Move the research list to Planned in one pass, and generate SKU codes across several Planned models |
| Orders | Assign and review POs; bulk-confirm received stock |
| Inward stock | Record SKU receipts and choose STP requirements by model and material |
| Listing | Work through the per-SKU marketplace listing queue |
| Reports | Export procurement, STP, listing, and sales reports |

## How data stays consistent

~~~mermaid
sequenceDiagram
    participant User
    participant App as React app
    participant DB as Supabase
    participant Other as Other user

    User->>App: Edit a model
    App->>DB: Read current updated_at version
    DB-->>App: Current version
    alt No newer edit exists
        App->>DB: Save changed phone row
        DB-->>App: Updated row and version
    else Another user saved first
        DB-->>App: Conflict
        App-->>User: Ask user to reload before editing
    end
    Other->>DB: Make a separate edit
    App->>DB: Refresh on window focus and every 90 seconds
~~~

Every save uses an <code>updated_at</code> version check before writing. This
prevents one person's browser from silently overwriting a colleague's newer
changes. The app refreshes when it regains focus and every 90 seconds only when
no detail editor or unresolved save conflict is open; manual refresh remains
available when the user is ready to discard local drafts and reload.

Progress, delays, stock, sales, and runway are calculated from the saved model
data on every render rather than stored separately.

## Architecture

~~~mermaid
flowchart TB
    Browser[Browser]
    App[src/App.jsx<br/>UI, permissions, workflow gates,<br/>derived metrics, Supabase access]
    Entry[src/main.jsx<br/>Mounts the app]
    DB[(Supabase<br/>users + phones + stage_summary)]
    Schema[schema-bootstrap.sql<br/>Tables, trigger, seed users]
    CI[GitHub Actions<br/>check + build]
    Deploy[Vercel<br/>main to production,<br/>branches to previews]

    Browser --> App
    Entry --> App
    App <--> DB
    Schema --> DB
    App --> CI
    App --> Deploy
~~~

| Location | Purpose |
| --- | --- |
| <code>src/App.jsx</code> | The application: UI, business rules, permissions, derived data, and database calls |
| <code>src/main.jsx</code> | React entry point |
| <code>src/sku.js</code> | The SKU code tables and formula, generated from the workbook. Do not hand-edit |
| <code>Excel_SKU_Gen/</code> | The SKU workbook these codes come from, and <code>refresh-sku-codes.py</code>, which rewrites <code>src/sku.js</code> from it |
| <code>schema.sql</code> | Full Supabase schema, view, trigger, and seed users. <strong>Drops the tables first</strong> |
| <code>schema-bootstrap.sql</code> | Non-destructive version of the above: creates only what is missing |
| <code>schema-roles.sql</code> | The <code>role_permissions</code> table behind the admin matrix |
| <code>schema-master-child.sql</code> | Adds <code>phones.master_id</code> for models that share a case |
| <code>schema-phase3.sql</code> | Additional database migration script |
| <code>schema-compatibility.sql</code> | Compatibility migration script |
| <code>schema-report-approval.sql</code> | Approval and send-log tables for the emailed STP report |
| <code>supabase/functions/</code> | Two Edge Functions: request an approval code, send the approved report |
| <code>.github/workflows/ci.yml</code> | Runs <code>npm ci</code>, <code>npm run check</code> and <code>npm run build</code> on every push. The only workflow — deployment is Vercel's, not this repository's |

## Run locally

~~~bash
npm install
npm run dev
~~~

Other useful commands:

~~~bash
npm run build    # Build production files into dist/
npm run preview  # Serve the built files locally
~~~

There is no test suite, linter, or type checker currently. <code>npm run build</code>
is the available automated verification step.

## Connect Supabase

Create <code>.env.local</code> in the project root:

~~~dotenv
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
~~~

Without these values, the app opens the Admin-only **DB Setup** screen. The
same values can be entered there and stored in that browser's local storage.

### Pointing one browser at a different project

`.env.local` and the GitHub Actions secrets configure every visitor, so
<code>npm run dev</code> talks to whatever project they name — in this
repository, the same one the live site uses. **Local development is therefore
production access by default.** Anything destructive you try locally, a bulk
receive or a reset, lands on real rows.

To work against a throwaway project instead, without touching `.env.local` or
anyone else's machine:

1. Create a second Supabase project, then run
   [schema-bootstrap.sql](schema-bootstrap.sql),
   [schema-roles.sql](schema-roles.sql) and, if you need the emailed report,
   [schema-report-approval.sql](schema-report-approval.sql) on it.
2. Sign in as an admin and press the **⚙** button in the header.
3. Paste the test project's URL and anon key, **Test connection**, then
   **Save and continue**.

A config saved in a browser always beats the build-time values, so only that
browser moves. While one is in force the header shows a **⚠ project-ref** pill
next to the connection dot — if you do not see it, you are on the shipped
project, which is to say production. **↩ Back to _ref_** on the same screen
discards the override and returns that browser to the build's own project.

The pill shows the project ref only, never a key.

To create the database, run [schema-bootstrap.sql](schema-bootstrap.sql) in the
Supabase SQL editor, then [schema-roles.sql](schema-roles.sql). Use
[schema.sql](schema.sql) only to wipe an existing database and start again.

> Warning: <code>schema.sql</code> drops its tables before recreating them. Do
> not run it against a populated production database.

## Master and child models

Two phones can be the same handset under different names. A Vivo V70 case fits
a V70FE exactly, so ordering a case for each buys the same stock twice. Mark
one model the **master** and the other its **child**:

- the master is ordered, produced and received — **once**;
- the child is never ordered, never carries a PO and never receives goods;
- **both** are listed and tracked on every marketplace, because each
  marketplace needs its own listing;
- the child's stock **is** the master's stock. A V70FE sale draws down V70's
  on-hand, and the 20% reorder trigger fires on the combined figure.

Set it at **Planned**, the last point before the purchase order is built: open
the model, find **Master / child**, and link it. Then map each of the child's
SKUs to the master SKU whose stock it sells, in the **Sells from** column of
the SKU table.

A child cannot leave Planned until both are done **and** the master has reached
Received. It then goes straight to Received, skipping Ordered and Production,
which it genuinely does not have. The board, the PO builder, the inward queue,
bulk receive and the STP matrix all exclude children — that is what makes
"ordered once" true in the data rather than only on screen.

**One level only.** A child can never itself be a master. If three handsets
share a case, all three children point at the one master.

Run [schema-master-child.sql](schema-master-child.sql) **before deploying** a
build with this feature. The app leaves `master_id` out of a save while a model
has no master, so an un-migrated database keeps saving existing models
normally — but the first attempt to link a child will fail on an unknown
column.

## Deploy

~~~mermaid
flowchart LR
    Push[Push to any branch] --> CI[.github/workflows/ci.yml]
    Push --> Vercel[Vercel Git integration]
    CI --> Check[npm run check]
    CI --> Build[npm run build]
    Vercel --> Prod[main -> production]
    Vercel --> Prev[any branch -> preview URL]
~~~

**Deployment is Vercel's, not this repository's.** The Vercel project is
connected to the GitHub repo directly, so:

- a push to <code>main</code> deploys to production,
  <https://procurement-tracker-tau.vercel.app>;
- a push to any other branch gets its own preview URL, which is how a change
  is reviewed before it is merged.

There is deliberately **no deploy workflow here**. One used to publish to
GitHub Pages; it was removed in <code>afad51c</code>, the same commit that the
Vercel project was created alongside — the move to Vercel was intentional, not
an accident. Do not restore it: two deploy paths publishing the same app
against the same database means one of them silently goes stale.

<code>.github/workflows/ci.yml</code> still runs on every push and is the thing
that gates a merge: <code>npm ci</code>, <code>npm run check</code>,
<code>npm run build</code>.

<code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are set
in **Vercel** (Project → Settings → Environment Variables), for production and
preview both. They are read at build time (<code>src/App.jsx</code>,
<code>ENV_DB_CONFIG</code>) and baked into the bundle, so every visitor gets a
working connection without being shown the DB Setup screen. A config saved in a
given browser's local storage still wins over them — see "Pointing one browser
at a different project" above.

> Preview deployments carry the **production** database credentials. A preview
> is not a safe place to try something destructive; use the DB Setup override
> to point your browser at a test project first.

<code>vite.config.js</code> uses <code>base: "./"</code>, which is harmless on
Vercel and was needed for the old Pages subpath.

## Security note

The Supabase public key is included in the browser bundle, which is normal for
a browser-only Supabase client. The current schema grants broad anonymous access
and the name/PIN login is only a simple client-side check, not real
authentication. Use Supabase Auth and restrictive RLS policies before storing
sensitive or production-critical data.
