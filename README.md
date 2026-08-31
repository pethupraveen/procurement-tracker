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
    Admin[Admin] -->|Manage every stage,<br/>send the STP report| All[All workflow work]
~~~

| Role | Main responsibilities |
| --- | --- |
| Admin | Full workflow access, and reset/configuration actions. Accounts and roles are managed in the Supabase Dashboard, not in the app — see [AUTH-SETUP.md](AUTH-SETUP.md) |
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
    Auth[(Supabase Auth<br/>email + password accounts)]
    DB[(Supabase<br/>phones + profiles<br/>+ stage_summary)]
    Schema[schema.sql<br/>Tables, view, trigger, seed users]
    Deploy[GitHub Actions]
    Pages[GitHub Pages]

    Browser --> App
    Entry --> App
    App -->|Sign in, refresh token| Auth
    App <-->|Access token on every call| DB
    Schema --> DB
    Deploy --> Pages
~~~

| Location | Purpose |
| --- | --- |
| <code>src/App.jsx</code> | The application: UI, business rules, permissions, derived data, and database calls |
| <code>src/main.jsx</code> | React entry point |
| <code>schema.sql</code> | Full Supabase schema, view, trigger, and seed users |
| <code>schema-auth.sql</code> | Auth migration: <code>profiles</code>, the approved-account allowlist, and authenticated-only access |
| <code>schema-phase3.sql</code> | Additional database migration script |
| <code>schema-compatibility.sql</code> | Compatibility migration script |
| <code>AUTH-SETUP.md</code> | Dashboard steps for the Auth accounts and their initial passwords |
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

Without these values, the app opens the **DB Setup** screen, where the same
values can be entered and stored in that browser's local storage. That screen is
not role-gated when it appears before sign-in — there is no session yet to check
a role against, and neither value is a secret. Afterwards it is reachable only
from the Admin's ⚙ button.

To create the database, run [schema.sql](schema.sql) in the Supabase SQL editor.

> Warning: <code>schema.sql</code> drops its tables before recreating them. Do
> not run it against a populated production database.

For a populated project, do not run [schema-auth.sql](schema-auth.sql) until the
Auth-capable browser build is live: it removes anonymous access, so the old
name/PIN build will otherwise be blocked. [AUTH-SETUP.md](AUTH-SETUP.md) gives
the required cutover order — configure Auth URLs, publish the Auth build, apply
the migration, create and verify the approved accounts, then deploy and verify
the secured report function.

## Sign in

~~~mermaid
sequenceDiagram
    participant User
    participant App as Tracker
    participant Auth as Supabase Auth
    participant DB as profiles

    User->>App: Email and password
    App->>Auth: Sign in
    Auth-->>App: Access token + refresh token
    App->>DB: Read my profile
    DB-->>App: Name, role, avatar
    App-->>User: Tracker, with that role's permissions
~~~

Sign-in is a Supabase Auth email and password. The tokens are kept in this
browser's local storage, so a reload keeps you signed in; the access token is
refreshed before it expires and travels on every database and report call.

The role comes from the caller's row in <code>profiles</code>, re-read on every
refresh — an Auth account with no profile is not approved and cannot open the
tracker, whatever its password is.

There is no account creation, no self-service password reset, and no user
management screen in the app. All three would need a service-role key, which a
page served to the public cannot keep secret. The Admin does them in the Supabase
Dashboard; [AUTH-SETUP.md](AUTH-SETUP.md) has the procedure.

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
a browser-only Supabase client.

[schema-auth.sql](schema-auth.sql) removes anonymous access to the database, so
the public key stops being a credential on its own: reads and writes require a
signed-in Supabase Auth user, and roles come from the server-side
<code>profiles</code> table rather than from browser-editable data.

The app signs in against Supabase Auth and sends that session's access token on
every database call, so the browser no longer decides for itself who is signed
in or what role they hold.

One limit remains: the per-stage rules are enforced only in the browser. Any
signed-in user can write any phone row through a direct HTTP call — the database
policies allow every authenticated caller to read and write <code>phones</code>.
Server-side enforcement of individual workflow transitions is still outstanding.

The report-email Edge Function verifies the caller's bearer token and looks up
the caller's role in <code>profiles</code> with its server-only credential.
Only an Admin can send mail; recipients and report contents are validated and
the browser CORS origin is restricted. Configure its secrets and run the manual
send checks in [AUTH-SETUP.md](AUTH-SETUP.md#6-deploy-the-secured-report-email-function).
