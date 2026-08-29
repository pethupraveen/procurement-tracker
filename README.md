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
changes.

Progress, delays, stock, sales, and runway are calculated from the saved model
data on every render rather than stored separately.

## Architecture

~~~mermaid
flowchart TB
    Browser[Browser]
    App[src/App.jsx<br/>UI, permissions, workflow gates,<br/>derived metrics, Supabase access]
    Entry[src/main.jsx<br/>Mounts the app]
    DB[(Supabase<br/>users + phones + stage_summary)]
    Schema[schema.sql<br/>Tables, view, trigger, seed users]
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
| <code>schema.sql</code> | Full Supabase schema, view, trigger, and seed users |
| <code>schema-phase3.sql</code> | Additional database migration script |
| <code>schema-compatibility.sql</code> | Compatibility migration script |
| <code>.github/workflows/deploy.yml</code> | Builds and publishes the app when <code>main</code> is pushed |

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

To create the database, run [schema.sql](schema.sql) in the Supabase SQL editor.

> Warning: <code>schema.sql</code> drops its tables before recreating them. Do
> not run it against a populated production database.

## Deploy

~~~mermaid
flowchart LR
    Push[Push to main] --> Workflow[GitHub Actions workflow]
    Workflow --> Build[npm run build]
    Build --> Pages[GitHub Pages]
~~~

Pushing to <code>main</code> runs <code>.github/workflows/deploy.yml</code>,
which builds <code>dist/</code> and publishes it to GitHub Pages.

One-time GitHub setup:

1. In **Settings -> Pages -> Source**, select **GitHub Actions**.
2. In **Settings -> Secrets and variables -> Actions**, add
   <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.

<code>vite.config.js</code> uses <code>base: "./"</code>, allowing the deployed
app to work from the <code>/procurement-tracker/</code> project subpath.

## Security note

The Supabase public key is included in the browser bundle, which is normal for
a browser-only Supabase client. The current schema grants broad anonymous access
and the name/PIN login is only a simple client-side check, not real
authentication. Use Supabase Auth and restrictive RLS policies before storing
sensitive or production-critical data.
