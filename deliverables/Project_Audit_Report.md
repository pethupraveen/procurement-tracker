# Technical Audit Report
## New Model Procurement Tracker

| Field | Value |
| --- | --- |
| Report version | 1.0 |
| Date | 17 November 2026 |
| Status | Final for the stated baseline |
| Audit type | Static source audit with executed project checks. **No runtime, database or deployment testing.** |
| Evidence baseline | Git commit `afad51c70c262494c97de00d19e99eefc3070d76` ("Add Customer Care team and move permissions into the database", 16 Nov 2026), branch `fix/supabase-loading-screen` |
| Working tree | Clean apart from untracked `deliverables/` and `.presentation-build/` |
| Companion documents | `deliverables/BRD.md`, `deliverables/BRD.docx`, `deliverables/Project_Presentation.pptx`, `deliverables/README.md` |

---

## 1. Audit scope and method

### 1.1 What was audited

Every first-party artefact in the repository was read in full:

| Artefact | Lines | Reviewed |
| --- | --- | --- |
| `src/App.jsx` | 6,391 | Line by line |
| `src/roles.js` | 86 | Line by line |
| `src/roles.selfcheck.mjs` | 66 | Line by line |
| `src/main.jsx` | 5 | Line by line |
| `supabase/functions/request-stp-report-approval/index.ts` | 69 | Line by line |
| `supabase/functions/send-stp-report/index.ts` | 46 | Line by line |
| `schema.sql` | 101 | Line by line |
| `schema-roles.sql` | 89 | Line by line |
| `schema-report-approval.sql` | 76 | Line by line |
| `schema-compatibility.sql` | 33 | Line by line |
| `schema-phase3.sql` | 20 | Line by line |
| `README.md` | 212 | Full |
| `REPORT-EMAIL-SETUP.md` | 51 | Full |
| `package.json`, `vite.config.js`, `index.html`, `supabase/config.toml`, `.gitignore`, `.claude/settings.local.json` | 60 | Full |
| **Total first-party source** | **~7,300** | |

### 1.2 Exclusions, and why

| Excluded | Reason |
| --- | --- |
| `node_modules/` | Third-party dependencies; not first-party code. |
| `dist/` | Build output. Regenerated during this audit by CHK-002; git-ignored. |
| `package-lock.json` (57 kB) | Generated artefact. Reviewed for presence and commitment, not content. |
| `.presentation-build/*/slide-*.png` | Binary preview images from an earlier presentation exercise. |
| `deliverables/*.pptx`, `deliverables/*.pdf` (pre-existing) | Binary artefacts dated 6 Nov 2026 from a prior scope/KRA-KPI exercise, unrelated to the application code. Not reviewed, reconciled or superseded. |
| `.env.local` | Contains credentials. **Deliberately not opened.** Its existence is recorded; no value from it appears in any deliverable. |
| `index.html` favicon data URI | Inline SVG emoji; no logic. |
| `src/App.jsx:908-1201` (the `CSS` template literal) | Reviewed for responsive breakpoints, theming tokens, reduced-motion handling, focus-visible states and disabled-control styling — the behaviours that carry requirements — rather than property by property. |

### 1.3 Method

1. Repository inventory and git baseline.
2. Full read of every first-party file, top to bottom, in dependency order.
3. Trace of each major workflow from the UI control through the state handler,
   the persistence layer, the REST request, the SQL schema and any Edge
   Function.
4. Targeted `grep` verification of each candidate finding, so that no finding
   rests on recollection of a single read (see CHK-005 to CHK-010).
5. Execution of the project's own available checks (CHK-001, CHK-002).
6. Classification of each finding as a **confirmed defect**, a **suspected
   risk**, or an **optional improvement**.

### 1.4 Confidence vocabulary

| Confidence | Meaning |
| --- | --- |
| **Confirmed** | The defect is visible in the code and verified by a targeted grep or an executed check. The failure follows necessarily from the code as written. |
| **High** | The code clearly produces the described behaviour, but the consequence depends on a runtime condition that could not be observed (a live database, a second browser, a deployed function). |
| **Medium** | The behaviour is clear; whether it matters depends on data volume, usage pattern or an unanswered business question. |
| **Suspected** | A plausible risk whose realisation depends on platform behaviour this audit could not test (for example how a specific browser or spreadsheet version handles a value). |

---

## 2. Architecture assessment

### 2.1 Shape

```
┌────────────────────────────────────────────────────────────────────┐
│ Browser                                                            │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ src/main.jsx  →  src/App.jsx  (6,391 lines, one component    │  │
│  │                                 file; 28 components)          │  │
│  │   helpers → stages → data → derive → UI → App                 │  │
│  │                                                               │  │
│  │   src/roles.js (86 lines, pure)  ← the only tested module    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│   localStorage: connection config + session (incl. PIN hash)        │
└──────────────┬──────────────────────────────┬──────────────────────┘
               │ anon key, full access         │ no gateway JWT
               ▼                               ▼
   ┌──────────────────────────┐   ┌─────────────────────────────────┐
   │ Supabase PostgREST       │   │ Supabase Edge Functions (Deno)  │
   │  /phones                 │   │  request-stp-report-approval    │
   │  /users                  │   │  send-stp-report                │
   │  /role_permissions       │   │   ├── service_role → RPC        │
   │   RLS: using(true)       │   │   └── Resend API → email        │
   └──────────────────────────┘   └─────────────────────────────────┘
               │                               │
               ▼                               ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ Postgres                                                       │
   │  phones (JSONB: skus, sales_entries, notes, attachments, audit)│
   │  users · role_permissions · stage_summary (view, unused)       │
   │  report_approvals · report_send_log  ← anon privileges revoked │
   │  trigger: touch_updated_at  ← the optimistic-lock version      │
   └────────────────────────────────────────────────────────────────┘
```

### 2.2 What the architecture does well

These are genuine strengths and should survive any refactor.

| # | Strength | Evidence |
| --- | --- | --- |
| 1 | **Single source of truth per rule.** `gateBlock`, `moveStatus`, `advanceStatus`, `problemsOf` and `passesFilters` are each the only implementation of their rule. Drag-and-drop, the board arrow, the detail footer and the bulk-inward button physically cannot disagree, because they all call the same function. | `src/App.jsx:497-501`, `1413`, `2890`, `2901`, `4093`, `4186`, `5799` |
| 2 | **Nothing derived is stored.** Progress, delay, runway, stock, sales and alerts are computed on every render from the stored facts, so they cannot drift out of agreement with the data. | `src/App.jsx:276-278`, `313-336`, `5734` |
| 3 | **Optimistic locking is correctly implemented** as a server-evaluated compare-and-swap, with a database trigger owning the version stamp and the client never sending it back. The deliberate choice of a plain INSERT over an upsert for creation closes the matching hole. | `src/App.jsx:778-780`, `811-837`; `schema.sql:48-58` |
| 4 | **The email send is the one capability moved off the client entirely**, with a server-held credential, a one-time approval claimed under a row lock, peppered hashes, IP rate limiting, idempotency keys and an audit log. It is a correctly designed server-side control. | `supabase/functions/*`; `schema-report-approval.sql` |
| 5 | **Honest status reporting.** The application distinguishes "saving", "saved", "saved in this tab only" and "not saved — refresh first", and refuses to show a success message before the write completes. Most applications of this size do not. | `src/App.jsx:5706-5724`, `6247-6273` |
| 6 | **First load and background sync are separated**, so a routine 90-second re-read cannot throw up a blocking overlay, and a background read is abandoned rather than overwriting an open editor. | `src/App.jsx:5549-5557`, `5577-5588`, `6325-6338` |
| 7 | **Shortcuts carry their own limits.** Where a deliberate compromise was made, a comment states the limit and the condition that should trigger an upgrade. | `src/App.jsx:483-487`, `3086-3087`, `719-723` |
| 8 | **Permissions were migrated out of the bundle into the database** with a safe fallback, an admin-lockout guard and a self-check — the one part of the system with real test coverage. | `src/roles.js`; `schema-roles.sql`; `src/roles.selfcheck.mjs` |
| 9 | **Accessibility has been worked on deliberately**, not accidentally: focus restoration, Escape handling, `aria-sort` on sortable headers, a permanently mounted live region, real `disabled` attributes replacing opacity fakes, and reduced-motion support. | `src/App.jsx:1251-1282`, `1591-1606`, `6383-6388`, `1010-1018`, `1081-1085` |

### 2.3 The structural problem

The application has **no server of its own**. Every rule in §2.2 item 1 runs in
the browser, and the browser holds a key that grants unrestricted access to the
database. The result is that the application's careful workflow discipline is
**advisory**: it governs what a user can do *through the application*, and
nothing at all about what they can do *to the data*.

This single fact generates findings AUD-001, AUD-002, AUD-003, AUD-005 and
AUD-009. It is acknowledged in `README.md`'s security note, which is to the
author's credit, but acknowledgement is not mitigation.

### 2.4 Module inventory

| # | Component | Lines | Responsibility |
| --- | --- | --- | --- |
| 1 | `ConfirmDialog` | 1217-1249 | Destructive confirmation with focus management |
| 2 | `useDismiss` | 1251-1282 | Escape handling and focus restoration |
| 3 | `Tag` / `Meter` / `Stat` / `Field` | 1284-1298 | Presentational primitives |
| 4 | `FilterBar` | 1304-1399 | Search, chips, density, brand selector |
| 5 | `Board` | 1405-1559 | Stage columns, drag-and-drop, quick advance, collapse |
| 6 | `Table` | 1564-1692 | Sortable list with keyboard rows |
| 7 | `RoleLocked` | 1701-1707 | Read-only notice |
| 8 | `PlannedSKUEditor` | 1715-1863 | SKU table and bulk paste |
| 9 | `POField` | 1868-1901 | Single-model PO entry |
| 10 | `SKUExport` | 1907-1945 | Ordered-stage export |
| 11 | `ProductionSTP` | 1952-2042 | Per-SKU STP status |
| 12 | `ReceivedChecker` | 2049-2162 | Per-SKU goods receipt |
| 13 | `ListingEditor` | 2169-2297 | SKU × marketplace grid |
| 14 | `ModelExtras` | 2305-2473 | Notes, files, history tabs |
| 15 | `SalesTracker` | 2480-2683 | Sales entry, stock, history |
| 16 | `ResearchEditor` | 2690-2738 | Phone detail editing |
| 17 | `Detail` | 2740-2937 | Stage-aware detail panel and footer |
| 18 | `Calendar` | 2946-3053 | Six-month launch view |
| 19 | `CSVImport` | 3060-3268 | Template, upload, parse, preview |
| 20 | `AddForm` | 3294-3423 | Manual create and import host |
| 21 | `KPI` | 3517-3537 | KPI card with drill-through and export |
| 22 | `Dashboard` | 3541-3850 | To-dos, KPIs, funnel, marketplace, alerts |
| 23 | `CatalogQueue` | 3860-4022 | Listing queue with bulk actions |
| 24 | `InwardStock` | 4043-4277 | Multi-model goods receipt draft |
| 25 | `STPRequirement` | 4292-4432 | Model × material requirement matrix |
| 26 | `CatalogInward` | 4437-4495 | Tab host plus email approval flow |
| 27 | `BulkReceive` | 4498-4641 | Receive against a PO |
| 28 | `POManager` | 4651-4850 | PO builder and PO review |
| 29 | `Reports` | 4951-5017 | Nine reports with preview and export |
| 30 | `UserManager` | 5025-5256 | Accounts and permission matrix |
| 31 | `DBSetupScreen` | 5264-5346 | Connection configuration |
| 32 | `BootScreen` | 5359-5380 | First-load screen with offline escape |
| 33 | `LoginScreen` | 5382-5517 | Account selection and PIN |
| 34 | `App` | 5520-6391 | All state, all handlers, all persistence |

Non-component logic: date helpers (29-45), stages (48-76), SKU and audit
factories (90-178), stock and sales derivation (180-270), derive and alerts
(276-403), permissions wiring (407-492), gates and transitions (497-621), search
and filters (623-656), the database layer (658-902), styles (904-1201), the
download utility (3434-3513), and the report builders (4856-4949).

### 2.5 Workflow and integration assessment

| Workflow | Traced through | Assessment |
| --- | --- | --- |
| Create → Planned → Ordered → Production → Received → Live | UI control → `move()` → `moveStatus` → `gateBlock` → `moveTo` → `withAudit` → `persist` → `dbUpdatePhone` → PostgREST PATCH with version filter → trigger | **Sound.** Every path converges on one gate. Date stamping is idempotent forward and destructive backward, which keeps the timeline honest. |
| Un-Procurement off-ramp | `moveStatus` terminal branches → `moveTo` → `derive` → `problemsOf` early return | **Sound**, with one inconsistency: a comment describes a scenario the gate forbids (AUD-036). |
| PO creation and assignment | `POManager` → `assignPO` → per-model `persist` | **Works**, but one write per model and no permission re-check (AUD-009, AUD-014). |
| Bulk receive against a PO | `BulkReceive` → `bulkReceive` → gate re-check → `persist` | **Mostly sound** — re-checks the gate and the stage, which is better than most. Reads a render-time copy of the model list, so a cross-tab change is missed (AUD-027). |
| STP requirement decision | `STPRequirement` → `setStpRequired` → `persist` | **Defective.** Columns come from a hardcoded list, so off-list materials are undecidable and omitted from the screen's export while appearing in the other two reports (AUD-013). |
| STP status chase | `ProductionSTP` → `updateSTP` → `persist` | **Sound.** No permission re-check (AUD-009). |
| Inward stock draft | `InwardStock` draft → `saveAll` grouped per model → `persist` | **Sound design** — draft-then-commit grouped per model is the right shape. Not protected from a background re-read (AUD-016). |
| Listing queue | `CatalogQueue` → `saveListings` → `persist` | **Works**, one write per model on cross-model actions (AUD-014). |
| Sales and stock | `SalesTracker` → `logSale` → `persist`; `stockOfSku` derives | **Works.** No permission re-check (AUD-009); deleted SKUs orphan their sales entries (AUD-018). |
| CSV import | `CSVImport` parse and preview → `importPhones` → `Promise.all(persist)` | **Sound parsing** — the quote-aware splitter is correct. No row cap and one request per model (AUD-028). |
| Concurrency | `persist` queue → version compare → conflict latch → banner | **Sound mechanism**, with a latch that only clears on a full reload (AUD-008). Not runtime-tested. |
| Sync | `loadFromDB` → parallel reads → `shouldKeepLocalEdits` guard | **Sound** for the detail panel; unpaginated full-table read (AUD-004); other drafts unprotected (AUD-016). |
| Email approval | UI → Edge Function → RPC under row lock → Resend | **Well designed.** The strongest control in the system. Approval consumed before the send is attempted (AUD-029). |
| Deployment | `npm run build` → `dist/` → *documented* GitHub Actions → Pages | **Build works** (CHK-002). **The workflow does not exist** (AUD-007). |

---

## 3. Findings

### 3.1 Summary by severity

| Severity | Confirmed defects | Suspected risks | Optional improvements | Total |
| --- | :---: | :---: | :---: | :---: |
| **Critical** | 3 | 0 | 0 | **3** |
| **High** | 6 | 1 | 0 | **7** |
| **Medium** | 14 | 1 | 0 | **15** |
| **Low** | 7 | 1 | 3 | **11** |
| **Total** | **30** | **3** | **3** | **36** |

### 3.2 Severity definitions

| Severity | Definition |
| --- | --- |
| **Critical** | Unauthorised access to, or destruction of, all application data is possible with no special tooling. |
| **High** | Incorrect business outcomes, irrecoverable data loss, an organisational lockout, or an unreproducible release process. |
| **Medium** | Wrong or missing data in a specific workflow, a usability or accessibility barrier, or a maintainability problem that makes future defects likely. |
| **Low** | Cosmetic, dead code, inefficiency without current consequence, or a narrow edge case. |

---

## CRITICAL

### AUD-001 · Authentication is a client-side PIN check against a publicly readable weak hash

- **Severity:** Critical · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M1 Authentication · **Affects:** every user and every record

**Evidence**

| What | Where |
| --- | --- |
| PIN hashed with djb2 — a 32-bit non-cryptographic function, no salt, no work factor | `src/App.jsx:423-427` |
| The comparison happens entirely in the browser | `src/App.jsx:5391` |
| The full `users` row, including `pin`, is fetched by the browser | `src/App.jsx:876-880` |
| Anonymous role granted unrestricted access to `users` | `schema.sql:61-65` |
| PIN constrained to 4–6 digits | `src/App.jsx:5390`, `5480` |
| Acknowledged in documentation | `README.md` security note |

**Reproduction** (requires only the deployed URL)

1. Read `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the served
   JavaScript bundle — they are compiled into it by design.
2. Issue `GET /rest/v1/users?select=*` with that key. Every row returns,
   including each account's `pin` hash and `role`.
3. The djb2 implementation is in the same bundle. The PIN search space is at
   most 10⁶ (4 to 6 digits). Hashing the whole space and matching the admin
   account's value is trivial on any laptop.
4. Sign in as that account at the application's own login screen.

**Business impact**

Complete compromise of the application as an access-controlled system. An
attacker becomes Admin, and Admin holds every permission including Manage users
and DB/reset. Given the data involved — unannounced phone launch dates, order
volumes, supplier paperwork status, sales revenue — this is a commercial
confidentiality exposure as well as an integrity one. OQ-13 in the BRD asks the
business to confirm how sensitive that data is; the answer determines urgency,
not whether the finding is real.

**Recommended fix**

Replace the PIN mechanism with Supabase Auth and carry the role as an
authenticated claim. Restrict the `users` table so no credential material is
readable by any browser role. If a PIN-style convenience login must be retained
for shop-floor use, it must be exchanged server-side for a real session and
must never be verified in the browser.

**Verification approach**

With the anonymous key, `GET /rest/v1/users` must return no credential column
(ideally no rows). Signing in must require a server-issued token. A changed
password must invalidate existing sessions. Covered by BRD UAT-21.

---

### AUD-002 · Authorization is enforced only in the browser

- **Severity:** Critical · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M2 Permissions · **Affects:** every write path

**Evidence**

| What | Where |
| --- | --- |
| Permission predicates evaluated in the browser | `src/App.jsx:5540` (`CAN`), `src/roles.js:54-56` |
| Stage ownership evaluated in the browser | `src/App.jsx:564-565` |
| Data gates evaluated in the browser | `src/App.jsx:503-540` |
| No corresponding policy in any schema file | `schema.sql:61-65`; `schema-roles.sql:42-45` — all policies are `using (true) with check (true)` |
| Comment confirming the design | `schema-roles.sql:39-41`: "the anon key is public, so this is not a security boundary — the app's role gates are enforced in the browser only" |

**Reproduction**

1. Obtain the anonymous key from the bundle.
2. `PATCH /rest/v1/phones?id=eq.<id>` with `{"stage":"live"}`.
3. The model is now Live with no SKUs confirmed, no listings, no PO and no STP
   file — every rule in BRD §6.2 bypassed, and no audit entry written.

A Sales or Customer Care user, who holds no write permission in the
application, can do exactly this, because they hold the same key as everyone
else.

**Business impact**

Every workflow gate documented in the BRD as a control is a user-interface
convenience. The stage of a model — the central fact the whole product exists to
make trustworthy — can be set to anything by anyone with the URL, bypassing the
audit trail. Management reporting built on stage counts is therefore not
tamper-evident.

**Recommended fix**

Implement RLS policies that enforce the write permissions in `role_permissions`
against the authenticated user's role (depends on AUD-001). Enforce the stage
transition rules in a Postgres trigger or an RPC so that `stage` cannot be set
arbitrarily by a direct PATCH. Keep the browser checks as UX.

**Verification approach**

A direct PATCH from a role lacking the permission must be refused by the
database. A direct PATCH attempting a two-stage jump, or a transition whose gate
is unmet, must be refused. Covered by BRD UAT-21.

---

### AUD-003 · The anonymous key grants unrestricted read, write and delete on all application tables

- **Severity:** Critical · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** Data layer · **Affects:** `phones`, `users`, `role_permissions`

**Evidence**

| What | Where |
| --- | --- |
| `anon full access users` — `for all using (true) with check (true)` | `schema.sql:64` |
| `anon full access phones` — `for all using (true) with check (true)` | `schema.sql:65` |
| `anon full access role_permissions` — same | `schema-roles.sql:44-45` |
| Key compiled into the bundle | `src/App.jsx:672-675` |
| Delete-all helper targets `id=gt.0` | `src/App.jsx:872-875` |

RLS is *enabled* on all three tables, which makes this more insidious than
having it off: a reviewer checking "is RLS enabled?" gets a yes.

**Reproduction**

1. Obtain the anonymous key from the bundle.
2. `GET /rest/v1/phones?select=*` — the entire procurement record, including
   every sales entry, note, attachment link and audit trail.
3. `DELETE /rest/v1/phones?id=gt.0` — every model, permanently. There is no
   soft delete and no undo.
4. `PATCH /rest/v1/role_permissions?role=eq.sales` with `{"can":{"manageUsers":true}}`
   — though AUD-001 already makes this unnecessary.

**Business impact**

Total loss of confidentiality, integrity and availability of all procurement
data, achievable by anyone who can load the application. There is no backup
mechanism in the repository and no recovery path.

**Recommended fix**

Replace all three policies with role-scoped policies keyed on the authenticated
user (depends on AUD-001). At minimum, before that work lands: restrict
`DELETE` on `phones` to an authenticated admin role, and remove read access to
`users`. Establish a Supabase point-in-time-recovery or scheduled backup, which
is a separate gap this audit notes here because AUD-003 makes it urgent.

**Verification approach**

With the anonymous key: a read of `users` is refused; a delete on `phones` is
refused; a write to `role_permissions` is refused. Confirm a restore path
exists. Covered by BRD UAT-21.

---

## HIGH

### AUD-004 · Whole-row writes over unbounded JSONB, with an unpaginated full-table sync every 90 seconds

- **Severity:** High · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M14 Persistence · **Affects:** every save and every sync

**Evidence**

| What | Where |
| --- | --- |
| Every save serialises the complete model row | `src/App.jsx:771-777` |
| Six JSONB columns on one row: `done`, `skus`, `sales_entries`, `notes`, `attachments`, `audit` | `schema.sql:35-40` |
| Only `audit` is capped (200 entries); `notes`, `attachments` and `sales_entries` are unbounded | `src/App.jsx:145`, `157` vs `6017`, `6037`, `5997` |
| Sync reads the whole table with no pagination and no field selection | `src/App.jsx:798-802` (`/phones?order=id`) |
| Sync runs on refocus and every 90 seconds | `src/App.jsx:5636-5637` |
| The author documents the consequence | `src/App.jsx:803-805`: "Every save writes the WHOLE phone row" |

**Failure scenario**

A model live for a season accumulates, say, 400 sales entries, 60 notes and 30
attachment links. Logging one more sale re-serialises and re-writes all of it.
Meanwhile every open tab re-downloads every model's complete history every 90
seconds. With 200 models the sync transfers megabytes per tab per minute, for
data that has not changed.

Worse, because the lock is per row, **two people editing different SKUs of the
same model collide**. User A edits SKU 1, user B edits SKU 2; B's save is
refused and B is told to refresh and redo, even though the two edits do not
overlap. Combined with AUD-008 the model then stops saving for B entirely.

**Business impact**

Degrading performance and rising data transfer as the business accumulates
history, plus avoidable conflicts that erode trust in the application precisely
during the busiest periods, when several people work the same models.

**Recommended fix**

Promote `skus` and `sales_entries` to child tables with foreign keys, and move
to per-SKU writes so a save touches only what changed. Convert `notes`,
`attachments` and `audit` to append-only child tables. Paginate and field-select
the sync read, and consider Supabase Realtime in place of polling.

**Verification approach**

Measure the request payload for a single SKU edit before and after. Confirm two
users editing different SKUs of one model both succeed. Confirm the sync payload
does not grow with audit history.

---

### AUD-005 · The stored session includes the account's PIN hash

- **Severity:** High · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M1 Session

**Evidence**

| What | Where |
| --- | --- |
| The whole user object is written to `localStorage` | `src/App.jsx:706-708` (`saveSession(user)`) |
| That object includes `pin` — `userToRow` and `DEFAULT_USERS` both carry it | `src/App.jsx:791`, `429-436` |
| Re-saved on every session re-validation | `src/App.jsx:5606` |
| Hash is djb2 over a ≤6-digit PIN | `src/App.jsx:423-427` |

**Reproduction**

Sign in, then read `localStorage.getItem("proc_tracker_session")`. The value
contains the account's `pin` hash. Any script running on the origin — including
anything injected via AUD-006 — can read it, and the hash is reversible by
brute force in milliseconds.

**Business impact**

A shared or kiosk machine retains a crackable credential for 12 hours after the
user walks away, and the credential is exposed to any same-origin script.
Independently exploitable even if AUD-001 were fixed at the database layer but
the PIN mechanism retained.

**Recommended fix**

Strip `pin` (and any future credential field) before writing the session, and
strip it from the user list held in memory. Superseded entirely by AUD-001's
fix, but worth doing immediately because it is a one-line change.

**Verification approach**

After sign-in, the stored session object must contain no credential field.

---

### AUD-006 · Output is not neutralised: unvalidated attachment URL schemes and spreadsheet formula injection

- **Severity:** High · **Confidence:** Confirmed (CSV) / Suspected (URL execution) · **Type:** Confirmed defect
- **Module:** M11 Export, M13 Attachments

**Evidence — attachment URLs**

| What | Where |
| --- | --- |
| Only presence is validated, never the scheme | `src/App.jsx:2324` (`if (!att.label.trim() \|\| !att.url.trim()) return;`) |
| Stored verbatim | `src/App.jsx:170-175` |
| Rendered directly as `href` | `src/App.jsx:2432` |
| Any signed-in role can attach | `src/App.jsx:2842` (`canWrite={role !== "none"}`) |

**Evidence — formula injection**

| What | Where |
| --- | --- |
| CSV quotes every cell but does not neutralise a leading `=`, `+`, `-` or `@` | `src/App.jsx:3462` |
| The tab-separated variant does not either | `src/App.jsx:3463` |
| The Edge Function's CSV helper quotes only when a delimiter or quote is present | `send-stp-report/index.ts:8` |
| Free-text fields reach exports: brand, model, SKU code, material, notes | `src/App.jsx:4859-4933` |

**Reproduction — formula injection (confirmed)**

1. Create a model with brand `=HYPERLINK("https://example.test","click")`, or a
   sales note beginning `=`.
2. Download the All Phones report, or trigger the emailed STP report.
3. Open in Excel or Google Sheets. The cell is evaluated as a formula rather
   than shown as text. Formula payloads can exfiltrate adjacent cell contents
   to a remote host via `HYPERLINK` or `WEBSERVICE`.

The report is emailed to the MD and to the factory, so the payload crosses an
organisational boundary.

**Reproduction — URL scheme (suspected)**

1. Attach a link with a `javascript:` URL and any label.
2. A colleague opens the model and clicks the link.
3. React 18 logs a development warning for `javascript:` hrefs but does not
   strip them, so the navigation is attempted. Whether it executes depends on
   the browser's own handling of a user-initiated `javascript:` navigation in a
   new tab — which this audit could not test. Marked **Suspected** for that
   reason; the *missing validation* is confirmed.

**Business impact**

A report sent to the MD and an external factory can carry an active payload. An
attachment field usable by every role, including Customer Care, is an
unvalidated sink rendered as a link.

**Recommended fix**

Prefix any exported cell beginning `= + - @` (or tab/carriage return) with a
single quote, in `downloadReport` and in the Edge Function's `csvCell`. Validate
attachment URLs against an `http:`/`https:` allow-list at entry and again at
render.

**Verification approach**

Export a report containing a cell beginning `=` and confirm the spreadsheet
shows it as text. Attempt to attach a `javascript:` URL and confirm rejection.
Covered by BRD UAT-30.

---

### AUD-007 · The documented deployment pipeline and a referenced migration do not exist

- **Severity:** High · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M16 Deployment

**Evidence**

| What | Where |
| --- | --- |
| `README.md` describes `.github/workflows/deploy.yml`, states that pushing to `main` builds and publishes, and lists the required repository secrets | `README.md` "Architecture" table and "Deploy" section |
| `ls -la .github` → `No such file or directory` | **CHK-009** |
| `REPORT-EMAIL-SETUP.md:7` instructs: "Run once in Supabase SQL Editor after `schema-pin-login-rollback.sql`" | **CHK-010** — no such file in the repository |
| `README.md` lists `schema.sql`, `schema-phase3.sql` and `schema-compatibility.sql` but omits `schema-roles.sql` and `schema-report-approval.sql` | `README.md` "Architecture" table |
| `vite.config.js` carries a comment telling the reader to change `base` to `/procurement-tracker/`, while `README.md` states `base: "./"` is what makes the subpath work | `vite.config.js:6-8` vs `README.md` |

**Failure scenario**

A new maintainer follows `README.md` to deploy and finds nothing to run. A
different maintainer follows `REPORT-EMAIL-SETUP.md` and cannot find the
prerequisite migration, so either skips it or guesses. Neither the build nor the
self-check runs automatically on any push, so a change that breaks `npm run
check` can be released — and since that self-check is the project's only test
(AUD-021), the one safety net in the project is not wired to anything.

**Business impact**

The release process cannot be reproduced or audited. The database migration
sequence cannot be reconstructed from the repository, which matters directly
when remediating AUD-003. BRD OQ-10 asks the maintainer how deployment actually
happens today; until that is answered, no remediation can be confidently
deployed.

**Recommended fix**

Commit the workflow, running `npm ci`, `npm run check` and `npm run build`, and
publishing to Pages. Reconcile every file reference in both documents against
the repository. Document the intended migration order explicitly. Resolve the
`vite.config.js` comment.

**Verification approach**

A push to a branch runs the workflow. A deliberately broken assertion in
`src/roles.selfcheck.mjs` fails the workflow. Every file named in documentation
resolves. Covered by BRD UAT-22.

---

### AUD-008 · A save conflict latches permanently until a full reload

- **Severity:** High · **Confidence:** High · **Type:** Confirmed defect
- **Module:** M14 Concurrency

**Evidence**

| What | Where |
| --- | --- |
| `state.conflicted = true` is set on a zero-row PATCH | `src/App.jsx:5678` |
| Every later write for that model returns early with a message and no attempt | `src/App.jsx:5667-5672` |
| `writeState` — which holds the latch — is cleared only inside a successful full `loadFromDB` | `src/App.jsx:5611` |
| A background reload is *suppressed* whenever any model is conflicted | `src/App.jsx:5577-5578` |

**Failure scenario**

1. User B's save on model 42 loses the race. Model 42 latches.
2. The conflict also suppresses every background reload, so the latch cannot
   clear itself.
3. B keeps working on model 42. Each save shows "Not saved — refresh first" but
   the editor remains fully functional, so a user who misses a transient message
   can spend an extended period entering data that is being discarded.
4. The only exit is the manual refresh button, which **discards all of B's
   unsaved work** for every model, not just model 42.

The design is deliberately honest — it tells the user every time — but the
recovery is all-or-nothing and the latch is self-perpetuating.

**Business impact**

Lost work during exactly the busy periods when two people work the same models,
and an unnecessarily punitive recovery that discards unrelated unsaved edits.

**Recommended fix**

Re-read the single conflicted model and clear only its latch, offering the user
a choice between keeping their version and taking the server's. Do not suppress
background reloads for *other* models because one is conflicted. Consider
making the editor read-only once latched, so the user cannot keep typing into a
void.

**Verification approach**

Produce a conflict on one model, refresh that model alone, confirm it saves
again, and confirm unsaved edits on other models survive. Covered by BRD
UAT-16.

---

### AUD-009 · Most mutating handlers perform no permission check

- **Severity:** High · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M2 Permissions

**Evidence** (verified by **CHK-006**)

| Handler | Permission re-check | Line |
| --- | --- | --- |
| `addPhone` | ✔ `CAN.addPhone` | 6090 |
| `importPhones` | ✔ `CAN.addPhone` | 6067 |
| `saveReceipt` | ✔ `CAN.saveReceipt` | 5979 |
| `bulkReceive` | ✔ `CAN.saveReceipt` | 5893 |
| `setStpRequired` | ✔ `CAN.setStpRequired` | 5858 |
| `logSale` | ✖ **none** | 5994 |
| `saveSKU` | ✖ none | 5832 |
| `savePO` | ✖ none | 5968 |
| `assignPO` | ✖ none | 5959 |
| `updateSTP` | ✖ none | 5843 |
| `saveListings` | ✖ none | 5872 |
| `addNote` / `deleteNote` | ✖ none | 6014 / 6025 |
| `addAttachment` / `deleteAttachment` | ✖ none | 6034 / 6045 |
| `setArchived` | ✖ none | 6054 |
| `resetAll` | ✖ none | 6005 |

For `logSale` the gap is visible in the wiring: `Detail` receives
`onSalesLog={logSale}` **unconditionally**, while every sibling handler is
passed as `CAN.x(role) ? handler : null` (`src/App.jsx:6310`). Only `canLog`
controls whether the *form renders*.

**Failure scenario**

Within the application the controls are hidden, so this is defence-in-depth
rather than a directly exploitable path. But the inconsistency is itself the
defect: five handlers establish the pattern that a handler must not trust its
caller, and eleven do not follow it. Any future refactor that renders a control
without re-deriving the permission — or any code path that reaches these
handlers another way — writes without a check. Notes and attachments are
already writable by **every** signed-in role including Customer Care and Sales,
because `canWrite` tests only `role !== "none"` (`src/App.jsx:2842`), and no
permission key for notes or attachments exists at all.

**Business impact**

Low today, because AUD-002 means none of these checks is a real boundary
anyway. It becomes material the moment AUD-001 and AUD-002 are fixed, since the
browser checks will then be the layer that decides what the UI offers, and an
unchecked handler is a bug waiting for a refactor.

**Recommended fix**

Add the missing `CAN.*` guards, following the existing pattern. Decide whether
notes and attachments need their own permission keys (they are currently
ungoverned) and add them to `PERM_KEYS` if so.

**Verification approach**

Every mutating handler refuses and reports when the role lacks the permission,
tested directly rather than through the UI. Add a unit test asserting the guard
exists for each handler.

---

### AUD-010 · A bad stored admin permission row cannot be repaired from the admin matrix

- **Severity:** High · **Confidence:** High · **Type:** Confirmed defect
- **Module:** M2 Permissions

**Evidence**

| What | Where |
| --- | --- |
| Admin's checkboxes are **all** disabled: `const locked = fixed \|\| LOCKED_TO_ADMIN.includes(k)` where `fixed = r.key === "admin"` | `src/App.jsx:5199`, `5211`, `5214` |
| Working state is seeded from the live `perms`, which came from the database | `src/App.jsx:5031-5032` |
| `rolesFromRows` restores only `manageUsers` and `reset` for admin | `src/roles.js:51`, `77` |
| The other ten permissions are taken from the row as stored | `src/roles.js:73` |

**Failure scenario**

A `role_permissions` row for `admin` is written — by a hand-edited SQL
statement, a partial migration, or a future bug — with `addPhone: false`. On
load, `rolesFromRows` restores `manageUsers` and `reset` but not `addPhone`.
Admin now cannot add a phone. Opening the matrix to fix it shows the `addPhone`
cell **unticked and disabled**, because admin's whole row is locked. The only
repair is direct SQL.

The intent is sound — the guard exists so an admin cannot lock everyone out —
but locking the entire row is broader than the stated purpose, which
`src/App.jsx:5209-5210` describes as protecting only the two lockout-prone
permissions.

**Business impact**

An administrator can be silently stripped of workflow permissions with no
in-application recovery, requiring database access to fix.

**Recommended fix**

Disable only the `LOCKED_TO_ADMIN` cells for admin, leaving the other ten
editable. Alternatively force all twelve permissions on for admin in
`rolesFromRows`, making admin genuinely all-powerful by construction rather
than by stored data.

**Verification approach**

Write an `admin` row with `addPhone: false`, load, and confirm either that
admin retains the permission or that the matrix allows restoring it.

---

### AUD-011 · The last administrator can be removed or demoted, locking out user and permission management

- **Severity:** High · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M2 Accounts

**Evidence** (verified by **CHK-007**)

| What | Where |
| --- | --- |
| The only removal guard tests the **total** account count | `src/App.jsx:5082` (`if (list.length <= 1) return;`) |
| No check on the number of remaining admins | — |
| The role dropdown offers every role for any account, including the signed-in admin's own | `src/App.jsx:5150-5152` |
| On save, the signed-in user's session adopts the edited record immediately | `src/App.jsx:6360-6361` |
| Removed accounts are hard-deleted from the database | `src/App.jsx:6368-6369` |
| `Manage users` and `DB/reset` are locked to the `admin` **role** — so with no admin *account*, nobody holds them | `src/roles.js:51`; `src/App.jsx:6212`, `6227` |

**Reproduction**

*Path A — demotion.* As the sole admin, open Users → Accounts, edit your own
account, change Role to Sales, Save, then "Save all and close". The session
adopts the Sales role. The Users button disappears. No account holds
`manageUsers`.

*Path B — removal.* With two accounts, one admin and one non-admin, remove the
admin. `list.length` is 2, so the guard does not fire. The admin is deleted
from the database. `me` is undefined, so the user is signed out
(`src/App.jsx:6374`). No admin account exists.

**Impact**

Permanent, unrecoverable-from-the-application lockout of user management,
permission management, the database configuration screen and the reset action.
Recovery requires direct SQL against `users` — which, ironically, AUD-003
currently makes easy, and which a correct fix for AUD-003 would make correctly
difficult. Fixing the security findings without fixing this one converts a
nuisance into a genuine denial of service.

**Recommended fix**

Refuse any save that would leave zero accounts with the `admin` role, whether by
removal or by re-roling, with a clear message. Require a second confirmation
when an admin edits their own role. Document a break-glass recovery procedure.

**Verification approach**

Attempt both paths and confirm refusal with a clear reason. Confirm that with
two admins, removing one succeeds. Covered by BRD UAT-13.

---

### AUD-012 · SKU identifiers can collide across browsers, mis-attributing stock and receipts

- **Severity:** High · **Confidence:** High · **Type:** Confirmed defect
- **Module:** M4 SKUs

**Evidence**

| What | Where |
| --- | --- |
| `newRid = () => Date.now() * 1000 + (++_skuSeq % 1000)` | `src/App.jsx:113-114` |
| `_skuSeq` is a module-scope counter that **restarts at 0 on every page load** | `src/App.jsx:113` |
| `repairSkuRids` de-duplicates **within one model only** | `src/App.jsx:115-125` |
| Sales entries reference SKUs by `skuRid` | `src/App.jsx:185`, `2495` |
| Receipt and listing drafts are keyed by `rid` | `src/App.jsx:4053`, `2173` |
| The author's comment identifies the reload hazard but not the cross-tab one | `src/App.jsx:111-112` |

**Failure scenario**

Two users each add a SKU within the same millisecond, each in a freshly loaded
tab. Both compute `_skuSeq = 1`, both read the same `Date.now()`, so both
produce the identical `rid`. If those SKUs end up on the same model — for
example both users are building the SKU list for one phone, which is exactly
what the bulk-paste and append flow encourages — `repairSkuRids` will replace
one on the next read, and any sales entry or receipt draft already pointing at
it is silently orphaned (see AUD-018).

The window is narrow — the same millisecond, the same counter value, the same
model — but the identifier is persisted and referenced by three different
subsystems, so the consequence is silent data misattribution rather than an
error.

**Business impact**

Stock on hand, units sold and receipt confirmations can be attributed to the
wrong SKU, with no error and no audit entry. Because stock is derived rather
than stored, the wrong figure simply appears and is believed.

**Recommended fix**

Use `crypto.randomUUID()` for new SKU identifiers. When SKUs become a child
table (AUD-004), use a database-generated key and the problem disappears
structurally.

**Verification approach**

Generate many identifiers across simulated concurrent sessions and assert
uniqueness. Confirm that a repaired identifier never leaves a sales entry
orphaned.

---

### AUD-013 · The STP requirement matrix is driven by a hardcoded material list, and three report implementations disagree

- **Severity:** High · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M6 STP requirement, M11 Reporting

**Evidence** (verified by **CHK-008**)

| What | Where |
| --- | --- |
| Four materials hardcoded | `src/App.jsx:102-108` |
| Matrix **columns** come from that list | `src/App.jsx:4372`, `4378`, `4397` |
| The screen's export iterates that list | `src/App.jsx:4325` |
| The Reports tab groups by the **stored** material, defaulting to `—` | `src/App.jsx:4892` |
| The Edge Function groups by the **stored** material, defaulting to `-` | `send-stp-report/index.ts:34` |
| Bulk paste accepts **any** material string with no validation | `src/App.jsx:1737` |
| No database constraint on the material value | `schema.sql:36` (plain JSONB) |

**Reproduction**

1. Open a model at Planned and bulk-paste `LEA-A57-BRN, Leather, 20`. The SKU is
   created with material `Leather`.
2. Advance the model to Ordered and open Inward → STP requirement. The matrix
   has four columns; **the Leather SKU appears in none of them**. Its STP
   requirement cannot be decided from this screen at all.
3. Export from that screen. The Leather row is **absent**.
4. Open Reports → STP Requirement. The Leather row is **present**, showing "Not
   decided".
5. Trigger the email. The server-built report **includes** the Leather row.

**Business impact**

Three failures at once:

- **A requirement that cannot be decided.** The SKU's `stpRequired` stays
  `null` forever. Per BR-015 an undecided SKU does not block Production, so the
  model proceeds and the question is never answered.
- **Contradictory documents to an external party.** The factory and the MD
  receive an emailed report that lists a row the sender's own screen and export
  do not show. Whichever is used, one of them is wrong.
- **A silent whole-row omission**, not a visible error. Nobody is told
  anything.

Realistically this can mean a part made without required supplier paperwork, or
paperwork chased for a part that does not need it — the precise waste the
tri-state requirement design (BR-043, BR-044) exists to prevent.

**Recommended fix**

One shared row-builder for all three outputs. Drive the matrix columns from the
distinct materials actually present on the SKUs in the queue, with the four
defaults as the preferred ordering rather than the universe. Validate
bulk-pasted materials against the known list, warning on anything unrecognised
rather than accepting it silently. Longer term, move the material list to a
configuration table (AUD-019) and constrain the value.

**Verification approach**

The UAT-09 data set — a SKU with an off-list material — must produce identical
rows from the screen export, the Reports tab and the Edge Function, and its
requirement must be settable from the matrix.

---

## MEDIUM

### AUD-014 · Bulk operations issue one database write and one message per model

- **Severity:** Medium · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M6, M7, M8

**Evidence**

| Action | Implementation | Line |
| --- | --- | --- |
| Set a material column across all models | `queue.forEach((m) => setCell(m, mat, value))` | `src/App.jsx:4317` |
| Mark a marketplace live across all models | `Object.entries(byM).forEach(([id, patch]) => onSetListing(+id, patch))` | `src/App.jsx:3894` |
| Bulk inward several models | `selectedReady.forEach((m) => onMove(m.id, "received"))` | `src/App.jsx:4100` |
| Each call runs its own `setPhones` + `persist` + `saved()` | `setStpRequired` 5857-5869; `saveListings` 5872-5882; `move` 5799-5807 | — |

By contrast `InwardStock.saveAll` does this correctly, grouping per model before
writing (`src/App.jsx:4074-4083`) — so the right pattern already exists in the
codebase and simply is not used by the other three.

**Failure scenario**

Setting one material column across 25 queued models issues 25 whole-row PATCHes
and queues 25 messages, each of which also awaits *all* pending writes (see
AUD-017). The user sees a stream of messages and a long pause. If one model is
conflicted, the overall outcome is ambiguous: some writes land and some do not,
with no summary.

**Business impact**

Slow bulk actions, message spam that trains users to ignore messages, and no
clear statement of partial failure on an action the user believes was atomic.

**Recommended fix**

Collect the changes, apply them in one `setPhones`, persist each affected model
once, and emit a single summary message naming successes and failures. Follow
the `saveAll` pattern.

**Verification approach**

A column-wide set across N models issues N writes and exactly one message, and
names any model that failed.

---

### AUD-015 · The STP requirement matrix is keyboard-inoperable, and backward moves have no keyboard path on the board

- **Severity:** Medium · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** Accessibility

**Evidence**

| What | Where |
| --- | --- |
| Requirement cells are `<td onClick=…>` with no `role`, no `tabIndex` and no `onKeyDown` | `src/App.jsx:4400-4404` |
| Compare: table rows, KPI cards, to-do rows, funnel rows and calendar entries all have `role="button"`, `tabIndex={0}` and an Enter handler | `1634-1635`, `3523-3524`, `3623-3624`, `3729-3732`, `3027-3029` |
| Board cards are `draggable` with no keyboard equivalent | `src/App.jsx:1493` |
| Forward moves *do* have a keyboard path (the arrow button) | `src/App.jsx:1509-1518` |

**Reproduction**

Using the keyboard only, open Inward → STP requirement and attempt to set a
requirement cell. The cell cannot be focused. There is no alternative control
for the cell — the "Req"/"No" buttons act on a whole model or a whole column,
not on a single model-material cell. The decision is therefore **impossible**
for a keyboard-only or screen-reader user.

**Business impact**

A core Catalog responsibility — deciding whether the factory owes an STP file —
is unavailable to keyboard-only users. Given the deliberate accessibility work
elsewhere in this codebase (§2.2 item 9), this is an inconsistency rather than
a design position, and it is an employment-accessibility exposure.

**Recommended fix**

Make each cell a `<button>` inside the `<td>`, matching the listing grid's
pattern (`src/App.jsx:2258-2267`), which is already correct. Add a keyboard
path for backward moves on the board — the detail panel's back button covers
this today but requires opening the panel.

**Verification approach**

Complete UAT-20 with the keyboard alone, including setting a requirement cell.

---

### AUD-016 · Background re-reads protect only the detail panel; other screens' drafts are unprotected and orphans are dropped silently

- **Severity:** Medium · **Confidence:** High · **Type:** Confirmed defect
- **Module:** M14 Synchronisation

**Evidence**

| What | Where |
| --- | --- |
| The guard checks only `openIdRef.current` (detail panel) and `conflictedIdsRef.current.size` | `src/App.jsx:5577-5578` |
| `adding` (the add/import form) is not checked | `src/App.jsx:5561` |
| Inward draft state is local to `InwardStock` and not signalled upward | `src/App.jsx:4044` |
| STP requirement writes immediately, so it has no draft — but the PO builder's selection and typed number do | `src/App.jsx:4652-4653` |
| `saveAll` filters by `r.rid in draft` against the **fresh** SKU list, so draft entries for SKUs that no longer exist are silently discarded | `src/App.jsx:4078-4080` |

**Failure scenario**

A Catalog user spends several minutes entering received quantities for forty
SKUs on the Inward screen. At the 90-second tick a background re-read replaces
the entire model list. The typed values survive, because `valueOf` prefers the
draft (`src/App.jsx:4053`) — a good design. But if a colleague deleted or
re-identified a SKU in the meantime, that draft entry now matches no SKU, and
pressing Save discards it with no message. The "N unsaved" count had included
it.

Similarly, a PO builder selection of fifteen models survives the re-read as
state, but a model that left the eligible set is silently no longer part of the
assignment.

**Business impact**

Quietly lost receipt entries during the exact bulk workflow the screen exists to
make efficient, with a misleading unsaved count.

**Recommended fix**

Lift a single "has unsaved work" signal from each drafting screen and include it
in `shouldKeepLocalEdits`. On save, report any draft entry that no longer
matches a SKU rather than dropping it.

**Verification approach**

Begin an inward draft, change the underlying SKUs from another session, force a
sync, and confirm the user is told what could not be applied.

---

### AUD-017 · A success message awaits every pending write, so an unrelated failure suppresses it

- **Severity:** Medium · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M14 Messaging

**Evidence**

```
Promise.allSettled([...writeState.current.values()].map((w) => w.queue))
  .then((results) => {
    if (!results.some((r) => r.value?.error || r.value?.conflict)) say(text);
  });
```
`src/App.jsx:5719-5722`

`writeState` holds an entry per model that has ever been written in this session
(`src/App.jsx:5662-5665`), and entries are removed only on a successful full
load (`5611`). So the check spans every model touched since the last reload, not
the one the user just acted on.

**Failure scenario**

Model A conflicted an hour ago and its latch persists (AUD-008). The user now
successfully saves a SKU change on model B. `saved()` inspects all queues, finds
model A's conflict result, and **suppresses model B's confirmation**. The user
sees "SKUs saved — saving…" and then nothing. The save actually succeeded.

Conversely, a second action started while a first is in flight can have its
confirmation attributed to the wrong action.

**Business impact**

Users lose confidence in the messaging precisely when the application's
messaging honesty is its strongest feature (§2.2 item 5). A user who believes a
save failed will redo it, producing a second whole-row write.

**Recommended fix**

Have `saved()` await only the specific write it triggered. `persist` already
returns the queue promise (`src/App.jsx:5694`), so the handler can pass it
through rather than having `saved()` re-derive the set.

**Verification approach**

With one model latched, confirm that a successful save on a different model
still reports success.

---

### AUD-018 · Deleting a SKU orphans its sales entries, silently understating sales and overstating stock

- **Severity:** Medium · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M9 Sales and stock

**Evidence**

| What | Where |
| --- | --- |
| SKU rows are removed with no reference check | `src/App.jsx:1724` (`removeRow`), `1751` (save discards empties) |
| Sales entries reference the SKU only by `skuRid` | `src/App.jsx:2495` |
| `stockOfSku` matches entries by `skuRid` — an orphan matches nothing | `src/App.jsx:185` |
| `stockOfModel` subtracts only entries with **no** `skuRid`; an orphan has one, so it is subtracted nowhere | `src/App.jsx:199-201` |
| The history table renders an orphan's SKU as `—` | `src/App.jsx:2662` |
| SKUs stay editable through Production, and the editor is reachable at those stages | `src/App.jsx:2802` |
| No foreign key is possible — both live in the same JSONB row | `schema.sql:36-37` |

**Reproduction**

1. On a Live model, log 20 units sold against SKU `SIL-A57-BLK`.
2. Move the model back to Production (permitted for Admin or Catalog).
3. Delete that SKU in the editor and save.
4. Move forward to Live again.
5. The model's sales total still counts the 20 units (`salesSummary` iterates
   every entry regardless of `skuRid`, `src/App.jsx:258`), but
   `stockOfModel` no longer subtracts them from any SKU and does not treat them
   as model-level either. The history row shows SKU `—`.

The result is an internally inconsistent model: sales totals and stock on hand
no longer reconcile, with no error and no audit entry.

**Business impact**

Stock on hand is overstated, so the reorder signal (BR-055) does not fire when
it should. A SKU can stock out while the application reports healthy stock.

**Recommended fix**

Warn before deleting a SKU that has sales entries, and offer to re-point those
entries to model level. Structurally, promote sales entries to a child table
with a foreign key (AUD-004) so the database refuses the orphan.

**Verification approach**

Delete a SKU with sales and confirm the user is warned, and that afterwards the
model's sales total and stock figures still reconcile.

---

### AUD-019 · Core business parameters are hardcoded in the bundle

- **Severity:** Medium · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** Configuration

**Evidence**

| Parameter | Value | Where |
| --- | --- | --- |
| Marketplaces | Flipkart, Amazon, Meesho, Shopify | `src/App.jsx:95` (and duplicated as `SALE_MARKETPLACES` at `249`) |
| Materials and default quantities | four entries | `src/App.jsx:102-107` |
| Reorder threshold | 20% | `src/App.jsx:178` |
| Milestone schedule | 100 / 85 / 75 / 60 / 25 / 0 days | `src/App.jsx:57-62` |
| Lateness tolerance | 3 days | `src/App.jsx:331` |
| Session lifetime | 12 hours | `src/App.jsx:695` |
| Audit cap | 200 | `src/App.jsx:145` |
| Request timeout | 12 seconds | `src/App.jsx:666` |
| Sync interval | 90 seconds | `src/App.jsx:5636` |
| Price segments | Budget / Mid Range / Premium / Flagship | `src/App.jsx:2725`, `3136`, `3375`, `3788` — **duplicated in four places** |

The project has already set the precedent for fixing this: permissions were
moved out of the bundle into `role_permissions` with a documented fallback
(`schema-roles.sql:10-14`).

**Failure scenario**

`MARKETPLACES` is the worst case. Adding a fifth marketplace requires a code
change *and* a data migration of every SKU's `listings` object, because
`isFullyListed` requires every entry in the array to read `Live`
(`src/App.jsx:221`) — so on the day the array changes, every previously fully
listed SKU becomes incomplete and every Live model fails the gate it already
passed. Removing a marketplace leaves orphaned keys in stored data.

`MATERIALS` is the second worst, because it is the direct cause of AUD-013.

The duplicated price-segment literal in four locations is a straightforward
drift hazard: a fifth segment added to the add form but not to the import
parser silently becomes "Mid Range" on import.

**Business impact**

An ordinary commercial change — selling on a new marketplace, ordering a new
material — becomes a code release plus a data migration, and in the marketplace
case it transiently breaks the Live gate for the entire portfolio.

**Recommended fix**

Move marketplaces, materials, the reorder threshold, the stage schedule and the
segment list to a configuration table, following the `role_permissions`
pattern with compiled defaults as the fallback. De-duplicate the segment list
and `SALE_MARKETPLACES` immediately — that part is a pure refactor.

**Verification approach**

Add a fifth marketplace in configuration and confirm that previously fully
listed SKUs are handled explicitly rather than silently failing the gate.

---

### AUD-020 · Reorder evaluation excludes Received-stage stock, and delivery alerts have no resolution path

- **Severity:** Medium · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M9 Stock, M10 Alerts

**Evidence**

| What | Where |
| --- | --- |
| `reorderQueue` filters to `stage === "live"` only | `src/App.jsx:210` |
| Short-delivery and nil-delivery alerts are raised with **no stage condition**, so they fire at every stage including Live | `src/App.jsx:376-380` |
| The only way to clear them is to edit the receipt so no SKU reads `short` or `none` | `src/App.jsx:2062-2068` |
| The low-stock alert is correctly scoped to Live | `src/App.jsx:389-393` |

**Failure scenario — scope gap**

A model sits at Received with stock in the warehouse while the catalog team works
through the listing queue. During that window its stock is invisible to the
reorder queue, the Stock on hand KPI (which sums Live models only,
`src/App.jsx:3706`) and the low-stock to-do row. For a model held at Received
for a few weeks, nothing reports its depletion.

**Failure scenario — permanent alerts**

A supplier delivers 48 of 50 units and the business accepts the shortfall. The
receipt is correctly recorded as `short`. The model now raises "Short delivery —
2 units missing" **forever** — through Live, through its whole selling life.
There is no acknowledge, accept or resolve action. An accepted commercial
outcome is indistinguishable from an open problem, so the alert list accumulates
noise and users learn to ignore it, which undermines the alerts that matter
(BR-067's single-source design is otherwise a strength).

**Business impact**

Stock depletion unmonitored at Received; alert fatigue that degrades the whole
alerting mechanism; and no way to record that a shortfall was accepted. BRD
OQ-04 asks the business what should happen when a shortfall is accepted — the
answer determines the fix.

**Recommended fix**

Extend the reorder evaluation to Received-stage models. Add an explicit
acknowledgement to short and nil receipt outcomes — a fourth state, or an
`acceptedShortfall` flag — that suppresses the alert while preserving the
recorded shortfall in the report.

**Verification approach**

A Received model with depleting stock appears in the reorder queue. An accepted
shortfall stops alerting but still appears in the received report with its
shortfall intact.

---

### AUD-021 · Automated test coverage is approximately 1.3%, and there is no linter or type checker

- **Severity:** Medium · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** Maintainability

**Evidence**

| What | Where |
| --- | --- |
| The only test is `src/roles.selfcheck.mjs`, covering `src/roles.js` (86 lines) | **CHK-001** |
| Source totals 6,482 lines in `src/`, so 86 lines is **1.3%** | **CHK-003** |
| `package.json` has three scripts: `dev`, `build`, `preview`, plus `check` | `package.json:5-10` |
| No linter, formatter or type checker configuration exists anywhere | **CHK-003** |
| `README.md` states plainly: "There is no test suite, linter, or type checker currently." | `README.md` |
| Even the one test is not wired to CI, because CI does not exist | **AUD-007** |

**What is untested**

Every business rule documented in BRD §6, including: `gateBlock` (all five stage
gates), `moveStatus` and `advanceStatus` (every transition rule),
`plannedDate`/`delayOf`/`runwayOf` (all date arithmetic and the clamping rule),
`stockOfSku`/`stockOfModel` (the stock formula), `salesSummary` (rolling
windows and return rate), `problemsOf` (all 12 alert conditions), `splitRow`
(the quote-aware CSV parser), `buildReportRows` (all nine reports), `derive`,
`passesFilters`, and the entire persistence and conflict layer.

**Failure scenario**

The 6,391-line `src/App.jsx` has no automated safety net of any kind — not
tests, not types, not even linting for an unused variable or a typo in a
property name. A change to `gateBlock` that inverts a condition, or a rename
that misses one of the twenty `CAN.*` call sites, produces no failure anywhere
and ships. The existing self-check demonstrates the author knows how to write
one of these and that the pattern works well — it is simply not applied beyond
the permissions module.

**Business impact**

Every future change carries unquantified regression risk to rules the business
depends on. This finding is the main reason the §4 remediation plan puts tests
(Phase 2.1) before the structural refactor (Phase 2.3): refactoring a file this
size without tests would be reckless.

**Recommended fix**

Extend the `roles.selfcheck.mjs` pattern — zero-dependency, assertion-based,
runnable by `node` — to the pure functions listed above. They are almost all
pure already, which makes this cheap: value in, value out, no React, no mocks.
Add a linter and type checking. Wire all three into the workflow from AUD-007.

**Verification approach**

Every business rule in BRD §6 has at least one assertion. A deliberately
inverted gate condition fails the check.

---

### AUD-022 · Avoidable render cost on the Reports and Dashboard views

- **Severity:** Medium · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** Performance

**Evidence**

| What | Where |
| --- | --- |
| The active report is memoised | `src/App.jsx:4953` |
| But every tab's count rebuilds its **entire** report on every render — nine full passes | `src/App.jsx:4964` (`buildReportRows(d.key, models).rows.length`) |
| `Dashboard` computes `problemsOf` across all models, `listingQueue` and `reorderQueue` with **no memoisation** | `src/App.jsx:3572`, `3576-3577` |
| `reorderQueue` itself calls `stockOfModel` per model, which calls `stockOfSku` per SKU | `src/App.jsx:208-214`, `194-205` |
| Fourteen KPI cards each recompute their own filters and sums | `src/App.jsx:3543-3565` |
| `derive` over the model list **is** correctly memoised | `src/App.jsx:5734` |
| The Dashboard re-renders on every message, sync-state change and navigation | `src/App.jsx:5564`, `5557` |

**Failure scenario**

With 200 models averaging 8 SKUs, opening Reports rebuilds nine reports — each
flat-mapping every model's SKUs — on every render, including each render caused
by a transient message. The Dashboard recomputes the alert set and both queues
on every render for the same reason.

This is latent rather than currently harmful: at today's presumably modest
volumes it will not be noticeable. BRD OQ-14 asks for the expected volumes,
which determines when it starts to matter.

**Business impact**

Interaction latency that grows with the data, on the two views used most.

**Recommended fix**

Memoise the report tab counts on `[models]`. Memoise `problems`, `pendingSkus`
and `lowStock` in `Dashboard` on `[models]`. Cheap, local and behaviour-neutral.

**Verification approach**

Profile the Reports and Dashboard renders with a representative data set before
and after.

---

### AUD-023 · 98.6% of the application is in one 6,391-line file

- **Severity:** Medium · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** Maintainability

**Evidence**

| What | Measure |
| --- | --- |
| `src/App.jsx` | 6,391 lines — 98.6% of `src/` |
| Components in that one file | 34 (see §2.4) |
| `App` itself | 872 lines (`5520-6391`), holding all state and all 25 handlers |
| The `CSS` template literal | 294 lines (`908-1201`) |
| Properly extracted | `src/roles.js`, 86 lines — and it is the only tested module, which is not a coincidence |

**Failure scenario**

Any change requires reading or searching a 6,391-line file. Module-scope mutable
state (`ROLES`, `ROLE_CAN_ADVANCE_TO`, mutated in place by `applyRoleTables`,
`src/App.jsx:488-492`) exists specifically because components sit outside `App`
in the same file — the author documents this as a deliberate shortcut with its
upgrade condition (`483-487`), which is good practice, but it is a shortcut that
compounds. With no tests, no types and no linting (AUD-021), there is nothing to
catch a mistake during a change.

The extraction of `src/roles.js` shows both the right instinct and the payoff:
the moment logic left the monolith, it became testable, and it got tested.

**Business impact**

Slow, risky changes; a high barrier for any second developer; and a structural
obstacle to the test coverage that AUD-021 requires.

**Recommended fix**

Split by domain — `stages.js`, `derive.js`, `db.js`, `reports.js`, `styles.js`,
`views/` — preserving behaviour exactly. **After** the tests from AUD-021 exist,
not before. Replace the module-scope mutable tables with a React context as the
author's own comment anticipates.

**Verification approach**

The self-check suite passes unchanged after the split, and the build output is
functionally equivalent.

---

### AUD-024 · The audit trail silently truncates, and some mutations are unaudited

- **Severity:** Medium · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M13 Audit

**Evidence**

| What | Where |
| --- | --- |
| `AUDIT_CAP = 200`; `withAudit` applies `.slice(-AUDIT_CAP)` | `src/App.jsx:145`, `157` |
| No warning, no message and no record that entries were dropped | `src/App.jsx:155-158` |
| `deleteNote` writes **no** audit entry | `src/App.jsx:6025-6032` |
| `deleteAttachment` writes **no** audit entry | `src/App.jsx:6045-6052` |
| The audit lives in the same JSONB row that every save rewrites | `schema.sql:40` |
| The History pane is capped at 340 px with scroll — a display concern only | `src/App.jsx:2457-2458` |

**Failure scenario**

A model with many SKUs, worked by four teams across a season, easily exceeds 200
audit entries — every stage move, SKU save, STP update, receipt, listing change,
sale, note and attachment generates one. The earliest entries, which include the
original research decision, the first SKU definition and the PO assignment, are
silently discarded. Nothing records that the trail is incomplete, so a reader
cannot distinguish "nothing happened before this" from "the record was
truncated".

Separately, a user can delete a colleague's note or an attachment link —
possible for **every** signed-in role (AUD-009) — with no trace whatsoever.

**Business impact**

The audit trail cannot be relied on for the oldest and often most consequential
decisions on a long-running model, and the deletion of evidence is itself
untracked. BRD OQ-12 asks the business what retention is actually required.

**Recommended fix**

Audit deletions. Move the audit to an append-only child table with no cap — the
cap exists only because the audit shares the model's row (AUD-004), so fixing
that fixes this. Until then, record a marker entry when truncation occurs so the
gap is visible.

**Verification approach**

Deleting a note writes an audit entry. A model exceeding 200 events retains or
visibly marks its earliest history.

---

### AUD-025 · Completion dates cannot be set retrospectively, so backfilled models report as perfectly on time

- **Severity:** Medium · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** M3 Lifecycle, M11 Reporting

**Evidence**

| What | Where |
| --- | --- |
| A forward move stamps `iso(TODAY)` on every unstamped stage up to the target | `src/App.jsx:5785` |
| `ResearchEditor` edits brand, name, launch and segment — **not** `done` | `src/App.jsx:2690-2738` |
| No other control writes `done` | **CHK-004** |
| `plannedDate` clamps the target to `done.research` | `src/App.jsx:289-291` |
| `delayOf` compares `done[stage]` to that clamped target | `src/App.jsx:295-302` |

**Failure scenario**

The business adopts the application mid-season and enters six models already at
Production. Each is created today (so `done.research` is today) and advanced
three times, stamping today for research, planned, ordered and production.

`plannedDate` then clamps every target to today. `delayOf` compares today
against today and returns 0. Every backfilled model reports **zero delay**, and
`isLate` is false, however late it actually was.

The clamping rule itself is correct and well reasoned — BR-020, "you cannot be
late for something you did not know existed". The defect is that there is no way
to tell the application that you *did* know, and when.

**Business impact**

Any delay analysis spanning the adoption period is silently wrong in the
flattering direction. KPI-02 and KPI-03 cannot be trended across it. Combined
with the total absence of historical reporting (RG-01), there is no way to detect
this from within the application.

**Recommended fix**

Allow an audited edit of `done` dates, restricted to Admin or Procurement, with
the audit entry recording the old and new values. BRD OQ-07 asks the business
how it wants in-flight models entered.

**Verification approach**

Backfill a model with historical dates and confirm its delay figures match the
real history, with the edit recorded in the audit trail.

---

### AUD-026 · No observability: failures are visible only to the user who hits them

- **Severity:** Medium · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Module:** Operability

**Evidence**

| What | Where |
| --- | --- |
| No error reporting integration anywhere | **CHK-003** |
| No React error boundary, so a render error blanks the application | **CHK-004** |
| Failures surface only as a 2.5-second toast | `src/App.jsx:5706` |
| No client logging of conflicts, timeouts or save failures | **CHK-004** |
| The only server-side record of anything is `report_send_log` | `schema-report-approval.sql:21-29` |
| No metrics and no health check | — |

**Failure scenario**

A user hits a save conflict, a 12-second timeout or a PostgREST error. A toast
appears for 2.5 seconds and vanishes. Nothing is recorded. If it happens to five
users daily nobody learns, because each person assumes it was their own
connection. There is no way to know whether AUD-004's conflict problem is
theoretical or a daily occurrence — which is precisely the question that should
decide how urgently to fix it.

A JavaScript error during render produces a blank page with no boundary and no
report.

**Business impact**

Recurring problems go unfixed because they are invisible. Remediation cannot be
prioritised by actual frequency, only by code reading — which is what this audit
has had to do.

**Recommended fix**

Add an error boundary with a recovery action. Add error reporting. Log save
conflicts, timeouts and failures with enough context to count them.

**Verification approach**

A forced render error shows a recovery UI and produces a report. A forced
conflict appears in the log.

---

### AUD-027 · Bulk receive re-checks against a render-time copy of the model list

- **Severity:** Medium · **Confidence:** High · **Type:** Confirmed defect
- **Module:** M5 Bulk receive

**Evidence**

| What | Where |
| --- | --- |
| `bulkReceive` iterates `phones` — the state value captured at render, not inside the updater | `src/App.jsx:5901` |
| The stage re-check reads that same captured copy | `src/App.jsx:5903` |
| The gate re-check also reads it | `src/App.jsx:5905` |
| The actual mutation then runs inside `setPhones((list) => …)`, which does receive the current value | `src/App.jsx:5923-5943` |
| Compare: every other handler derives its target inside the updater | e.g. `src/App.jsx:5823-5826` |

**Failure scenario**

A Catalog user opens Receive against a PO and marks four models received. A
background sync has not run (or ran and was suppressed). Meanwhile a colleague
moved one of those models back to Ordered and cleared its PO. The user presses
Apply.

The guard at line 5903 checks the **stale** copy, which still says
`stage === "production"`, so the model passes. The mutation then runs against the
current list and sets it to Received with every SKU marked received in full —
overwriting the colleague's correction with no warning.

The optimistic lock does not help here: the version stamp held in `writeState`
is also from before the colleague's change, so the PATCH may well be rejected as
a conflict — which turns a silent wrong write into a confusing conflict on an
action the user believed was validated. Either outcome is wrong.

The irony is that `bulkReceive` is the *most* careful handler in the codebase —
it re-checks the permission, the stage and the gate, and reports skipped models
by name. It simply does all that against the wrong copy of the data.

**Business impact**

A bulk receipt can silently overwrite a colleague's correction, or fail
confusingly, in the one workflow that acts on many models at once.

**Recommended fix**

Move the classification inside the `setPhones` updater so the stage and gate
checks read the current list, or re-derive from `models` at the moment of the
click and re-validate inside the updater before mutating.

**Verification approach**

Mark a model received, change its stage from another session, then apply.
Confirm the model is skipped with a named reason rather than overwritten.

---

## LOW

### AUD-028 · CSV import has no row cap and issues one request per model

- **Severity:** Low · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Evidence:** 2 MB file cap but no row cap (`src/App.jsx:3092`); `importPhones` maps every row to a separate `persist` inside one `Promise.all` (`6081`); each is a full row insert.
- **Failure scenario:** A 2 MB file is roughly 40,000 rows. The preview renders all of them in a scrollable table (capped only by CSS at 260 px), then the import fires tens of thousands of near-simultaneous inserts. Expect browser stall, rate limiting and a partial import reported only as a count and the first error.
- **Impact:** An accidental large paste is painful to recover from; there is no undo for a partial import.
- **Fix:** Cap rows (a few hundred), virtualise or truncate the preview, batch the inserts into one request per chunk, and show progress.
- **Verification:** Import a 5,000-row file and confirm a clear refusal or a batched import with progress and an accurate summary.

### AUD-029 · The email approval is consumed before the send is attempted

- **Severity:** Low · **Confidence:** High · **Type:** Confirmed defect
- **Evidence:** `claim_report_approval` sets `consumed_at = now()` and returns true (`schema-report-approval.sql:67`) before `send-stp-report` builds the report (`index.ts:29`) or calls Resend (`40`). A provider failure marks the log row failed and returns 502 (`42`) but the approval is already spent. An empty report returns 422 (`37`) — also after consumption.
- **Failure scenario:** Resend has a transient failure, or the report has no rows. The user must request a fresh code and ask the approver again. Three such failures within an hour exhaust the per-IP limit (BR-118) and the user cannot send at all for the rest of the hour.
- **Impact:** Operational friction on a workflow that already requires a second person's involvement.
- **Fix:** Consume the approval only after a successful send, or allow a bounded number of re-sends against the same approval, keeping the idempotency key so no duplicate email can result.
- **Verification:** Force a provider failure and confirm the same code can be retried.

### AUD-030 · The in-application setup screen instructs the operator to run the destructive schema script

- **Severity:** Low (likelihood) / **High (impact)** · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Evidence:** `DBSetupScreen` step 2 reads "Run **schema.sql** in the SQL Editor" with no warning (`src/App.jsx:5335`). `schema.sql:8-11` begins `drop view if exists stage_summary; drop table if exists phones cascade; drop table if exists users cascade;`. `README.md` carries a prominent warning; the screen does not. The screen is reachable at any time from the header gear control (`src/App.jsx:6189-6195`), not only during first-time setup.
- **Reproduction:** An admin opens the setup screen to re-point an existing installation at a different project, follows the on-screen steps, and runs `schema.sql` against the populated database. Every model, user and audit trail is dropped. There is no soft delete, no undo and no backup mechanism in the repository.
- **Impact:** Total irrecoverable data loss from following the application's own instructions. Rated Low on likelihood only because it requires an admin to run SQL manually; the impact is unquestionably High, which is why it is in Phase 1 of the remediation plan.
- **Fix:** Remove the instruction from the screen, or replace it with a non-destructive bootstrap script and reserve `schema.sql` for a documented clean install, carrying the warning inline. Establish a backup or point-in-time-recovery policy.
- **Verification:** The setup screen never instructs a destructive action without an explicit inline warning. Covered by BRD UAT-22.

### AUD-031 · "Today" is captured once at module load and never recomputed

- **Severity:** Low · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Evidence:** `const TODAY = new Date(); TODAY.setHours(0,0,0,0);` at `src/App.jsx:32`, evaluated once per page load. Used by `iso(TODAY)` for stage completion stamps (`5785`, `5927`), the research date on create (`3335`) and import (`6075`), `daysFromToday` (`42`), `plannedDate`'s fallback (`290`), `runwayOf` (`308`), `delayOf`'s overdue calculation (`300`) and the sales form default (`2483`).
- **Failure scenario:** The session lasts 12 hours (BR-086) and the application is built for all-day use with a 90-second sync, so a tab left open overnight is realistic. After midnight every stage move stamps **yesterday's** date, new models get yesterday as their research date, and every days-to-launch and overdue figure is one day stale. Nothing indicates this.
- **Impact:** Off-by-one dates on stage completions and deadlines after a date rollover — silent, and it corrupts exactly the delay data the product exists to report.
- **Fix:** Make `today()` a function, or recompute `TODAY` on window focus and on a midnight timer. The focus handler already exists (`src/App.jsx:5637`).
- **Verification:** With a tab open across a simulated midnight, a stage move stamps the new date.

### AUD-032 · Dead code and an unused database view

- **Severity:** Low · **Confidence:** Confirmed · **Type:** Confirmed defect
- **Evidence (CHK-005):** `persistLegacy` defined at `src/App.jsx:5642-5656`, never called — and it is the *pre-optimistic-lock* write path, so it is actively misleading next to the correct `persist`. `money()` defined at `src/App.jsx:44`, never called (`SalesTracker` and the Dashboard inline their own rupee formatting at `2521`, `2665`, `3686`). The `stage_summary` view is created in `schema.sql:67-81` and queried nowhere. `SALE_MARKETPLACES` (`249`) duplicates `MARKETPLACES` (`95`) with identical contents.
- **Impact:** A reader cannot tell which write path is live; a maintainer may extend the wrong one. The view implies a reporting dependency that does not exist. Minor but gratuitous confusion in a file already carrying AUD-023.
- **Fix:** Delete `persistLegacy`. Either use `money()` in the three inline sites or delete it. Drop `stage_summary` or use it for the dashboard stage counts. Alias `SALE_MARKETPLACES` to `MARKETPLACES`.
- **Verification:** No unreferenced exports or functions remain; a linter (AUD-021) enforces this going forward.

### AUD-033 · The Edge Function origin check is not an authorisation control

- **Severity:** Low · **Confidence:** Confirmed · **Type:** Suspected risk
- **Evidence:** Both functions gate on `req.headers.get("origin") === origin` (`request-stp-report-approval/index.ts:7`, `42`; `send-stp-report/index.ts:5`, `19`). `verify_jwt = false` for both (`supabase/config.toml`), deliberately, so browser preflight can reach the handlers — documented at `REPORT-EMAIL-SETUP.md:31-33`.
- **Failure scenario:** An `Origin` header is trivially set by any non-browser client. `curl -H "Origin: https://pethupraveen.github.io" -X POST .../request-stp-report-approval` reaches the handler and, subject only to the 3-per-hour per-IP limit (BR-118), emails an approval code to the configured approver. Across a pool of IP addresses this becomes a low-volume mail nuisance targeting the approver's mailbox, and a Resend cost.
- **Mitigation already present:** This is genuinely well handled on the send side — the code is 8 characters from a 32-symbol alphabet (about 10¹² combinations), single-use, 10-minute expiry, 5 attempts, peppered hashes. An attacker who cannot read the approver's mailbox cannot send a report. The exposure is **nuisance and cost**, not unauthorised sending.
- **Fix:** Document explicitly that the origin check is CORS convenience and not authorisation (so no future reader relies on it). Consider a lower per-IP limit, a global hourly cap, or a CAPTCHA-equivalent on the request endpoint.
- **Verification:** Confirm the global request rate is bounded independently of IP.

### AUD-034 · The detail panel remounts on every successful save, discarding sibling drafts

- **Severity:** Low · **Confidence:** High · **Type:** Confirmed defect
- **Evidence:** `<Detail key={`${open.id}:${open.updatedAt || ""}`} …>` (`src/App.jsx:6310`). A successful write updates `updatedAt` in state (`5688`), changing the key and forcing a full remount. Every child editor initialises its draft once with `useState(() => …)`: `PlannedSKUEditor` (`1716-1718`), `ProductionSTP` (`1955-1957`), `ReceivedChecker` (`2051-2058`), `ListingEditor` (`2172-2174`).
- **Failure scenario:** On a Production model, a user edits several SKU rows (unsaved), then — before saving them — notices the PO is wrong and saves the PO. The PO write succeeds, `updatedAt` changes, the panel remounts, and `PlannedSKUEditor` re-initialises from stored data. **The unsaved SKU edits are gone**, with no warning. The two editors are visible simultaneously on that stage (`2802`, `2814-2816`), so this is an ordinary sequence rather than a contrived one.
- **Impact:** Silent loss of unsaved work within a single panel. Low severity only because the lost work is typically small and immediately visible as reverted.
- **Note:** The key is deliberate and solves a real problem — it pulls fresh server state into the editors after a save. The fix must preserve that without discarding drafts.
- **Fix:** Key only on `open.id`, and have each editor reconcile against new props explicitly, merging server changes without discarding local edits.
- **Verification:** Edit SKUs without saving, save the PO, and confirm the SKU draft survives.

### AUD-035 · The "Excel" export is tab-separated text with an `.xls` extension

- **Severity:** Low · **Confidence:** Confirmed · **Type:** Optional improvement
- **Evidence:** `downloadReport` writes tab-separated text with MIME `application/vnd.ms-excel` and extension `.xls` (`src/App.jsx:3463`, `3466-3467`). A UTF-8 BOM is prepended to both formats (`3446`). The import side acknowledges the consequence: "The app's Excel template is tab-delimited text with an .xls extension. Native .xlsx workbooks still need to be saved as CSV first." (`3086-3087`).
- **Failure scenario:** Excel shows "The file format and extension don't match… Do you want to open it anyway?" on every download. Users learn to dismiss security prompts. The prepended BOM can appear as stray characters in the first header cell in some tools. Some corporate policies block the mismatch outright.
- **Impact:** Friction and a mild security-hygiene concern (training users to click through warnings) on an otherwise fine feature. Not a correctness defect — the data is intact.
- **Fix:** Name it `.tsv`, or label the button "Download for Excel (TSV)", or generate a real `.xlsx`. The first two are one-line changes. Omit the BOM from the TSV variant.
- **Verification:** Opening the exported file produces no format warning.

### AUD-036 · A code comment describes an unreachable Un-Procurement scenario

- **Severity:** Low · **Confidence:** Confirmed · **Type:** Optional improvement
- **Evidence:** `moveTo`'s comment at `src/App.jsx:5780-5782` reads "A phone un-procured at Ordered really did pass Planned and Ordered, and it still holds the PO and SKUs from that run". But `moveStatus` permits Un-Procurement **only** from Research (`593-595`): "Only Research models can move to Un-Procurement". A model can therefore never be un-procured at Ordered, so the state the comment justifies cannot arise through the UI. The Admin permission matrix does let any role be granted the Un-Procurement stage (`5235-5241`), but that grants the *role* permission, not an exemption from the stage gate.
- **Failure scenario:** No runtime failure. A maintainer reading the comment reasonably concludes that un-procuring from any stage is supported and may relax the gate, or may write code depending on the richer `done` map that cannot occur.
- **Impact:** Misleading documentation on a transition rule. It also flags a genuine open business question — BRD OQ-05 asks whether un-procuring from later stages *should* be possible, which the contradiction suggests was once intended.
- **Fix:** Either restrict the comment to the reachable case, or widen the gate if later-stage un-procurement is wanted. Decide via OQ-05.
- **Verification:** The comment and the gate agree; a test asserts which transitions reach Un-Procurement.

---

## 4. Prioritised remediation backlog

Ordered by risk-reduction per unit of effort. Effort: S ≈ under a day, M ≈ a few
days, L ≈ a week or more, for one developer familiar with the code.

### Phase 1 — before this application holds data anyone would miss

| # | Action | Findings | Effort | Why first |
| --- | --- | --- | --- | --- |
| 1 | Replace PIN login with Supabase Auth; role as an authenticated claim. | AUD-001, AUD-005 | L | Everything else in Phase 1 depends on an identity the client cannot forge. |
| 2 | Role-based RLS read and write policies; remove `users` read access; restrict `DELETE` on `phones`. Establish a backup / PITR policy. | AUD-002, AUD-003 | L | Closes total data loss and total disclosure. |
| 3 | Guard the last administrator against removal and demotion; document a break-glass recovery. | AUD-011 | **S** | Highest ratio in the list, and it must land **with** item 2 — correct RLS turns today's nuisance lockout into a real denial of service. |
| 4 | Remove the `schema.sql` instruction from the setup screen; add an inline destructive warning; add a non-destructive bootstrap script. | AUD-030 | **S** | One edit prevents irrecoverable loss from following the app's own instructions. |
| 5 | Commit the CI workflow running `npm ci`, `npm run check`, `npm run build`; reconcile every documented file reference. | AUD-007 | **S** | Nothing can be safely remediated until the release path is reproducible. |
| 6 | One shared STP requirement row-builder; drive matrix columns from the data present. | AUD-013 | M | Stops contradictory documents reaching the factory and the MD. |
| 7 | Neutralise formula-injection in all exports and the email attachment; validate attachment URL schemes. | AUD-006 | **S** | Two small changes; the report crosses an organisational boundary. |
| 8 | Add `CAN.*` guards to the eleven unguarded handlers; decide whether notes and attachments need permission keys. | AUD-009 | **S** | Cheap, and it is the layer that starts mattering once item 2 lands. |

### Phase 2 — before the next significant feature

| # | Action | Findings | Effort |
| --- | --- | --- | --- |
| 9 | Assertion-based unit tests for every business rule in BRD §6, extending the existing self-check pattern. | AUD-021 | L |
| 10 | Add a linter and type checking; wire both into CI. | AUD-021 | M |
| 11 | Fix `bulkReceive` to classify inside the state updater. | AUD-027 | **S** |
| 12 | Clear the conflict latch on a single-model re-read; stop suppressing all background reloads for one conflict. | AUD-008 | **S** |
| 13 | Make `saved()` await only its own write. | AUD-017 | **S** |
| 14 | Recompute "today" on focus and at midnight. | AUD-031 | **S** |
| 15 | Switch SKU identifiers to `crypto.randomUUID()`. | AUD-012 | **S** |
| 16 | Memoise the report tab counts and the Dashboard queues. | AUD-022 | **S** |
| 17 | Make the STP requirement cells real buttons; add a keyboard path for backward moves. | AUD-015 | **S** |
| 18 | Batch bulk operations into one write and one message per action. | AUD-014 | M |
| 19 | Key `Detail` on id alone and reconcile editor drafts against new props. | AUD-034 | M |
| 20 | Lift an "unsaved work" signal from each drafting screen into the sync guard; report dropped orphan drafts. | AUD-016 | M |
| 21 | Warn before deleting a SKU with sales entries. | AUD-018 | **S** |
| 22 | Split `src/App.jsx` by domain — **after** item 9. | AUD-023 | L |
| 23 | Promote SKUs and sales entries to child tables; per-SKU writes. | AUD-004, AUD-012, AUD-018 | L |
| 24 | Audit note and attachment deletions; move the audit to an append-only child table. | AUD-024 | M |

### Phase 3 — operational maturity

| # | Action | Findings | Effort |
| --- | --- | --- | --- |
| 25 | Error boundary, error reporting, and a conflict log. | AUD-026 | M |
| 26 | Paginate and field-select the sync read. | AUD-004 | M |
| 27 | Daily stage/delay snapshot and a cycle-time report. | AUD-025, RG-01, RG-02 | M |
| 28 | Move marketplaces, materials, thresholds and the stage schedule to configuration; de-duplicate the segment list and `SALE_MARKETPLACES`. | AUD-019, AUD-032 | M |
| 29 | Audited editing of completion dates for backfill. | AUD-025 | **S** |
| 30 | Consume the email approval only after a successful send. | AUD-029 | **S** |
| 31 | Extend reorder evaluation to Received; add shortfall acknowledgement. | AUD-020 | M |
| 32 | Delete `persistLegacy`, resolve `money()`, drop or use `stage_summary`. | AUD-032 | **S** |
| 33 | Cap and batch CSV import; add progress. | AUD-028 | **S** |
| 34 | Rename the `.xls` export or emit real `.xlsx`. | AUD-035 | **S** |
| 35 | Reconcile the Un-Procurement comment with the gate. | AUD-036 | **S** |
| 36 | Pin dependencies exactly; add `engines`; add update and vulnerability scanning. | §5.3 | **S** |

### Quick wins

Fourteen findings are **S** effort, including three Critical/High dependencies
(items 3, 4, 5) and two security fixes (items 7, 8). Phase 1 items 3, 4, 5, 7
and 8 together are plausibly under two days and close one High-impact data-loss
path, one organisational lockout, the release-reproducibility gap and two output
sinks.

---

## 5. Checks executed and results

### 5.1 Executed

| ID | Check | Command | Result |
| --- | --- | --- | --- |
| CHK-001 | Permissions self-check | `npm run check` | **PASS** — printed `roles.js OK`. All assertions in `src/roles.selfcheck.mjs` passed. Warning: `MODULE_TYPELESS_PACKAGE_JSON` (no `"type": "module"` in `package.json`). |
| CHK-002 | Production build | `npm run build` | **PASS** — 1500 modules, 1.69 s. `dist/index.html` 0.59 kB (0.41 kB gz); `dist/assets/index-CFAe8xUG.js` 328.65 kB (95.27 kB gz). Warning: Vite CJS Node API deprecated. Wrote to git-ignored `dist/`. |
| CHK-003 | Inventory and line counts | `find`, `ls -la`, `wc -l` | Complete. 4 source files (6,482 lines), 2 Edge Functions (115), 5 SQL files, 2 Markdown docs, 6 config files. No linter, formatter or type-checker configuration present. |
| CHK-004 | Full source review | Line-by-line read | Complete for every artefact in §1.1. |
| CHK-005 | Dead-code verification | `grep -n` for `persistLegacy`, `money`, `stage_summary` | Confirmed: `persistLegacy` defined `src/App.jsx:5642`, 1 occurrence (definition only). `money` defined line 44, 1 occurrence. `stage_summary` 0 occurrences in `src/`. → AUD-032 |
| CHK-006 | Permission-guard verification | `grep -n 'CAN\.'` across handlers | Confirmed: guards present in 5 handlers, absent in 11. `onSalesLog={logSale}` passed unconditionally at `src/App.jsx:6310` while siblings use `CAN.x(role) ? h : null`. → AUD-009 |
| CHK-007 | Last-admin guard verification | `grep -n 'list.length <= 1'` | Confirmed: `src/App.jsx:5082` is the sole guard and tests total accounts, not admin count. → AUD-011 |
| CHK-008 | STP material-source verification | `grep -n MATERIAL_NAMES` | Confirmed: used at `4325`, `4372`, `4378`, `4397` (matrix + its export). Reports tab groups by stored material at `4892`; Edge Function at `send-stp-report/index.ts:34`. Three implementations. → AUD-013 |
| CHK-009 | Deployment artefact | `ls -la .github` | **Absent** — `No such file or directory`. → AUD-007 |
| CHK-010 | Documented migration | `ls`, `grep` | **Absent** — `REPORT-EMAIL-SETUP.md:7` references `schema-pin-login-rollback.sql`; no such file. → AUD-007 |
| CHK-011 | Office automation availability | PowerShell COM probe | **PASS** — Word 16.0, PowerPoint 16.0. Used to generate the DOCX and PPTX deliverables. |
| CHK-012 | Git baseline | `git log -1`, `git status --porcelain` | Confirmed: `afad51c`, 2026-11-16. Working tree clean apart from untracked `deliverables/` and `.presentation-build/`. |

### 5.2 Not executed, and why

| Check | Reason |
| --- | --- |
| Linting | Not configured in the project (`README.md` confirms). |
| Type checking | Not configured. |
| Tests beyond CHK-001 | None exist (AUD-021). |
| Database migrations | Out of scope by instruction; `schema.sql` is destructive (AUD-030). |
| Any Supabase read or write | No credentials used. `.env.local` deliberately not opened. |
| Edge Function deployment or invocation | Requires deployment; `send-stp-report` consumes a paid email service. |
| Email send | Paid integration; would email real configured recipients. |
| Runtime browser testing | No deployed instance and no database available. |
| Two-browser concurrency testing | Requires a live database. |
| Automated accessibility audit | Requires a running instance. |
| Load and performance testing | Requires a running instance and representative data. |
| Penetration testing | Requires authorisation and a target environment. The reproduction steps in AUD-001 to AUD-003 are derived from code and schema, **not executed**. |

### 5.3 Observations arising from the checks

1. **Both executed checks pass.** The project builds cleanly and its one test
   passes. Nothing in this report contradicts that — the findings concern what
   is *not* checked, not a broken build.
2. **Two warnings are worth clearing.** `package.json` lacks `"type": "module"`,
   making Node re-parse `src/roles.js` on every check run; and Vite's CJS Node
   API is deprecated, which will eventually break the build. Both are one-line
   fixes and neither is in the backlog above because neither currently affects
   behaviour.
3. **No dependency is exactly pinned** — every entry in `package.json` carries a
   caret, there is no `engines` field and no `.nvmrc`. `package-lock.json` is
   committed, which mitigates this for reproducible installs but not for a
   future `npm update`. No vulnerability scanning is configured.
4. **Bundle size is reasonable** at 95 kB gzipped for an application of this
   functional breadth, with no code splitting. There is no performance reason to
   split it; AUD-023's recommendation is about maintainability only.

---

## 6. Coverage limitations and unresolved questions

### 6.1 Limitations bounding every finding

1. **No runtime environment.** No Supabase project, no deployed application, no
   browser session. Everything except CHK-001 and CHK-002 is static analysis.
   Conclusions about concurrency outcomes, RLS effects, email delivery and
   accessibility in practice are inferences from code and SQL, not
   observations. Findings marked **High** rather than **Confirmed** confidence
   are exactly those whose consequence depends on a runtime condition.
2. **Database state unknown.** Whether the five SQL files have been applied to
   the live project, in what order, and whether the live schema matches them,
   could not be determined. AUD-001 to AUD-003 assume the committed schema
   reflects the deployed one. **If the live database has tighter policies than
   `schema.sql` declares, those three findings change severity.** This is the
   single most important thing to verify before acting on this report.
3. **Deployment state unknown.** `README.md` links a live GitHub Pages URL, but
   the publishing workflow is absent. How the live instance is built and
   deployed is unknown (BRD OQ-10).
4. **Server configuration unknown.** The seven Edge Function secrets, including
   the approver and recipient lists, were not read.
5. **No stakeholder input.** Severity and likelihood are this audit's judgement,
   assuming the data carries at least some commercial sensitivity. BRD OQ-13
   governs that assumption.
6. **Credentials not inspected.** `.env.local` exists and was deliberately not
   opened. No credential, token, key or private value appears in any
   deliverable.
7. **Reproduction steps for AUD-001 to AUD-003 were not performed.** They are
   derived from the code and schema. They should be confirmed in a controlled
   environment before being treated as demonstrated.
8. **Pre-existing deliverables not reviewed.** `deliverables/` already contained
   three PPTX/PDF pairs dated 6 Nov 2026 from an earlier scope and KRA/KPI
   exercise. Their content was not reviewed, reconciled or superseded.

### 6.2 Unresolved questions

Technical questions this audit could not settle:

| ID | Question | Blocks |
| --- | --- | --- |
| UQ-01 | Do the live database's RLS policies match `schema.sql`, or has someone tightened them since? | The severity of AUD-001 to AUD-003 |
| UQ-02 | Have `schema-roles.sql` and `schema-report-approval.sql` been applied? | Whether permissions come from the database or the compiled fallback, and whether the email flow works at all |
| UQ-03 | Is `schema-pin-login-rollback.sql` missing from the repository, or was it never written? | Reconstructing the migration order (AUD-007) |
| UQ-04 | What publishes the live GitHub Pages site today? | Any remediation deployment (AUD-007) |
| UQ-05 | How many models, SKUs and concurrent users exist in practice? | Whether AUD-004 and AUD-022 are latent or active |
| UQ-06 | How often do save conflicts actually occur? | Priority of AUD-008 — and unanswerable today because of AUD-026 |
| UQ-07 | Does React 18 in the target browsers actually navigate a user-initiated `javascript:` href in a new tab? | The confirmed-versus-suspected status of half of AUD-006 |
| UQ-08 | Is there any backup or point-in-time recovery on the Supabase project? | The real impact of AUD-003 and AUD-030 |

Business questions are catalogued as OQ-01 to OQ-15 in BRD §15. The four that
most affect this report's conclusions are OQ-13 (data sensitivity → the urgency
of all three Critical findings), OQ-10 (deployment → AUD-007), OQ-01 (the
milestone schedule → whether delay reporting is meaningful at all) and OQ-04
(shortfall tolerance → AUD-020).

---

## 7. Overall assessment

**The workflow engine is well built. The security model does not exist.**

This is an unusually disciplined application in the respects its author chose to
be disciplined about. The convergence of every stage change on a single gate
function, the refusal to store anything derivable, the correctly implemented
optimistic lock with a trigger-owned version stamp, the deliberate choice of
INSERT over upsert, the separation of first-load from background sync, the
refusal to show a success message before a write completes, and the habit of
documenting each shortcut with its upgrade condition — these are the marks of
someone who has thought about failure modes. The email approval flow is a
properly designed server-side control: peppered hashes, single-use claims under
a row lock, rate limiting, idempotency keys and an audit log.

Against that, three findings of Critical severity say the same thing in three
ways: the application has no server of its own, so every rule it enforces is
enforced in a place the user controls, while the key shipped to that user grants
unrestricted access to the database. The careful workflow discipline governs
what a user can do *through the application*, and nothing about what they can do
*to the data*. `README.md` says so plainly, which is to the author's credit, but
documenting a gap is not closing it.

Three further patterns run through the High and Medium findings:

- **Where the right pattern exists, it is not applied consistently.**
  `InwardStock.saveAll` batches writes correctly while three other bulk actions
  do not (AUD-014). Five handlers re-check permissions and eleven do not
  (AUD-009). The listing grid's cells are keyboard-operable and the STP
  matrix's are not (AUD-015). `bulkReceive` is the most careful handler in the
  codebase and validates against the wrong copy of the data (AUD-027).
- **Hardcoded constants cause real defects, not just inflexibility.** The
  four-material array is the direct cause of AUD-013, where the factory and the
  MD can receive a report listing a row the sender's own screen does not show.
  The project already solved this class of problem once, by moving permissions
  into the database.
- **Nothing is observable and almost nothing is tested.** Coverage is 1.3%, of
  a 6,391-line file, with no linter and no types (AUD-021, AUD-023). Failures
  live for 2.5 seconds in a toast and are never recorded (AUD-026) — which is
  why UQ-06, "how often does this actually break?", cannot be answered from
  inside the system.

**Fitness for purpose.** For a small, trusted, internal team working on data
that would be inconvenient but not damaging to lose or disclose, this
application does its job and does the hard parts of its job well. It should not
hold data whose disclosure would matter commercially, and it should not be the
sole record of anything, until Phase 1 is complete.

**What to do first.** Verify UQ-01 — whether the live database's policies
actually match `schema.sql` — because that single answer sets the severity of
the three Critical findings. Then answer OQ-13, data sensitivity, which sets
their urgency. Then run Phase 1. Items 3, 4, 5, 7 and 8 of that phase are all
small, total perhaps two days, and between them close an irrecoverable data-loss
path, an organisational lockout, the release-reproducibility gap and two
unneutralised output sinks. Items 1 and 2 are the real work and should not be
deferred behind new features.

---

*End of audit report. Companion documents: `deliverables/BRD.md` and
`deliverables/BRD.docx` (requirements, business rules, traceability),
`deliverables/Project_Presentation.pptx` (stakeholder briefing),
`deliverables/README.md` (how to use this set).*
