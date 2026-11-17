# Procurement Tracker

> A shared workspace for taking a phone-case range from market research to a live marketplace listing.

[Open the live app](https://pethupraveen.github.io/procurement-tracker/)

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
procurement data in Supabase and deploys automatically to GitHub Pages.

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
    Deploy[GitHub Actions]
    Pages[GitHub Pages]

    Browser --> App
    Entry --> App
    App <--> DB
    Schema --> DB
    Deploy --> Pages
~~~

| Location | Purpose |
| --- | --- |
| <code>src/App.jsx</code> | The application: UI, business rules, permissions, derived data, and database calls |
| <code>src/main.jsx</code> | React entry point |
| <code>schema.sql</code> | Full Supabase schema, view, trigger, and seed users. <strong>Drops the tables first</strong> |
| <code>schema-bootstrap.sql</code> | Non-destructive version of the above: creates only what is missing |
| <code>schema-roles.sql</code> | The <code>role_permissions</code> table behind the admin matrix |
| <code>schema-phase3.sql</code> | Additional database migration script |
| <code>schema-compatibility.sql</code> | Compatibility migration script |
| <code>schema-report-approval.sql</code> | Approval and send-log tables for the emailed STP report |
| <code>supabase/functions/</code> | Two Edge Functions: request an approval code, send the approved report |
| <code>.github/workflows/ci.yml</code> | Runs <code>npm ci</code>, <code>npm run check</code> and <code>npm run build</code> on every push |

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

To create the database, run [schema-bootstrap.sql](schema-bootstrap.sql) in the
Supabase SQL editor, then [schema-roles.sql](schema-roles.sql). Use
[schema.sql](schema.sql) only to wipe an existing database and start again.

> Warning: <code>schema.sql</code> drops its tables before recreating them. Do
> not run it against a populated production database.

## Deploy

~~~mermaid
flowchart LR
    Push[Push to any branch] --> CI[.github/workflows/ci.yml]
    CI --> Check[npm run check]
    CI --> Build[npm run build]
~~~

Every push runs <code>.github/workflows/ci.yml</code>, which installs with
<code>npm ci</code>, runs the role self-check, and builds <code>dist/</code>.

> **There is currently no deploy workflow in this repository, and pushing to
> <code>main</code> no longer publishes anything.**
>
> There was one. <code>.github/workflows/deploy.yml</code> built
> <code>dist/</code> and published it to GitHub Pages, and its last successful
> runs were in September 2026. It was deleted in commit <code>afad51c</code>
> ("Add Customer Care team and move permissions into the database") — a commit
> about permissions, which suggests the deletion was not intended. Audit
> finding AUD-007 recorded the absence; this note records how it happened.
>
> Recover it with <code>git show 4fa2755:.github/workflows/deploy.yml</code>,
> the last version before the deletion. Check it before restoring it: the
> preceding commit is titled "Allow clean manual Pages deployments", so
> somebody may have been moving to manual deploys on purpose. Until that is
> settled, publish by building locally and uploading <code>dist/</code>.

A restored deploy job should keep the
<code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> Actions
secrets. They are read at build time (<code>src/App.jsx</code>,
<code>ENV_DB_CONFIG</code>) and baked into the bundle, so every visitor gets a
working connection without being shown the DB Setup screen. A config saved in a
given browser's local storage still wins over them, which is how an admin
points one machine at a different project.

<code>vite.config.js</code> uses <code>base: "./"</code>, allowing the deployed
app to work from the <code>/procurement-tracker/</code> project subpath.

## Security note

The Supabase public key is included in the browser bundle, which is normal for
a browser-only Supabase client. The current schema grants broad anonymous access
and the name/PIN login is only a simple client-side check, not real
authentication. Use Supabase Auth and restrictive RLS policies before storing
sensitive or production-critical data.
