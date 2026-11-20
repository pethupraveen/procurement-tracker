# Business Requirements Document
## New Model Procurement Tracker

| Field | Value |
| --- | --- |
| Document version | 1.0 |
| Date | 17 November 2026 |
| Status | Draft — pending stakeholder review and sign-off |
| Author | Reverse-engineered from repository evidence (business analysis / architecture / QA review) |
| Evidence baseline | Git commit `afad51c70c262494c97de00d19e99eefc3070d76` ("Add Customer Care team and move permissions into the database", 16 Nov 2026), branch `fix/supabase-loading-screen` |
| Working tree state | Clean apart from untracked `deliverables/` and `.presentation-build/` (this document set) |
| Repository | `C:\Users\User\Documents\procurement-tracker` |
| Companion documents | `deliverables/Project_Audit_Report.md`, `deliverables/Project_Presentation.pptx`, `deliverables/README.md` |

---

## 0. How to read this document

This BRD was produced by auditing an existing, working codebase. It is therefore
a **documentation-of-record** exercise, not a greenfield specification. Two rules
were applied throughout:

1. **Code describes behaviour, not intent.** Where the code enforces a rule, the
   rule is recorded as implemented. Where the *business reason* for that rule is
   not stated anywhere in the repository, the requirement is flagged
   `[CLARIFICATION]` rather than asserted as a business decision.
2. **Nothing was invented.** No stakeholder names, budgets, timelines, target
   metrics, SLAs or approval decisions appear in this document unless they exist
   in the repository. Proposed targets are explicitly labelled as proposals.

### Status labels

Every requirement, business rule and capability carries one of these:

| Label | Meaning |
| --- | --- |
| `IMPLEMENTED-VERIFIED` | Present in code **and** exercised by a check that was actually executed during this audit (see §19 Checks Executed). |
| `IMPLEMENTED-UNVERIFIED` | Present in code and traced statically end to end, but **not** executed at runtime during this audit. This is the status of the large majority of the application. |
| `PARTIAL` | Implemented for some paths, roles, screens or data shapes but not all. |
| `DOCUMENTED-NOT-FOUND` | Described in repository documentation but no implementing artefact exists. |
| `PROPOSED` | Not implemented. A recommendation arising from this audit. |
| `CLARIFICATION` | The implemented behaviour is clear but the intended business rule is not. A business owner must confirm or correct it. |

> **Important limitation.** No Supabase project, no deployed instance, no browser
> session and no email integration were available to this audit. Static tracing
> is not runtime proof. Statements about live behaviour — concurrency outcomes,
> email delivery, row-level security effects — are inferences from code and SQL,
> and are labelled accordingly. See §19 and §20.

---

## 1. Executive summary

The New Model Procurement Tracker is a single-page web application that gives a
phone-case business one shared workspace for taking a new phone model from
"we noticed this phone exists" to "every case SKU is selling on every
marketplace". It replaces the spreadsheet-and-chat coordination that otherwise
sits between procurement, the warehouse, the catalog team and sales.

The core insight encoded in the product is that **a launch deadline is fixed by
the phone manufacturer, not by us**. Every internal milestone is therefore
derived by counting backwards from the phone's launch date, and the application
continuously reports how far behind that schedule each model is. A model cannot
advance to the next stage until the data that stage is responsible for producing
actually exists — so the pipeline position of a model is a trustworthy statement
about reality rather than someone's optimistic status update.

**What exists today.** A complete six-stage pipeline with hard data gates, a
seventh off-ramp stage for models the business decides not to buy, per-SKU
tracking of STP (supplier tooling/production) files, per-SKU goods receipt with
shortfall recording, a per-SKU-per-marketplace listing matrix across four
marketplaces, sales and stock-on-hand derivation with low-stock reorder
signalling, nine exportable reports, CSV import, a per-model audit trail, a
six-role permission model editable from an admin screen, optimistic-locking
concurrency control, and a server-side approval-gated email of the STP
requirement report.

**What the audit found.** The application's *workflow* logic is unusually
disciplined: a single `gateBlock`/`moveStatus` pair is the only route through
which any stage change can occur, which is why drag-and-drop, the board's
quick-advance arrow, the detail panel footer and the bulk-inward screen cannot
disagree with each other. The weaknesses are concentrated elsewhere, and they
are consistent and structural rather than scattered:

- **Security is not implemented at the data layer.** Authentication is a
  client-side PIN check; authorization is enforced only in the browser; the
  database grants full read and write access to the public anonymous key. This
  is acknowledged in `README.md`. It is the single most consequential finding
  (AUD-001 to AUD-006).
- **The documented deployment pipeline does not exist in the repository**
  (AUD-007).
- **Automated testing covers roughly 1.3% of the codebase** — one 86-line pure
  module out of ~6,500 lines. None of the business rules that this BRD
  documents as requirements are protected by a test (AUD-021).
- **Two screens disagree about the same data.** The STP requirement matrix is
  driven by a hardcoded four-material list, while the emailed report and the
  Reports tab group by the material actually stored on the SKU. A SKU whose
  material was set by bulk paste to anything off that list is invisible to the
  screen that decides its STP requirement (AUD-013).
- **An administrator can lock the organisation out of user management** by
  deleting or re-roling every admin account; the guard only prevents deleting
  the *last user*, not the last *admin* (AUD-011).

None of these are reasons not to use the application for its current purpose.
All of them are reasons to complete §18 Phase 1 before the data it holds becomes
operationally critical or commercially sensitive.

---

## 2. Business background and problem statement

### 2.1 The business

The organisation buys and sells mobile phone cases. For each newly launched
phone model it must decide whether to make cases, choose which case variants
(material, colour) to make, order them from a supplier, manage the supplier's
production paperwork, receive and check the stock, list every variant on every
marketplace it sells through, and then watch sales and stock to decide whether to
reorder.

`[CLARIFICATION]` The repository does not name the organisation, its scale, its
supplier(s) or its commercial targets. Four marketplaces are hardcoded —
Flipkart, Amazon, Meesho and Shopify (`src/App.jsx:95`) — and currency formatting
is Indian Rupees with `en-IN` locale (`src/App.jsx:43-45`), which together
indicate an India-focused e-commerce operation. This should be confirmed.

### 2.2 The problem the application addresses

Evidence for the problem statement is drawn from the structure the code imposes
and the explanatory comments its author left, principally
`src/App.jsx:10-26`, `48-54`, `276-311` and `README.md`.

| # | Business problem | Repository evidence |
| --- | --- | --- |
| BP-01 | **The deadline is external and non-negotiable.** A phone launches on a date set by its manufacturer. Cases that are not listed by then miss the demand peak. | `STAGES[].daysBeforeLaunch` counts every milestone back from `model.launch` (`src/App.jsx:56-69`); `plannedDate()` (`286-292`) |
| BP-02 | **Status reported by people drifts from reality.** "In production" can mean the paperwork was never sent. | `gateBlock()` refuses a stage change until the stage's own data exists (`src/App.jsx:503-540`) |
| BP-03 | **Work is distributed across four teams with no shared view.** Procurement, Warehouse, Catalog and Sales each hold part of the record. | Six-role permission model (`src/roles.js:35-48`); per-role stage ownership (`src/App.jsx:466-481`) |
| BP-04 | **One blocked variant hides behind an aggregate.** A model reported as "received" may have one colour that never arrived. | STP status, receipt state and listing status are all held **per SKU**, not per model (`src/App.jsx:126-140`) |
| BP-05 | **Lateness is discovered, not predicted.** | `delayOf()` computes overdue days continuously for unfinished stages (`src/App.jsx:295-302`); `problemsOf()` raises alerts (`342-403`) |
| BP-06 | **Late discovery of a phone compresses everything.** Spotting a phone 30 days before launch makes every milestone due at once. | `runwayOf()` detects and reports a compressed runway (`src/App.jsx:307-311`); surfaced in the detail panel (`2847-2855`) |
| BP-07 | **Two people editing the same model silently overwrite each other.** Each save writes the whole record. | Optimistic locking on `updated_at` (`schema.sql:48-58`, `src/App.jsx:830-837`, `schema-phase3.sql`) |
| BP-08 | **Stock runs out unnoticed on a live model.** | `stockOfSku()` derives stock on hand; `reorderQueue()` lists SKUs at or below 20% (`src/App.jsx:177-214`) |
| BP-09 | **Chasing supplier paperwork nobody needed is waste.** | Tri-state `stpRequired` separates "not decided" from "deliberately not required" (`src/App.jsx:130-134`, `230-236`) |

### 2.3 Business objectives

`[CLARIFICATION]` **No objective statements, success criteria or target metrics
exist anywhere in the repository.** The objectives below are *inferred* from what
the application measures and alerts on. They are candidate objectives for
stakeholder confirmation, and they carry no numeric targets because none were
found.

| ID | Inferred objective | Inferred from | Status |
| --- | --- | --- | --- |
| OBJ-01 | Have every case SKU for a new phone live on all four marketplaces by the phone's launch date. | `Received → Live` gate requires every SKU live on every marketplace (`src/App.jsx:530-538`); `daysBeforeLaunch: 0` for the Live stage (`62`) | `CLARIFICATION` |
| OBJ-02 | Detect schedule slippage while there is still time to act, rather than at launch. | `delayOf()` + `isLate` at >3 days (`src/App.jsx:295-302`, `331`) | `CLARIFICATION` |
| OBJ-03 | Make each team's outstanding work visible to that team without a meeting. | "Needs my action" filter driven by `advanceStatus` (`src/App.jsx:649`, `1356-1363`); nav badges for Inward and Listing (`6150-6164`) | `CLARIFICATION` |
| OBJ-04 | Keep an auditable record of who changed what on each model. | `withAudit()` on every mutating handler; `audit` JSONB column | `CLARIFICATION` |
| OBJ-05 | Avoid supplier paperwork that was never required, and avoid missing paperwork that was. | Tri-state STP requirement owned by Catalog, STP status owned by Warehouse (`src/roles.js:31-34`) | `CLARIFICATION` |
| OBJ-06 | Reorder a selling SKU before it stocks out. | `REORDER_PCT = 20` (`src/App.jsx:178`); `reorderQueue()` (`208-214`) | `CLARIFICATION` |
| OBJ-07 | Prevent one person's save from destroying another's unseen work. | Optimistic locking; conflict banner (`src/App.jsx:6264-6273`) | `CLARIFICATION` |

### 2.4 Expected benefits

`[PROPOSED — not measured]` The benefits below are the logical consequences of
the implemented behaviour. **No measurement of any of them exists.** They must
not be presented as achieved results.

| ID | Expected benefit | Mechanism | Measurable once baseline exists? |
| --- | --- | --- | --- |
| BEN-01 | Fewer launches missed because a stage silently stalled. | Hard data gates + overdue alerts | Yes — would require a historical baseline, which the application does not currently capture (see AUD-025) |
| BEN-02 | Less time spent in status meetings and chat threads. | Shared dashboard, per-role action queues | `CLARIFICATION` — no time-tracking data exists |
| BEN-03 | Faster listing completion because the queue is explicit and bulk-actionable. | Listing queue with per-marketplace bulk actions | Yes — listing report already carries the data |
| BEN-04 | Fewer silent stock-outs on selling SKUs. | Low-stock reorder queue | Yes — sales and receipt data already captured |
| BEN-05 | No lost edits when several people work the same model. | Optimistic locking with explicit conflict reporting | Partially — conflicts are surfaced to the user but not logged for analysis |
| BEN-06 | Reduced waste chasing unnecessary supplier STP files. | Tri-state requirement decision | Yes — STP requirement report carries required / not required / not decided counts |

---

## 3. Stakeholders, user groups and responsibilities

### 3.1 User groups

The six roles below are defined in the codebase and seeded in the database.
`[CLARIFICATION]` The repository defines roles, not people. Named seed accounts
(Arjun, Priya, Ravi, Sunita, Kiran, Meena — `src/App.jsx:429-436`,
`schema.sql:90-96`) are **demonstration accounts with published default PINs**,
not a statement about real staff. Real user counts, names and reporting lines are
unknown.

| Role key | Label | Responsibilities (as implemented) | Evidence |
| --- | --- | --- | --- |
| `admin` | Admin | Every workflow action; may move a model into any stage; manages user accounts; edits the permission matrix; configures the database connection; deletes all models. | `src/roles.js:35-51`; `schema-roles.sql:53-55` |
| `procurement` | Procurement | Creates models; edits research details; maintains SKUs; sets PO numbers; archives; moves work through Research, Planned, Ordered, Production and to Un-Procurement. | `src/roles.js:36-47`; `src/App.jsx:470` |
| `warehouse` | Warehouse | Updates supplier STP file status; moves work into Production. Nothing else. | `src/roles.js:41`; `src/App.jsx:473` |
| `catalog` | Catalog | Creates models; decides whether an STP file is required; records goods receipt; maintains marketplace listings; moves work into Production, Received and Live. | `src/roles.js:36,42-44`; `src/App.jsx:477` |
| `sales` | Sales | Logs sales entries. Moves nothing. | `src/roles.js:45`; `src/App.jsx:478` |
| `customer_care` | Customer Care | Files a new model (which always lands in Research). Read-only thereafter. Moves nothing. | `src/roles.js:36`; `src/App.jsx:480`; `schema-roles.sql:73-78` |

### 3.2 Stakeholders beyond the user groups

| Stakeholder | Interest | Evidence |
| --- | --- | --- |
| Managing Director ("MD") | Receives the STP file requirement report by email. | `REPORT-EMAIL-SETUP.md:21-22` (`REPORT_APPROVER_EMAILS`, `REPORT_RECIPIENTS`); in-app button labelled "Email MD / Factory" (`src/App.jsx:4426`) |
| Supplier / factory | Receives the STP requirement report and the SKU/PO export; produces the cases and the STP files. | `REPORT-EMAIL-SETUP.md:22`; `SKUExport` (`src/App.jsx:1907-1945`); `ProductionSTP` export (`1963-1968`) |
| Marketplace operations (Flipkart, Amazon, Meesho, Shopify) | External systems that gate whether a SKU is actually sellable. Not integrated — status is recorded manually. | `MARKETPLACES` (`src/App.jsx:95`); `ListingEditor` is manual entry (`2169-2297`) |
| Repository owner / maintainer | Sole developer and deployer. | Git author `pethupraveen`; `README.md` deployment section |

`[CLARIFICATION]` Whether "MD" is also the project sponsor, who approves scope,
and who owns the budget are not recorded anywhere in the repository.

### 3.3 Responsibility handoffs (RACI-style, as implemented)

| Workflow step | Accountable role(s) | Enforcement |
| --- | --- | --- |
| Decide a phone is worth tracking | Procurement, Catalog, Customer Care, Admin | `CAN.addPhone` |
| Decide a phone is **not** worth buying | Procurement, Admin | `moveStatus(..., "unprocured")` + `ROLE_CAN_ADVANCE_TO` |
| Choose SKUs, materials, quantities | Procurement, Admin | `CAN.editSKUs` |
| Raise and record the purchase order | Procurement, Admin | `CAN.savePO` |
| Decide whether an STP file is owed | Catalog, Admin | `CAN.setStpRequired` |
| Chase the STP file with the supplier | Warehouse, Admin | `CAN.updateSTP` |
| Book stock in and record shortfalls | Catalog, Admin | `CAN.saveReceipt` |
| List each SKU on each marketplace | Catalog, Admin | `CAN.saveListing` |
| Record sales and returns | Sales, Admin | `CAN.logSales` (see AUD-009 — not enforced in the handler) |
| Manage accounts and permissions | Admin only, non-delegable | `LOCKED_TO_ADMIN` (`src/roles.js:51`) |

---

## 4. Current state and proposed future state

### 4.1 Current state (as of the evidence baseline)

**Deployed shape.** A browser-only React single-page application built by Vite,
talking directly to Supabase's PostgREST endpoint using the public anonymous key,
plus two Supabase Edge Functions for the approval-gated report email.

```
Browser (React SPA, ~329 kB JS)
  │
  ├── fetch → Supabase PostgREST  /rest/v1/{phones,users,role_permissions}
  │                               (anonymous key, full access policies)
  │
  └── fetch → Supabase Edge Functions
                /functions/v1/request-stp-report-approval  ─┐
                /functions/v1/send-stp-report              ─┤→ Resend API (email)
                                                            └→ Postgres RPC (service_role)
```

**Characteristics of the current state:**

| Aspect | Current state | Status |
| --- | --- | --- |
| Application architecture | One 6,391-line React component file plus an 86-line pure permissions module. | `IMPLEMENTED-VERIFIED` (build succeeds — see §19) |
| Authentication | Name + 4–6 digit PIN, hashed client-side with djb2, compared in the browser. | `IMPLEMENTED-UNVERIFIED` / insecure (AUD-001) |
| Authorization | Role permission table in the database, enforced **only** in the browser. | `IMPLEMENTED-UNVERIFIED` / insecure (AUD-002) |
| Database access control | RLS enabled but with `using (true) with check (true)` for the anonymous role on all three application tables. | `IMPLEMENTED-UNVERIFIED` / insecure (AUD-003) |
| Concurrency control | Optimistic lock on `updated_at` with compare-and-swap PATCH. | `IMPLEMENTED-UNVERIFIED` |
| Data model | Three tables; all model detail (SKUs, sales, notes, attachments, audit) in JSONB columns on a single `phones` row. | `IMPLEMENTED-UNVERIFIED` |
| Automated tests | One assertion-based self-check covering `src/roles.js` only. | `IMPLEMENTED-VERIFIED` (executed — passes) |
| Linting / type checking | None configured. | `DOCUMENTED-NOT-FOUND` — `README.md` states this explicitly |
| CI/CD | Documented as GitHub Actions → GitHub Pages. **`.github/` does not exist in the repository.** | `DOCUMENTED-NOT-FOUND` (AUD-007) |
| Email integration | Resend, via Edge Functions, behind a one-time 8-character approval code. | `IMPLEMENTED-UNVERIFIED` — no deployment available to test |
| Marketplace integration | None. Listing status is entered by hand. | Not implemented (by design) |
| Observability | None — no logging, metrics or error reporting beyond browser toasts and one `report_send_log` table. | Not implemented |

### 4.2 Proposed future state

`[PROPOSED]` The target state below closes the audit findings without changing
what the product *does*. Sequencing is in §18.

| Aspect | Proposed future state | Closes |
| --- | --- | --- |
| Authentication | Supabase Auth (email/password or magic link); PIN login retired. | AUD-001, AUD-005, AUD-006 |
| Authorization | Role claim on the authenticated user; RLS policies that enforce per-role write permissions in Postgres; browser checks retained as UX only. | AUD-002, AUD-003, AUD-009, AUD-010 |
| Data model | SKUs promoted from a JSONB array to a `skus` table with a foreign key; sales entries to a `sales_entries` table. Notes, attachments and audit remain append-only child tables. | AUD-004, AUD-014, AUD-018, AUD-024 |
| Concurrency | Per-SKU writes rather than whole-row writes, eliminating most false conflicts. | AUD-004, AUD-008 |
| Testing | Unit tests for every business rule documented in §6 (gates, delay, stock, CSV parsing, report builders); the existing self-check pattern extended. | AUD-021 |
| Code organisation | `src/App.jsx` split by domain (stages, derive, db, views) — structural only, no behaviour change. | AUD-022 |
| CI/CD | The documented `.github/workflows/deploy.yml` actually committed, running build + self-check on every push. | AUD-007 |
| Configuration | `MARKETPLACES`, `MATERIALS`, `REORDER_PCT` and stage `daysBeforeLaunch` moved to a configuration table, following the precedent already set by `role_permissions`. | AUD-019, AUD-013 |
| Reporting | One shared report-row builder used by the screen export, the Reports tab and the Edge Function, so all three agree. | AUD-013 |
| Observability | Error reporting and a conflict/usage log. | AUD-026 |

---

## 5. Scope

### 5.1 In scope (implemented and documented by this BRD)

1. Model (phone) lifecycle across seven stages, including the Un-Procurement off-ramp.
2. SKU management: manual entry and bulk paste, material defaults, unit quantities.
3. Purchase order creation, multi-model assignment and export.
4. STP file requirement decision (model × material) and per-SKU STP status tracking.
5. Goods receipt per SKU with shortfall recording, individually and in bulk.
6. Marketplace listing status per SKU per marketplace, individually and in bulk.
7. Sales entry, returns, revenue, stock-on-hand derivation and low-stock reorder signalling.
8. Dashboard with KPI cards, to-do strip, pipeline funnel and alert list.
9. Nine reports with CSV and Excel-compatible export.
10. CSV/TSV import of phone models with validation and duplicate detection.
11. Per-model notes, attachment links and audit trail.
12. Six roles with an editable permission matrix and per-role stage ownership.
13. User account management (create, rename, re-role, reset PIN, remove).
14. Session persistence with 12-hour expiry.
15. Optimistic-locking concurrency control with explicit conflict reporting.
16. Approval-gated server-side email of the STP requirement report.
17. Database connection configuration (admin-only screen plus build-time environment variables).
18. Light/dark theming; responsive layout; keyboard and screen-reader affordances.

### 5.2 Explicitly out of scope (not implemented, and no evidence of intent)

| Exclusion | Evidence it is out of scope |
| --- | --- |
| Marketplace API integration (automated listing push or status pull) | Listing status is manual throughout; no marketplace client exists |
| Supplier portal or supplier-facing login | Only six internal roles; export and email are the supplier interface |
| Cost, pricing, margin or landed-cost calculation | No cost field anywhere. `money()` exists at `src/App.jsx:44` but is never called |
| Invoice, payment or accounting integration | "Invoice" exists only as an attachment *label* (`ATTACHMENT_KINDS`, `src/App.jsx:168`) |
| File storage | Attachments store a URL only; `src/App.jsx:2396-2399` states the app stores the link, not the file |
| Barcode / scanner-driven inwarding | Receipt quantities are typed |
| Forecasting or demand planning | Reorder signalling is a fixed 20% threshold, not a forecast |
| Multi-organisation / multi-tenant operation | `src/App.jsx:483-487` explicitly records single-tenant module-scope state as a deliberate shortcut |
| Mobile native application | Responsive web only |
| Localisation beyond `en-IN` | Date and currency formatting hardcoded to `en-IN` |
| Notification channels other than the STP report email (push, SMS, Slack) | `problemsOf()` comment at `src/App.jsx:339-341` anticipates "any future notification system" — none exists |

### 5.3 Deferred / ambiguous scope requiring a decision

| Item | Why it is ambiguous | Decision needed from |
| --- | --- | --- |
| Historical backfill of models already in flight | `moveTo()` stamps *today* on every stage it passes (`src/App.jsx:5785`), so a backfilled model reports as on time regardless of what actually happened. There is no way to edit a completion date. | Business owner (see OQ-07) |
| Whether an undecided STP requirement should block Production | It currently does **not** block; it only raises an alert. The comment at `src/App.jsx:230-232` records this as a deliberate call. | Business owner (see OQ-03) |
| Whether short or missing deliveries should block Live | They do not block; they raise a permanent alert. | Business owner (see OQ-04) |
| Whether Un-Procurement should be reachable from stages after Research | Code permits only Research → Un-Procurement (`src/App.jsx:593-595`), but a comment at `5781-5782` describes un-procuring from Ordered. | Business owner (see OQ-05) |

---

## 6. Business rules

Each rule carries a unique `BR-nnn` ID, the implementing evidence, and a status.

### 6.1 Pipeline and stage progression

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-001 | A model progresses through exactly six ordered stages: Research → Planned → Ordered → Production → Received → Live. | `STAGES` / `PIPELINE` (`src/App.jsx:56-76`) | `IMPLEMENTED-UNVERIFIED` |
| BR-002 | A seventh stage, Un-Procurement, sits off the pipeline. It is terminal: no deadlines, no alerts, no next stage. | `terminal: true` (`src/App.jsx:67-68`); `problemsOf` returns immediately (`347`); `advanceStatus` refuses (`568-569`) | `IMPLEMENTED-UNVERIFIED` |
| BR-003 | A forward move may advance exactly one stage. Skipping is refused, naming the stage that must be completed first. | `moveStatus` (`src/App.jsx:612-613`) | `IMPLEMENTED-UNVERIFIED` |
| BR-004 | A model may only enter Un-Procurement from Research. | `moveStatus` (`src/App.jsx:593-595`) | `IMPLEMENTED-UNVERIFIED`; conflicts with a code comment — see OQ-05 |
| BR-005 | A model may only leave Un-Procurement by returning to Research. | `moveStatus` (`src/App.jsx:600-602`) | `IMPLEMENTED-UNVERIFIED` |
| BR-006 | Returning from Un-Procurement preserves the completion dates, PO and SKUs the model already held. | `moveTo` (`src/App.jsx:5781-5782`); forward walk uses `||=` (`5785`) | `IMPLEMENTED-UNVERIFIED` |
| BR-007 | Moving backwards deletes the completion dates of every stage after the target, so the timeline cannot claim a stage happened that has been undone. | `moveTo` (`src/App.jsx:5788`) | `IMPLEMENTED-UNVERIFIED` |
| BR-008 | A forward move stamps the completion date of every stage up to and including the target that does not already have one. Existing dates are never overwritten. | `moveTo` (`src/App.jsx:5785`) | `IMPLEMENTED-UNVERIFIED` |
| BR-009 | Every stage change — forward, backward, drag-and-drop, button, or bulk — passes through one gate function. No screen may bypass it. | Sole entry point `moveStatus`: board drop (`src/App.jsx:1413`), detail footer (`2890`, `2901`), inward (`4093`, `4186`), `move()` (`5799-5807`) | `IMPLEMENTED-UNVERIFIED` |
| BR-010 | The role check is evaluated before the data check, so the user is told "your role cannot do this" rather than "the data is incomplete" when both are true. | `moveStatus` (`src/App.jsx:609-614`) | `IMPLEMENTED-UNVERIFIED` |

### 6.2 Stage entry gates (data readiness)

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-011 | **Research → Planned** requires nothing beyond the decision itself. | `gateBlock` has no `research` branch (`src/App.jsx:503-540`) | `IMPLEMENTED-UNVERIFIED` |
| BR-012 | **Planned → Ordered** requires at least one SKU, and every SKU must have a non-blank code. | `gateBlock` (`src/App.jsx:504-508`) | `IMPLEMENTED-UNVERIFIED` |
| BR-013 | **Ordered → Production** requires a non-blank PO number, because the STP export carries the PO. | `gateBlock` (`src/App.jsx:511-512`) and comment (`509-510`) | `IMPLEMENTED-UNVERIFIED` |
| BR-014 | **Production → Received** requires at least one SKU; no SKU marked as requiring an STP file may have it Rejected; and no such SKU may still be "Not Sent". | `gateBlock` (`src/App.jsx:516-528`) | `IMPLEMENTED-UNVERIFIED` |
| BR-015 | A SKU whose STP requirement is **undecided** does not block Production. Only an explicit `true` does. | `stpNeeded` tests `=== true` (`src/App.jsx:233`); `gateBlock` filters on `stpNeeded` (`522`, `525`) | `IMPLEMENTED-UNVERIFIED`; deliberate per comment (`520-521`) — confirm via OQ-03 |
| BR-016 | **Received → Live** requires at least one SKU, a confirmed receipt outcome on every SKU, and every SKU Live on all four marketplaces. | `gateBlock` (`src/App.jsx:530-538`); `pendingMarketplaces` (`543-546`) | `IMPLEMENTED-UNVERIFIED` |
| BR-017 | A confirmed receipt outcome may be "received in full", "short" or "not received". Short and nil deliveries are recorded, not hidden, and do not block Live. | `receiptState` (`src/App.jsx:136`, `229`, `238-241`); gate tests only `isConfirmed` (`532`) | `IMPLEMENTED-UNVERIFIED`; confirm via OQ-04 |
| BR-018 | A blocking message must name what is outstanding (SKU counts, or the marketplaces still pending), not merely state that the move is blocked. | `gateBlock` messages (`src/App.jsx:507`, `524`, `527`, `533`, `537`) | `IMPLEMENTED-UNVERIFIED` |

### 6.3 Deadlines, delay and runway

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-019 | Each stage has a target date of launch date minus a fixed number of days: Research 100, Planned 85, Ordered 75, Production 60, Received 25, Live 0. | `STAGES[].daysBeforeLaunch` (`src/App.jsx:57-62`); `plannedDate` (`286-292`) | `IMPLEMENTED-UNVERIFIED` |
| BR-020 | A target date may never fall earlier than the date the model was added, because the business cannot be late for something it did not know existed. | `plannedDate` clamps to `done.research` (`src/App.jsx:289-291`) | `IMPLEMENTED-UNVERIFIED` |
| BR-021 | A completed stage's delay is actual minus target. An incomplete stage's delay is today minus target, floored at zero. | `delayOf` (`src/App.jsx:295-302`) | `IMPLEMENTED-UNVERIFIED` |
| BR-022 | A model's headline delay is the worst delay across every stage up to and including the next one. | `derive` (`src/App.jsx:319-320`) | `IMPLEMENTED-UNVERIFIED` |
| BR-023 | A model is flagged "late" only when its worst delay exceeds **3 days**. | `isLate: worstDelay > 3` (`src/App.jsx:331`) | `IMPLEMENTED-UNVERIFIED`; the 3-day tolerance is undocumented — confirm via OQ-06 |
| BR-024 | A terminal (Un-Procurement) model has zero delay and is never late. | `derive` (`src/App.jsx:319`) | `IMPLEMENTED-UNVERIFIED` |
| BR-025 | A model whose runway (date added → launch) is shorter than the 100 days the full process wants is flagged as rushed and the user is told explicitly. | `runwayOf` (`src/App.jsx:307-311`); detail warning (`2847-2855`) | `IMPLEMENTED-UNVERIFIED` |
| BR-026 | Progress is derived from the model's position in the six-stage pipeline, never stored. | `derive` (`src/App.jsx:327`) | `IMPLEMENTED-UNVERIFIED` |
| BR-027 | All dates are local-calendar `YYYY-MM-DD` strings. UTC conversion is deliberately avoided because it shifts dates backwards in zones ahead of UTC. | `iso()` and comment (`src/App.jsx:33-39`) | `IMPLEMENTED-UNVERIFIED` |

### 6.4 SKUs and materials

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-028 | A model holds a flat list of SKUs. Each SKU carries its own code, material and unit count. | `skuRow` (`src/App.jsx:126-140`); `allSkus` (`245`) | `IMPLEMENTED-UNVERIFIED` |
| BR-029 | Four materials are offered, each with a default order quantity: TPU+PC 50, Silicone Cover 30, TPU+PC+MSF 50, Silicone MagSafe 30. | `MATERIALS` (`src/App.jsx:102-107`) | `IMPLEMENTED-UNVERIFIED` |
| BR-030 | Selecting a material fills the unit count with that material's default, but only if the buyer has not typed their own figure. | `PlannedSKUEditor` (`src/App.jsx:1796-1803`) | `IMPLEMENTED-UNVERIFIED` |
| BR-031 | SKUs stay editable through Planned, Ordered and Production, because a new colour can arise mid-production. The UI warns that changing them means re-sending the PO and STP file. | `Detail` (`src/App.jsx:2802`); warning text (`1770`) | `IMPLEMENTED-UNVERIFIED` |
| BR-032 | A SKU row is discarded on save if its code, material and units are all empty. | `PlannedSKUEditor.save` (`src/App.jsx:1751`) | `IMPLEMENTED-UNVERIFIED` |
| BR-033 | SKUs may be bulk-pasted one per line as `SKU, Material, Units`, accepting commas or tabs, skipping a header row, defaulting units from the material when omitted. | `applyBulk` (`src/App.jsx:1729-1748`) | `IMPLEMENTED-UNVERIFIED` |
| BR-034 | Every SKU carries a persistent internal identifier so a page reload cannot cause an edit to land on the wrong SKU; duplicate or missing identifiers are repaired on load. | `newRid` (`src/App.jsx:113-114`); `repairSkuRids` (`115-125`); called from `rowToPhone` (`781`) | `IMPLEMENTED-UNVERIFIED`; collision risk — AUD-012 |
| BR-035 | Bulk-pasted material values are **not** validated against the four offered materials. | `applyBulk` takes `parts[1]` as free text (`src/App.jsx:1737`) | `IMPLEMENTED-UNVERIFIED` — root cause of AUD-013 |

### 6.5 Purchase orders

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-036 | A PO number is typed by the buyer. The application never generates one. | `POField` (`src/App.jsx:1868-1901`); section comment (`1866`) | `IMPLEMENTED-UNVERIFIED` |
| BR-037 | One PO may cover several models; a PO number can be assigned to a multi-model selection in one action. | `POManager.assign` (`src/App.jsx:4669-4673`); `assignPO` (`5959-5966`) | `IMPLEMENTED-UNVERIFIED` |
| BR-038 | A model is eligible for a PO when it is at Ordered, or at Planned with every SKU coded. | `POManager.eligible` (`src/App.jsx:4657-4658`) | `IMPLEMENTED-UNVERIFIED` |
| BR-039 | A PO's combined SKU sheet may be exported as one file for the supplier, before or after the number is assigned. | `exportPO` / `exportDraft` (`src/App.jsx:4681-4694`) | `IMPLEMENTED-UNVERIFIED` |
| BR-040 | A model marked "not received" against a PO returns to Ordered **with its PO cleared**, so it reappears in the PO builder for the next order. | `bulkReceive` (`src/App.jsx:5933-5938`) | `IMPLEMENTED-UNVERIFIED` |
| BR-041 | Bulk receipt against a PO considers only models currently in Production that hold a PO. | `BulkReceive.inFlight` (`src/App.jsx:4503`); re-checked (`5903`) | `IMPLEMENTED-UNVERIFIED` |
| BR-042 | Bulk receipt re-applies the Production gate per model and skips, with a named reason, any model that fails it or has since left Production. | `bulkReceive` (`src/App.jsx:5905-5920`, `5948-5954`) | `IMPLEMENTED-UNVERIFIED` |

### 6.6 STP files

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-043 | Whether an STP file is owed is a three-state decision per SKU: not decided (`null`), required (`true`), not required (`false`). "Not decided" is deliberately distinct from "deliberately not required". | `skuRow.stpRequired` and comment (`src/App.jsx:130-134`) | `IMPLEMENTED-UNVERIFIED` |
| BR-044 | The requirement decision belongs to **Catalog**; chasing the file with the supplier belongs to **Warehouse**. Two deliberately separate permissions. | `src/roles.js:31-33`, `41-42` | `IMPLEMENTED-UNVERIFIED` |
| BR-045 | The decision is made model-wise and material-wise: one decision covers every SKU of that material within that model. | `STPRequirement.cellSkus` / `setCell` (`src/App.jsx:4298-4309`) | `IMPLEMENTED-UNVERIFIED` |
| BR-046 | A requirement cell cycles not decided → required → not required → not decided. A mixed cell resets to required. | `STP_CYCLE` (`src/App.jsx:4287`); `cycleCell` (`4310-4313`) | `IMPLEMENTED-UNVERIFIED` |
| BR-047 | STP **status** is tracked per SKU from six values: Not Sent, Submitted, Acknowledged, In Progress, Completed, Rejected. | `STP_STATUSES` (`src/App.jsx:225`) | `IMPLEMENTED-UNVERIFIED` |
| BR-048 | A rejected STP file on a required SKU means that SKU is not being made, and blocks the move out of Production. | `gateBlock` (`src/App.jsx:522-524`) and comment (`515-516`) | `IMPLEMENTED-UNVERIFIED` |
| BR-049 | Models awaiting a requirement decision are those at Ordered or Production with at least one SKU. | `STPRequirement.queue` (`src/App.jsx:4293-4295`) | `IMPLEMENTED-UNVERIFIED` |
| BR-050 | The requirement report is produced model-wise then material-wise, collapsing SKUs that share a material, with "Mixed" where they disagree. | `reportRows` (`src/App.jsx:4324-4332`); comment (`4323`) | `IMPLEMENTED-UNVERIFIED` |

### 6.7 Goods receipt and stock

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-051 | The received quantity decides the receipt state so the two can never disagree: 0 → not received; below planned → short; at or above planned → in full; blank → unconfirmed. | `ReceivedChecker.setQty` (`src/App.jsx:2062-2068`); `InwardStock.stateFor` (`4054`) | `IMPLEMENTED-UNVERIFIED` |
| BR-052 | Shortfall is planned minus received, floored at zero, and appears in the received report so it can be chased. | `shortfallOf` (`src/App.jsx:237`); received report (`4903-4909`) | `IMPLEMENTED-UNVERIFIED` |
| BR-053 | Stock on hand per SKU is received minus sold plus returned, floored at zero. | `stockOfSku` (`src/App.jsx:184-192`) | `IMPLEMENTED-UNVERIFIED` |
| BR-054 | A sales entry may name a SKU or be model-level. Model-level entries reduce the model total but no individual SKU's stock. | `stockOfSku` filters on `skuRid` (`src/App.jsx:185`); `stockOfModel` handles loose entries (`198-201`) | `IMPLEMENTED-UNVERIFIED` |
| BR-055 | A SKU needs reordering when remaining stock is at or below **20%** of what was received. | `REORDER_PCT = 20` (`src/App.jsx:178`); `low` (`191`) | `IMPLEMENTED-UNVERIFIED` |
| BR-056 | The reorder queue considers only live, non-archived models, most depleted first. | `reorderQueue` (`src/App.jsx:208-214`) | `IMPLEMENTED-UNVERIFIED`; excludes Received-stage models — AUD-020 |
| BR-057 | Inward stock shows every SKU on models at Ordered, Production or Received, so stock can be booked in without opening each model. | `INWARD_STAGES` (`src/App.jsx:4041`); `InwardStock.queue` (`4048-4050`) | `IMPLEMENTED-UNVERIFIED` |
| BR-058 | Inward edits are held as a draft and committed in one action, grouped per model so each write goes through the normal optimistic-lock path. | `InwardStock.saveAll` (`src/App.jsx:4074-4083`) and comment (`4075-4076`) | `IMPLEMENTED-UNVERIFIED` |
| BR-059 | Bulk inwarding (moving several models to Received at once) is refused while unsaved receipt edits exist. | `bulkInward` button disabled on `touched > 0` (`src/App.jsx:4174`) | `IMPLEMENTED-UNVERIFIED` |

### 6.8 Marketplace listing

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-060 | Listing is tracked per SKU per marketplace across exactly four marketplaces: Flipkart, Amazon, Meesho, Shopify. | `MARKETPLACES` (`src/App.jsx:95`); `skuRow.listings` (`139`) | `IMPLEMENTED-UNVERIFIED` |
| BR-061 | A listing cell holds one of four states: Not listed, In progress, Live, Blocked. | `LISTING_STATES` (`src/App.jsx:216`) | `IMPLEMENTED-UNVERIFIED` |
| BR-062 | A SKU is fully listed only when all four marketplaces read Live. | `isFullyListed` (`src/App.jsx:221`) | `IMPLEMENTED-UNVERIFIED` |
| BR-063 | The listing queue contains every SKU on a Received or Live model that is not yet Live everywhere, with the specific marketplaces it is missing. | `listingQueue` (`src/App.jsx:550-559`) | `IMPLEMENTED-UNVERIFIED` |
| BR-064 | A model can be Live while some SKUs are not fully listed (for example a SKU added post-launch); this raises an alert rather than forcing the model backwards. | `problemsOf` (`src/App.jsx:385-386`) | `IMPLEMENTED-UNVERIFIED` |
| BR-065 | A blocked listing on any marketplace raises an urgent alert at any stage. | `problemsOf` (`src/App.jsx:382-383`) | `IMPLEMENTED-UNVERIFIED` |
| BR-066 | Listing status may be set one cell at a time, a whole marketplace column, a whole SKU, or every outstanding SKU on one marketplace across all models. | `cycle` / `setColumn` / `setAllLive` (`src/App.jsx:2177-2191`); `goLiveAll` / `goLiveMarketplace` (`3880-3895`) | `IMPLEMENTED-UNVERIFIED` |

### 6.9 Alerts

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-067 | Every alert in the application is produced by one function. No screen generates alerts independently. | `problemsOf` (`src/App.jsx:342-403`) and comment (`339-341`) | `IMPLEMENTED-UNVERIFIED` |
| BR-068 | Alerts have two severities: urgent and warning. Urgent alerts sort first and are counted separately. | Dashboard (`src/App.jsx:3573-3574`, `3817`) | `IMPLEMENTED-UNVERIFIED` |
| BR-069 | A model launching within 14 days that is not yet Live raises a warning naming the stage it is stuck at. | `problemsOf` (`src/App.jsx:352-354`) | `IMPLEMENTED-UNVERIFIED` |
| BR-070 | An undecided STP requirement at Ordered or Production raises a warning with the count, specifically because it does not block the gate. | `problemsOf` (`src/App.jsx:373-374`) and comment (`371-372`) | `IMPLEMENTED-UNVERIFIED` |
| BR-071 | A model at Received whose receipts are all confirmed but which is not live everywhere raises a "waiting on catalog" warning naming the marketplaces. | `problemsOf` (`src/App.jsx:396-400`) | `IMPLEMENTED-UNVERIFIED` |
| BR-072 | The dashboard alert list is capped at 25 entries with a "+N more" indicator. | Dashboard (`src/App.jsx:3817`, `3833-3837`) | `IMPLEMENTED-UNVERIFIED` |

### 6.10 Permissions and accounts

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-073 | Twelve named permissions govern what a role may do: add phone, archive, edit research, edit SKUs, save PO, STP status, STP required, goods receipt, listings, log sales, manage users, DB/reset. | `PERM_KEYS` (`src/roles.js:12-15`) | `IMPLEMENTED-VERIFIED` (self-check asserts the full key set for admin) |
| BR-074 | Permissions are stored in `role_permissions` and edited from the Admin matrix; the compiled defaults are the fallback when that table is absent or unreadable. | `dbLoadRoles` (`src/App.jsx:894-898`); fallback (`5594-5595`); `schema-roles.sql:12-14` | `IMPLEMENTED-UNVERIFIED` |
| BR-075 | **Manage users** and **DB/reset** are permanently locked to Admin and cannot be granted to any other role, however the matrix is edited. | `LOCKED_TO_ADMIN` (`src/roles.js:51`, `77`); matrix disables the cells (`src/App.jsx:5211`) | `IMPLEMENTED-VERIFIED` (self-check asserts admin retains both even when the row says otherwise) |
| BR-076 | Admin always holds every stage, whatever the stored row says. | `rolesFromRows` (`src/roles.js:76`) | `IMPLEMENTED-VERIFIED` (self-check asserts this) |
| BR-077 | A set of permission rows containing no admin role is rejected outright and the compiled defaults are used instead. | `rolesFromRows` returns `null` (`src/roles.js:75`) | `IMPLEMENTED-VERIFIED` (self-check asserts this) |
| BR-078 | Malformed permission rows are dropped rather than rendered or crashed on. | `rolesFromRows` (`src/roles.js:69-74`) | `IMPLEMENTED-VERIFIED` (self-check asserts junk rows are dropped) |
| BR-079 | Re-running the permissions migration refreshes labels, colours and ordering but never undoes permission edits made in the Admin matrix. | `schema-roles.sql:79-82` (`do update` sets only `label`, `color`, `sort`) | `IMPLEMENTED-UNVERIFIED` |
| BR-080 | A user's avatar letter follows the first letter of their display name. | `UserManager.saveUser` (`src/App.jsx:5067`) | `IMPLEMENTED-UNVERIFIED` |
| BR-081 | A PIN must be 4 to 6 digits, digits only. | `LoginScreen.attempt` (`src/App.jsx:5390`); `UserManager` (`5068`, `5158-5159`) | `IMPLEMENTED-UNVERIFIED` |
| BR-082 | The last remaining user account cannot be removed. | `removeUser` (`src/App.jsx:5082`) | `IMPLEMENTED-UNVERIFIED`; does **not** protect the last *admin* — AUD-011 |
| BR-083 | An administrator who deletes their own account is signed out immediately. | `onSave` (`src/App.jsx:6374`) | `IMPLEMENTED-UNVERIFIED` |
| BR-084 | Accounts removed in the dialog are deleted from the database, not merely hidden, so they cannot sign in from another browser. | `onSave` (`src/App.jsx:6356-6370`) and comment (`6355-6357`) | `IMPLEMENTED-UNVERIFIED` |
| BR-085 | A restored session is re-validated against the live user list on every load: a deleted account is signed out; a renamed or re-roled account picks up its new values. | `loadFromDB` (`src/App.jsx:5602-5608`) | `IMPLEMENTED-UNVERIFIED` |
| BR-086 | A session expires 12 hours after sign-in so a shared machine does not stay signed in. | `SESSION_HRS = 12` (`src/App.jsx:695`); `loadSession` (`701-702`) | `IMPLEMENTED-UNVERIFIED` |

### 6.11 Data integrity, persistence and concurrency

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-087 | Every save writes the whole model row, so a blind write would destroy a colleague's unseen changes. A save must compare version stamps and refuse rather than overwrite. | `phoneToRow` (`src/App.jsx:771-777`); comment (`803-810`); `dbUpdatePhone` (`830-837`) | `IMPLEMENTED-UNVERIFIED` |
| BR-088 | The version stamp is `updated_at`, maintained by a database trigger on every write, and is never sent back by the client. | `schema.sql:48-58`; comment (`src/App.jsx:778-780`) | `IMPLEMENTED-UNVERIFIED` |
| BR-089 | An update is an atomic compare-and-swap. A zero-row result is a conflict, never a permitted last-write-wins overwrite. | `dbUpdatePhone` (`src/App.jsx:830-837`); `schema-phase3.sql:18-20`; `schema.sql:49-51` | `IMPLEMENTED-UNVERIFIED` |
| BR-090 | Creating a model uses a plain INSERT, never an upsert, so a duplicate key is reported as a conflict instead of silently overwriting an existing row. | `dbUpsertPhone` and comment (`src/App.jsx:811-827`) | `IMPLEMENTED-UNVERIFIED` |
| BR-091 | A new model's identifier is a random integer in Postgres `integer` range, not `max(id)+1`, because two browsers would compute the same next number. Visible identifiers are still checked for collision. | `newPhoneId` and comment (`src/App.jsx:3275-3287`) | `IMPLEMENTED-UNVERIFIED` |
| BR-092 | Writes to the same model are serialised in a per-model queue so two rapid edits cannot race each other. | `persist` (`src/App.jsx:5658-5695`) | `IMPLEMENTED-UNVERIFIED` |
| BR-093 | Once a model has lost a save race, every subsequent edit to it is local-only and the user is told so on each attempt, until an explicit refresh. | `persist` (`src/App.jsx:5667-5672`); banner (`6264-6273`) | `IMPLEMENTED-UNVERIFIED`; the latch only clears on a full reload — AUD-008 |
| BR-094 | The application re-reads the database when the tab regains focus and every 90 seconds while visible. | `useEffect` (`src/App.jsx:5628-5639`) | `IMPLEMENTED-UNVERIFIED` |
| BR-095 | A background re-read must never replace an open editor's model or a conflicted local edit. Manual refresh remains the explicit discard-and-reload path. | `shouldKeepLocalEdits` (`src/App.jsx:5577-5588`) | `PARTIAL` — protects the detail panel only, not Inward / PO / STP drafts (AUD-016) |
| BR-096 | Two simultaneous reads are prevented: refocus and the 90-second timer cannot stack. | `refresh` guard (`src/App.jsx:5633`) | `IMPLEMENTED-UNVERIFIED` |
| BR-097 | Every database request is time-boxed at 12 seconds; a request that never settles surfaces a real error instead of hanging the UI. | `DB_TIMEOUT_MS` (`src/App.jsx:666`); `req` (`735-757`) | `IMPLEMENTED-UNVERIFIED` |
| BR-098 | The browser tab warns before closing over an unfinished save. | `beforeunload` handler (`src/App.jsx:5727-5731`) | `IMPLEMENTED-UNVERIFIED` |
| BR-099 | A success message may only claim a save succeeded once the write has completed without error or conflict. With no database configured the message must say the work is tab-local and will be lost. | `saved()` (`src/App.jsx:5712-5724`) and comment (`5708-5711`) | `IMPLEMENTED-UNVERIFIED`; waits on *all* pending writes — AUD-017 |
| BR-100 | The audit trail on a model is capped at 200 entries so a long-lived model cannot grow the JSONB column without bound. | `AUDIT_CAP = 200` (`src/App.jsx:145`, `157`) | `IMPLEMENTED-UNVERIFIED`; silently truncates history — AUD-024 |
| BR-101 | Derived values — progress, delay, stock, sales, runway — are calculated on every render and never stored, so they cannot go stale or disagree with the stored data. | `derive` (`src/App.jsx:313-336`); `models` memo (`5734`) | `IMPLEMENTED-UNVERIFIED` |
| BR-102 | Archived models are excluded from the board, dashboard, reports and deadline tracking unless explicitly shown. | `passesFilters` (`src/App.jsx:645-647`); `liveModels` (`5738`) | `IMPLEMENTED-UNVERIFIED` |

### 6.12 Import and export

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-103 | Phone models may be imported from pasted text or an uploaded `.csv`, `.tsv`, `.txt` or `.xls` file, up to 2 MB. | `CSVImport.readFile` (`src/App.jsx:3083-3097`) | `IMPLEMENTED-UNVERIFIED` |
| BR-104 | Import columns are Brand, Model, Launch date, Segment. Segment is optional and defaults to Mid Range. A header row is skipped. | `CSVImport.parsed` (`src/App.jsx:3120-3140`) | `IMPLEMENTED-UNVERIFIED` |
| BR-105 | Launch dates are accepted as `YYYY-MM-DD` or `DD/MM/YYYY`; anything else is a row error. | `CSVImport.parsed` (`src/App.jsx:3131-3135`) | `IMPLEMENTED-UNVERIFIED` |
| BR-106 | Parsing is quote-aware, so a value legitimately containing a comma does not shift the remaining columns. | `splitRow` and comment (`src/App.jsx:3101-3118`) | `IMPLEMENTED-UNVERIFIED` |
| BR-107 | Every import row is validated and previewed before anything is written. Rows with errors are never imported. | `valid` / `bad` / `toAdd` (`src/App.jsx:3143-3146`); preview table (`3235-3258`) | `IMPLEMENTED-UNVERIFIED` |
| BR-108 | Duplicates are detected by a loose brand+model match ignoring case and non-alphanumeric characters, and are skipped by default — but the user may choose to import them. | `normName` / `findDuplicate` (`src/App.jsx:3290-3292`); `skipDupes` (`3062`, `3146`, `3226-3233`) | `IMPLEMENTED-UNVERIFIED` |
| BR-109 | A duplicate entered manually warns but never blocks, because two variants of the same phone are a legitimate reason to add it twice. | `AddForm` (`src/App.jsx:3314-3317`, `3390-3401`) | `IMPLEMENTED-UNVERIFIED` |
| BR-110 | Imported models always land in Research with today's date as the research completion date. | `importPhones` (`src/App.jsx:6072-6077`) | `IMPLEMENTED-UNVERIFIED` |
| BR-111 | Nine reports are available: All Phones, Planned, Ordered, Production/STP, STP Requirement, Received, Listing, Late Models, Sales. | `REPORT_DEFS` (`src/App.jsx:4939-4949`) | `IMPLEMENTED-UNVERIFIED` |
| BR-112 | Every report and screen export is downloadable as CSV and as an Excel-compatible file. | `downloadReport` (`src/App.jsx:3458-3468`) | `IMPLEMENTED-UNVERIFIED`; the "Excel" file is tab-separated text with an `.xls` extension — AUD-035 |
| BR-113 | A filled-in import template with four example rows is downloadable, because people copy the shape of sample rows rather than read instructions. | `downloadTemplate` and comment (`src/App.jsx:3066-3080`) | `IMPLEMENTED-UNVERIFIED` |

### 6.13 STP report email

| ID | Business rule | Evidence | Status |
| --- | --- | --- | --- |
| BR-114 | A browser cannot be trusted with a mail credential, so the report send runs server-side in an Edge Function holding the API key. | Comment (`src/App.jsx:838-843`); `supabase/functions/send-stp-report/index.ts` | `IMPLEMENTED-UNVERIFIED` |
| BR-115 | A PIN and a browser role are **not** authorization to send email. Every send requires a fresh server-issued approval code. | `request-stp-report-approval/index.ts:1-2`; `REPORT-EMAIL-SETUP.md:3-4` | `IMPLEMENTED-UNVERIFIED` |
| BR-116 | The approval code is 8 characters from a 32-symbol alphabet excluding visually ambiguous characters (no I, O, 0, 1). | `code()` (`request-stp-report-approval/index.ts:26-30`) | `IMPLEMENTED-UNVERIFIED` |
| BR-117 | An approval expires after 10 minutes, may be used once, and is invalidated after 5 wrong attempts. | `schema-report-approval.sql:48`, `59-67`; `attempts` check (`13`) | `IMPLEMENTED-UNVERIFIED` |
| BR-118 | No more than 3 approval requests per hour may originate from one IP address. | `create_report_approval` (`schema-report-approval.sql:41-44`) | `IMPLEMENTED-UNVERIFIED` |
| BR-119 | Approval codes and request IP addresses are stored only as peppered SHA-256 hashes, never in clear. | `hash()` with `REPORT_APPROVAL_PEPPER` (`request-stp-report-approval/index.ts:21-24`, `49-50`) | `IMPLEMENTED-UNVERIFIED` |
| BR-120 | Approver and recipient addresses are server-only configuration. The browser can neither see nor change them, and no browser input influences recipients, content or the data included. | env reads (`index.ts:39`, `17`); comment (`send-stp-report/index.ts:1-2`) | `IMPLEMENTED-UNVERIFIED` |
| BR-121 | The approval and send-log tables are readable by no browser role; only the Edge Functions reach them, using `service_role`. | `schema-report-approval.sql:31-34`, `71-74` | `IMPLEMENTED-UNVERIFIED` |
| BR-122 | Every send attempt is logged with its outcome (`sending` → `sent`/`failed`), recipient count and provider message id, without exposing that id to browser callers. | `report_send_log` (`schema-report-approval.sql:21-29`); `send-stp-report/index.ts:28`, `42`, `44` | `IMPLEMENTED-UNVERIFIED` |
| BR-123 | Both emails carry an idempotency key derived from the approval id, so a retry cannot produce a duplicate send. | `Idempotency-Key` headers (`request-stp-report-approval/index.ts:61`; `send-stp-report/index.ts:40`) | `IMPLEMENTED-UNVERIFIED` |
| BR-124 | If the approval email cannot be delivered, the pending approval row is deleted so no unusable code is left outstanding. | `request-stp-report-approval/index.ts:64-67` | `IMPLEMENTED-UNVERIFIED` |
| BR-125 | The emailed report covers models at Ordered and Production only, grouped by model then material, capped at 500 rows, delivered as an HTML table plus a CSV attachment. | `send-stp-report/index.ts:29-40` | `IMPLEMENTED-UNVERIFIED`; disagrees with the in-app matrix — AUD-013 |

---

## 7. Functional requirements

### 7.0 Module index and conventions

| Module | Name | FR range |
| --- | --- | --- |
| M1 | Authentication and session | FR-001 – FR-005 |
| M2 | Roles, permissions and account administration | FR-006 – FR-012 |
| M3 | Model lifecycle and workflow gates | FR-013 – FR-020 |
| M4 | SKU management | FR-021 – FR-025 |
| M5 | Purchase orders | FR-026 – FR-030 |
| M6 | STP requirement and status | FR-031 – FR-036 |
| M7 | Goods receipt and inward stock | FR-037 – FR-042 |
| M8 | Marketplace listing | FR-043 – FR-047 |
| M9 | Sales and stock | FR-048 – FR-051 |
| M10 | Dashboard, alerts and navigation | FR-052 – FR-056 |
| M11 | Reporting and export | FR-057 – FR-060 |
| M12 | Import | FR-061 – FR-063 |
| M13 | Notes, attachments and audit trail | FR-064 – FR-067 |
| M14 | Persistence, concurrency and synchronisation | FR-068 – FR-074 |
| M15 | STP report email approval | FR-075 – FR-078 |
| M16 | Configuration and deployment | FR-079 – FR-083 |
| M17 | Recommended additions (not implemented) | FR-R01 – FR-R12 |

**Priority scale.** `MUST` = the product does not function without it. `SHOULD` =
materially degrades the product if absent. `COULD` = convenience.
Priorities are **assessed by this audit**, not supplied by a business owner.

**Separation of existing from recommended.** FR-001 to FR-083 describe behaviour
that exists in the evidence baseline. Module M17 (FR-R01 onward) contains
recommended additions only, and nothing in M17 is implemented.

---

### M1 · Authentication and session

#### FR-001 — Sign in with account selection and PIN
- **Module:** M1 · **Role:** All roles · **Priority:** MUST
- **Trigger:** The application loads with no valid stored session.
- **Expected behaviour:** The login screen lists every account as a card showing avatar, display name and role label. Selecting a card reveals a PIN field. On submit, the entered PIN is hashed and compared to the stored hash; a match establishes the session.
- **Validations:** PIN must be at least 4 digits (`src/App.jsx:5390`); non-digit characters are stripped on input (`5478`); maximum 6 characters (`5480`); the Sign in button is genuinely disabled below 4 digits (`5499`).
- **Exception handling:** Below 4 digits → "PIN is at least 4 digits." Mismatch → "Wrong PIN. Try again." and the field is cleared (`5393-5396`). No account lockout, no attempt throttling.
- **Status:** `IMPLEMENTED-UNVERIFIED` — and insecure by design; see AUD-001, AUD-005.
- **Acceptance criteria:** (a) A correct PIN signs the user in with their stored role. (b) A wrong PIN does not sign in and clears the field. (c) A 3-digit PIN cannot be submitted. (d) The PIN is never rendered in plain text unless the show-PIN toggle is pressed.
- **Evidence:** `src/App.jsx:5382-5517`, `423-427`

#### FR-002 — Built-in accounts are offered only when no database contradicts them
- **Module:** M1 · **Role:** All · **Priority:** MUST
- **Trigger:** The login screen renders.
- **Expected behaviour:** Compiled demonstration accounts are shown only when no database is configured, or when a live user read has succeeded. With a database configured but unreachable, **no** accounts are offered.
- **Validations:** `usersAreLive` is set only after a successful user read (`5544`, `5598`).
- **Exception handling:** Unreachable database → an amber warning naming the error, plus a "Retry connection" button when the list is empty (`5416-5436`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) With a configured but unreachable database, the account grid is empty and a warning is shown. (b) With a reachable database, only live accounts appear. (c) With no database configured, the six demonstration accounts appear.
- **Evidence:** `src/App.jsx:6120-6132`, `5414-5436`

#### FR-003 — Session persists across page refresh and expires after 12 hours
- **Module:** M1 · **Role:** All · **Priority:** SHOULD
- **Trigger:** Page load, or sign-in.
- **Expected behaviour:** The signed-in user is written to `localStorage` with a timestamp and restored on reload. A session older than 12 hours is discarded and removed.
- **Validations:** Stored object must contain both `user` and `at` (`5700`).
- **Exception handling:** Unparseable storage, or private browsing where writes throw, is caught and treated as "no session" (`704`, `708`, `711`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Refreshing within 12 hours keeps the user signed in. (b) A session timestamped more than 12 hours ago returns the login screen. (c) Private browsing does not throw an unhandled error.
- **Evidence:** `src/App.jsx:689-712`
- **Note:** The stored object includes the account's PIN hash. See AUD-005.

#### FR-004 — A restored session is re-validated against the live account list
- **Module:** M1 · **Role:** All · **Priority:** MUST
- **Trigger:** Every successful database load.
- **Expected behaviour:** The restored session is matched by id against the freshly read accounts. A missing account signs the user out. A renamed or re-roled account has its new values adopted and re-saved.
- **Validations:** Match by `id` only (`5604`).
- **Exception handling:** Account not found → `clearSession()` and session set to null (`5605`).
- **Status:** `IMPLEMENTED-UNVERIFIED` — implements BR-085
- **Acceptance criteria:** (a) Deleting an account elsewhere signs that user out on their next load. (b) Changing a role elsewhere changes the user's permissions on their next load without re-login.
- **Evidence:** `src/App.jsx:5599-5608`

#### FR-005 — Sign out clears the session and all open panels
- **Module:** M1 · **Role:** All · **Priority:** MUST
- **Trigger:** The user presses Sign out.
- **Expected behaviour:** Stored session removed; session state cleared; any open detail panel and add form closed; the login screen is shown.
- **Validations:** None required.
- **Exception handling:** Storage removal failure is swallowed (`711`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) After sign-out, a refresh does not restore the session. (b) No detail panel remains open behind the login screen.
- **Evidence:** `src/App.jsx:5701-5704`

---

### M2 · Roles, permissions and account administration

#### FR-006 — Permissions are loaded from the database with a compiled fallback
- **Module:** M2 · **Role:** System · **Priority:** MUST
- **Trigger:** Every database load.
- **Expected behaviour:** `role_permissions` is read in parallel with users and models. Valid rows replace the role list, the per-role stage ownership map and the permission map. An absent, empty or admin-less result leaves the compiled defaults in place.
- **Validations:** `rolesFromRows` rejects a row set with no admin role and drops rows without a `role` key; `advance_to` that is not an array becomes an empty array (`src/roles.js:65-79`).
- **Exception handling:** A `role_permissions` read error must not fail the overall load (`src/App.jsx:5584-5585`, `5594`).
- **Status:** `IMPLEMENTED-VERIFIED` — the mapping function is covered by the executed self-check (TST-001); the database wiring around it is `IMPLEMENTED-UNVERIFIED`.
- **Acceptance criteria:** (a) With no `role_permissions` table the application still works on compiled defaults. (b) Rows missing an admin role are ignored entirely. (c) Admin always receives every stage and both locked permissions.
- **Evidence:** `src/roles.js:60-85`; `src/App.jsx:894-898`, `5584-5595`; `src/roles.selfcheck.mjs:24-52`

#### FR-007 — Admin edits the permission matrix
- **Module:** M2 · **Role:** Admin only · **Priority:** SHOULD
- **Trigger:** Admin opens Users → Permissions.
- **Expected behaviour:** A role × permission checkbox grid plus, per role, a set of toggle buttons for the stages that role may move work into. Saving applies the change locally at once, then writes one row per role.
- **Validations:** Admin's own row is disabled; Manage users and DB/reset are disabled for every role (`src/App.jsx:5211`).
- **Exception handling:** No database → "Permissions changed in this tab only" (`6350`). Write failure → the error is named (`6352`).
- **Status:** `PARTIAL` — see AUD-010: because Admin's cells are disabled, a stored admin row that lacks a non-locked permission cannot be repaired from this screen.
- **Acceptance criteria:** (a) Removing `savePO` from Procurement immediately hides the PO save control for that role. (b) Admin cannot be stripped of Manage users or DB/reset. (c) A failed write reports the error rather than claiming success.
- **Evidence:** `src/App.jsx:5177-5252`, `6343-6353`

#### FR-008 — Admin creates, edits and removes user accounts
- **Module:** M2 · **Role:** Admin only · **Priority:** MUST
- **Trigger:** Admin opens Users → Accounts.
- **Expected behaviour:** Accounts are listed with avatar, name and role. Each can be edited in place (display name, role, optional new PIN). A new account is created with role Procurement and PIN `0000`, immediately opened for editing. Removal is immediate in the dialog. All changes commit on "Save all and close".
- **Validations:** Display name must be non-blank (`5060`, `5166`); a new PIN is applied only at 4 or more digits (`5068`); non-digits stripped (`5159`); the last remaining account cannot be removed (`5082`).
- **Exception handling:** Accounts removed in the dialog are also deleted from the database; the first write failure is reported and the success message suppressed (`6367-6375`). An admin who removed their own account is signed out.
- **Status:** `PARTIAL` — see AUD-011: nothing prevents the removal or re-roling of the last admin.
- **Acceptance criteria:** (a) A renamed account shows the new name and a matching avatar letter. (b) A reset PIN signs in and the old PIN does not. (c) An account removed in the dialog cannot sign in from another browser afterwards. (d) A failed write does not report "Users saved".
- **Evidence:** `src/App.jsx:5025-5256`, `6354-6379`

#### FR-009 — Permission denial is shown, not hidden
- **Module:** M2 · **Role:** All · **Priority:** SHOULD
- **Trigger:** A user whose role lacks a permission opens a screen that uses it.
- **Expected behaviour:** The data remains visible; only the editing controls are withdrawn, and a read-only notice names the role to contact.
- **Validations:** Editors receive `null` instead of a save handler when the permission is absent (`6310`), and render `RoleLocked` in its place.
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) A Sales user viewing a Production model sees STP statuses but no editable control and a notice naming Warehouse. (b) No disabled control is styled as though it were pressable (`src/App.jsx:1012-1018`).
- **Evidence:** `src/App.jsx:1701-1707`, `1981`, `2095`, `2224`, `4130`, `4356`

#### FR-010 — The Add phone control is disabled, not faked, for roles without the permission
- **Module:** M2 · **Role:** All · **Priority:** SHOULD
- **Trigger:** The header renders.
- **Expected behaviour:** One button, genuinely `disabled`, with a title naming the role that cannot add phones.
- **Validations:** `CAN.addPhone(role)`.
- **Exception handling:** The handler re-checks the permission and refuses with a message (`6090-6093`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) A Sales user's Add phone button cannot be focused into an action and announces as disabled. (b) Calling the handler without the permission produces a refusal message and no new model.
- **Evidence:** `src/App.jsx:6236-6242`, `6089-6093`

#### FR-011 — Stage ownership determines who may move work into a stage
- **Module:** M2 · **Role:** All · **Priority:** MUST
- **Trigger:** Any attempted stage change.
- **Expected behaviour:** The role attempting the move must hold the **target** stage in its `advance_to` list, for both forward and backward moves. The role that owns a stage is the role allowed to move work into it.
- **Validations:** `canEnterStage` requires a real, non-`none` role (`src/App.jsx:564-565`).
- **Exception handling:** Refusal message names the role and the target stage.
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Warehouse can move a model into Production but not into Received. (b) Sales and Customer Care cannot move any model anywhere. (c) The same refusal appears whether the attempt was a drag, a button or a bulk action.
- **Evidence:** `src/App.jsx:462-481`, `561-565`, `584-621`

#### FR-012 — Customer Care may file a model but may not progress it
- **Module:** M2 · **Role:** Customer Care · **Priority:** SHOULD
- **Trigger:** Customer Care signs in.
- **Expected behaviour:** Add phone is available; a created model lands in Research; every other permission is withheld and `advance_to` is empty, so the model cannot be moved.
- **Validations:** `DEFAULT_PERMS.addPhone` includes `customer_care`; all other keys exclude it (`src/roles.js:36-47`).
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-VERIFIED` — directly asserted by the executed self-check (`src/roles.selfcheck.mjs:14-19`, `33`).
- **Acceptance criteria:** (a) Customer Care can add a phone. (b) Customer Care cannot log sales, archive, or manage users. (c) Customer Care cannot move a model out of Research.
- **Evidence:** `src/roles.js:34-47`; `schema-roles.sql:73-78`; `src/roles.selfcheck.mjs:14-19`

---

### M3 · Model lifecycle and workflow gates

#### FR-013 — Create a model manually
- **Module:** M3 · **Roles:** Admin, Procurement, Catalog, Customer Care · **Priority:** MUST
- **Trigger:** The user presses Add phone and completes the form.
- **Expected behaviour:** Brand, model name, launch date and price segment are captured. The model is created at Research with today's date as the research completion date, an empty SKU list and no PO, then persisted, and its detail panel is opened.
- **Validations:** Brand non-blank, model name non-blank, launch date present — each listed as a named problem before save (`src/App.jsx:3319-3323`); the launch-date hint states whether the runway is comfortable, tight or already past (`3308-3312`).
- **Exception handling:** A loose brand+model match against existing models raises a prominent duplicate warning that does not block; the save button relabels to "Add anyway" (`3390-3401`, `3416`). Permission re-checked in the handler.
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) A model cannot be saved without all three required fields. (b) A duplicate warns and names the existing model's stage and launch date, but can still be added. (c) The created model appears at Research with today's research date.
- **Evidence:** `src/App.jsx:3294-3423`, `6089-6101`

#### FR-014 — Advance a model one stage
- **Module:** M3 · **Role:** Roles owning the target stage · **Priority:** MUST
- **Trigger:** The board's quick-advance arrow, the detail panel footer, or the inward screen's move button.
- **Expected behaviour:** The role check and then the data gate are evaluated. On success the model moves, completion dates are stamped, an audit entry is written and the change is persisted. On failure the specific reason is shown.
- **Validations:** `advanceStatus` = terminal check → next-stage existence → role → `gateBlock` (`src/App.jsx:567-577`).
- **Exception handling:** Every refusal produces a named reason, surfaced as a tooltip on the control, as text on the card, and as a message on attempted use (`1510`, `1539-1544`, `2909-2911`, `5803`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) A model at Planned with a blank SKU code cannot advance, and the message names the count. (b) The arrow, the footer button and the inward button all refuse for the same reason. (c) A successful advance writes an audit line naming the stage.
- **Evidence:** `src/App.jsx:503-540`, `567-577`, `5765-5813`

#### FR-015 — Move a model backwards
- **Module:** M3 · **Role:** Roles owning the target stage · **Priority:** SHOULD
- **Trigger:** The detail panel's back button, or a drag onto an earlier column.
- **Expected behaviour:** The role must own the stage being moved into. Completion dates for every stage after the target are deleted. An audit entry records the backward move.
- **Validations:** `moveStatus` backward branch (`src/App.jsx:618-620`).
- **Exception handling:** Refusal names the role and the target stage.
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Moving Received → Production deletes the received completion date. (b) A role that does not own the earlier stage cannot move the model back into it. (c) The timeline in the detail panel reflects the removed dates immediately.
- **Evidence:** `src/App.jsx:584-621`, `5788`, `5815-5819`

#### FR-016 — Drag and drop on the board obeys the same rules as the buttons
- **Module:** M3 · **Role:** All · **Priority:** SHOULD
- **Trigger:** The user drags a card over a stage column.
- **Expected behaviour:** A column highlights and accepts the drop only if `moveStatus` permits that exact move. Illegal columns never highlight and never accept.
- **Validations:** `canDropOn` delegates entirely to `moveStatus` (`src/App.jsx:1413`); `onDragOver` returns early when the drop is not permitted (`1485`).
- **Exception handling:** An illegal drop is a no-op; drag state is cleared either way (`1415-1418`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Dragging a Planned model with a blank SKU code onto Ordered does not highlight Ordered and does not move the model. (b) Dragging two stages ahead never succeeds.
- **Evidence:** `src/App.jsx:1405-1418`, `1482-1488`
- **Note:** Pointer-only; no keyboard equivalent for backward moves. See AUD-015.

#### FR-017 — Record a decision not to procure a model
- **Module:** M3 · **Roles:** Admin, Procurement · **Priority:** SHOULD
- **Trigger:** The user presses "Not procuring" in the detail panel of a Research-stage model.
- **Expected behaviour:** The model moves to Un-Procurement, keeping its research record. It gains no completion date for that move, drops out of deadline tracking and raises no alerts. An audit entry records the decision.
- **Validations:** The control renders only when the model is at Research and `moveStatus(..., "unprocured").ok` (`src/App.jsx:2916`).
- **Exception handling:** From any stage other than Research → "Only Research models can move to Un-Procurement" (`595`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) An un-procured model shows no deadlines and appears in no late list. (b) It is counted in a dedicated dashboard card and gains a funnel row only when non-empty. (c) It can be returned to Research and resumes tracking.
- **Evidence:** `src/App.jsx:2915-2922`, `593-606`, `3567-3570`, `3641-3645`

#### FR-018 — Archive and restore a model
- **Module:** M3 · **Roles:** Admin, Procurement · **Priority:** COULD
- **Trigger:** The archive button in the detail panel footer.
- **Expected behaviour:** The model is flagged archived, removed from the board, dashboard, calendar, reports and deadline tracking, and its detail panel closes. It can be surfaced again by the Archived filter chip and restored.
- **Validations:** `passesFilters` shows archived models only when the chip is on, and only archived models when it is (`src/App.jsx:645-647`).
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) An archived model disappears from the board and every report. (b) The Archived chip appears only when at least one model is archived, with a count. (c) Restoring returns the model to its original stage.
- **Evidence:** `src/App.jsx:2923-2930`, `6054-6063`, `1380-1387`

#### FR-019 — Delete every model (reset)
- **Module:** M3 · **Role:** Admin only · **Priority:** COULD
- **Trigger:** The Reset button, then confirmation.
- **Expected behaviour:** A modal confirmation states that the action is permanent with no undo, focuses Cancel rather than the destructive button, and can be dismissed with Escape. On confirmation every model row is deleted from the database and local state is emptied.
- **Validations:** The control renders only for `CAN.reset(role)` (`src/App.jsx:6227`).
- **Exception handling:** The delete is awaited before local state is cleared (`6006-6007`); no error path is reported to the user.
- **Status:** `PARTIAL` — the delete result is not inspected, so a failed server delete still clears the screen. The handler does not re-check the permission (AUD-009).
- **Acceptance criteria:** (a) Escape and Cancel both abort with nothing deleted. (b) Focus lands on Cancel when the dialog opens. (c) Confirming empties the list.
- **Evidence:** `src/App.jsx:1217-1249`, `6005-6012`, `6316-6324`, `872-875`

#### FR-020 — Filter and search the model list
- **Module:** M3 · **Role:** All · **Priority:** SHOULD
- **Trigger:** The user types in the search box or presses a filter chip on the Board or List view.
- **Expected behaviour:** One shared filter state persists across view switches. Free-text search matches brand, model name, PO, segment, SKU code and material. Chips filter to: actionable by my role, late, launching within 30 days, archived, and a brand selector (shown only when more than one brand exists). Each chip carries a live count. "Clear all" appears only when a filter is active.
- **Validations:** `passesFilters` is the single decision point (`src/App.jsx:644-654`).
- **Exception handling:** Empty result sets produce a tailored message distinguishing "nothing is waiting on your role" from "no phones match your filters" (`1433-1442`, `1679-1687`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) A SKU code typed in search finds its model. (b) The "Needs my action" count equals the number of models the signed-in role can actually advance. (c) Switching Board → List keeps the active filters. (d) Board column counts show `shown/total` when a filter hides cards.
- **Evidence:** `src/App.jsx:626-656`, `1304-1399`, `1471-1476`

---

### M4 · SKU management

#### FR-021 — Maintain the SKU list for a model
- **Module:** M4 · **Roles:** Admin, Procurement · **Priority:** MUST
- **Trigger:** The user opens a model at Planned, Ordered or Production.
- **Expected behaviour:** An editable table of SKU code, material (from the four offered) and unit count, with add and remove per row. Selecting a material fills the default quantity unless the buyer has typed their own. Saving writes the list, discarding wholly empty rows, and records an audit entry with the count.
- **Validations:** A blank SKU code is outlined in the alert colour (`src/App.jsx:1791`); a running count of blank codes is shown (`1858`); units accept non-negative numbers only (`1809`).
- **Exception handling:** Saving with blank codes is permitted — the Planned → Ordered gate is what refuses, with the count (BR-012).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Selecting "Silicone Cover" on an untouched row sets units to 30. (b) Typing 45 then changing the material keeps 45. (c) A row with no code, material or units is dropped on save. (d) The blank-code count matches the gate's refusal message.
- **Evidence:** `src/App.jsx:1715-1863`, `5832-5839`

#### FR-022 — Bulk-paste a SKU list
- **Module:** M4 · **Roles:** Admin, Procurement · **Priority:** SHOULD
- **Trigger:** The user pastes lines into the bulk box and presses Add or Replace.
- **Expected behaviour:** One line per SKU as `SKU, Material, Units`, accepting commas or tabs. A leading header row is skipped. Units omitted default from the material. Everything after the material is joined before parsing, so a pasted `5,000` reads as 5000. Append merges with the existing list (dropping empty rows); Replace discards it.
- **Validations:** A line with no SKU code is counted as skipped; zero parsed rows produces "No valid rows found. Each line needs at least a SKU." (`src/App.jsx:1736`, `1742`).
- **Exception handling:** A partial result reports "N added, M blank line(s) skipped." (`1746`).
- **Status:** `PARTIAL` — material values are not validated against the offered list. See AUD-013.
- **Acceptance criteria:** (a) `SIL-A57-BLK, Silicone Cover, 30` creates one SKU with 30 units. (b) `SIL-A57-BLU, Silicone Cover` creates one SKU with 30 units. (c) `TPU-X, TPU+PC, 5,000` yields 5000, not 5. (d) A header line beginning `SKU,` is skipped. (e) Replace leaves exactly the pasted rows.
- **Evidence:** `src/App.jsx:1728-1748`, `1831-1848`

#### FR-023 — Export a model's SKU list for the supplier
- **Module:** M4 · **Role:** All (read) · **Priority:** SHOULD
- **Trigger:** The user presses Export CSV or Export Excel on an Ordered-stage model.
- **Expected behaviour:** A file named for brand and model containing SKU, material and planned units for every SKU.
- **Validations:** Models with SKUs missing a code show a warning above the table naming the count (`src/App.jsx:1919-1923`).
- **Exception handling:** Missing codes export as empty cells; the on-screen table marks them "missing".
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) The exported row count equals the SKU count. (b) The filename contains brand and model with spaces replaced. (c) Both formats contain identical data.
- **Evidence:** `src/App.jsx:1907-1945`, `3445-3468`

#### FR-024 — SKU identifiers survive reload and repair themselves
- **Module:** M4 · **Role:** System · **Priority:** MUST
- **Trigger:** Any model row read from the database.
- **Expected behaviour:** Each SKU's internal identifier is checked for presence and uniqueness within the model; duplicates or absences are replaced with fresh identifiers, and the model object is only re-created if something changed.
- **Validations:** A `Set` of seen identifiers within one model (`src/App.jsx:116-123`).
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Two SKUs on one model never share an identifier after a read. (b) A model whose identifiers are already valid is returned unchanged.
- **Evidence:** `src/App.jsx:111-125`, `781`
- **Note:** Uniqueness is enforced per model only; cross-model and cross-tab collisions are possible. See AUD-012.

#### FR-025 — SKU changes after ordering are permitted and flagged
- **Module:** M4 · **Roles:** Admin, Procurement · **Priority:** SHOULD
- **Trigger:** The user edits SKUs on a model at Ordered or Production.
- **Expected behaviour:** Editing is allowed, and the panel heading and help text change to warn that the order has changed and the PO and STP file must be re-sent.
- **Validations:** None beyond FR-021.
- **Exception handling:** n/a
- **Status:** `PARTIAL` — the warning is advisory only. Nothing records that a re-send is outstanding, resets affected STP statuses, or alerts on it.
- **Acceptance criteria:** (a) The editor is available at Ordered and Production. (b) The re-send warning is displayed in those stages and not at Planned.
- **Evidence:** `src/App.jsx:1762`, `1768-1771`, `2800-2811`

---

### M5 · Purchase orders

#### FR-026 — Build a purchase order across several models
- **Module:** M5 · **Roles:** Admin, Procurement · **Priority:** MUST
- **Trigger:** The user opens Orders and selects models.
- **Expected behaviour:** Models eligible for a PO (at Ordered, or at Planned with every SKU coded) and not already carrying one are listed with stage, launch date, SKU count and units. Rows are tickable individually or all at once. A running total of models, SKUs and units is shown. Typing a PO number and confirming assigns it to every selected model in one action, each with its own audit entry.
- **Validations:** Assign is inert unless a non-blank PO number and at least one model are present (`src/App.jsx:4670`, `4773`).
- **Exception handling:** With no eligible unassigned models, an explanatory message replaces the builder (`4704-4708`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) A Planned model with a blank SKU code is not listed as eligible. (b) Assigning writes the same PO to every selected model. (c) The running total matches the ticked rows. (d) Enter in the PO field triggers the assignment.
- **Evidence:** `src/App.jsx:4651-4788`, `5959-5966`

#### FR-027 — Set or clear a PO number on a single model
- **Module:** M5 · **Roles:** Admin, Procurement · **Priority:** MUST
- **Trigger:** The user edits the PO field in an Ordered-stage model's detail panel.
- **Expected behaviour:** The field is pre-filled with the current value; the save control activates only when the value differs; Enter saves. Clearing and saving removes the PO and records "PO cleared".
- **Validations:** The value is trimmed; `dirty` compares trimmed input against the stored value (`src/App.jsx:1872`).
- **Exception handling:** Without the permission the field is read-only and a notice names Procurement (`1877`, `1882`). With no PO recorded, a warning states the export will go out without one (`1894-1898`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) The save control is inert until the value changes. (b) Saving an empty value clears the PO and the audit line reads "PO cleared". (c) A role without `savePO` sees the number but cannot edit it.
- **Evidence:** `src/App.jsx:1868-1901`, `5968-5975`

#### FR-028 — Review existing purchase orders
- **Module:** M5 · **Role:** All (read) · **Priority:** SHOULD
- **Trigger:** The user opens Orders.
- **Expected behaviour:** Every PO in use is listed in sorted order with its model count, SKU count and unit total, expandable to show each model's SKUs. Clicking a row opens that model. Each PO exports as a combined SKU sheet.
- **Validations:** n/a
- **Exception handling:** "No purchase orders yet." when none exist (`src/App.jsx:4794-4796`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) A PO covering three models shows "3 models". (b) The unit total equals the sum of the SKU units across those models. (c) The export contains one row per SKU per model with the PO number repeated.
- **Evidence:** `src/App.jsx:4676-4686`, `4790-4847`

#### FR-029 — Receive a shipment against a PO in bulk
- **Module:** M5 · **Roles:** Admin, Catalog · **Priority:** SHOULD
- **Trigger:** The user opens Orders → Receive against a PO, marks models and applies.
- **Expected behaviour:** Models with a PO and in Production are grouped by PO. Each is marked "Received" or "Not yet", individually or all at once. Applying moves the received models to Received with every SKU set to received-in-full, and returns the not-received models to Ordered with their PO cleared. Successfully applied marks are cleared; unapplied marks are retained.
- **Validations:** The permission is re-checked in the handler (`src/App.jsx:5893`); each model's stage is re-checked; the Production gate is re-applied per model (`5903-5906`).
- **Exception handling:** Models that fail the gate or have left Production are skipped and named with the reason, both when some succeed and when none do (`5914-5920`, `5948-5954`).
- **Status:** `PARTIAL` — the stage and gate re-checks read a render-time copy of the model list, so a change made in another tab since the last sync is not detected. See AUD-027.
- **Acceptance criteria:** (a) A model with a required STP file still "Not Sent" is skipped with that reason. (b) A not-received model returns to Ordered with no PO and reappears in the PO builder. (c) A received model has every SKU at received-in-full with quantity equal to planned. (d) Marks for skipped models remain ticked.
- **Evidence:** `src/App.jsx:4498-4641`, `5885-5956`

#### FR-030 — PO assignment and receipt are recorded in the audit trail
- **Module:** M5 · **Role:** System · **Priority:** SHOULD
- **Trigger:** Any PO assignment, PO change, or bulk receipt.
- **Expected behaviour:** An audit entry naming the action and the PO number is appended to each affected model.
- **Validations:** n/a
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Assigning PO-2026-001 to two models writes "Added to PO PO-2026-001" on both. (b) A bulk receipt writes "Received in full against PO-2026-001". (c) A not-received model's entry names the PO it was returned from.
- **Evidence:** `src/App.jsx:5961`, `5931`, `5936-5937`, `147-158`

---

### M6 · STP requirement and status

#### FR-031 — Decide whether an STP file is required, model by material
- **Module:** M6 · **Roles:** Admin, Catalog · **Priority:** MUST
- **Trigger:** The user opens Inward → STP requirement and clicks a matrix cell.
- **Expected behaviour:** Models at Ordered or Production with at least one SKU form the rows; the four offered materials form the columns. Each cell shows Required, Not required, "— decide —" or Mixed, and cycles on click, applying to every SKU of that material in that model. Buttons set an entire model or an entire material column at once. Live counts of required and undecided SKUs are shown.
- **Validations:** The permission is re-checked in the handler and refused by name if absent (`src/App.jsx:5858`); a cell with no SKUs of that material is inert.
- **Exception handling:** Without the permission a read-only notice names Catalog (`4356`).
- **Status:** `PARTIAL` — three defects: columns are the hardcoded material list, so SKUs with any other material never appear (AUD-013); a column-wide set issues one write per model (AUD-014); cells are not keyboard-operable (AUD-015).
- **Acceptance criteria:** (a) Clicking an undecided cell makes every SKU of that material in that model Required. (b) A cell whose SKUs disagree shows Mixed and resets to Required on click. (c) The undecided count falls by the number of SKUs the click affected. (d) A role without the permission sees the values but cannot change them.
- **Evidence:** `src/App.jsx:4287-4432`, `5854-5869`

#### FR-032 — Track STP file status per SKU
- **Module:** M6 · **Roles:** Admin, Warehouse · **Priority:** MUST
- **Trigger:** The user opens a Production-stage model's detail panel.
- **Expected behaviour:** A table of every SKU with its code, material, units, read-only requirement decision and an editable status selector offering the six statuses. A "Set all" row applies one status to every SKU. Saving writes the statuses and records an audit entry. Live counts of completed, rejected and not-sent are shown.
- **Validations:** SKUs missing a material or code are counted in a warning telling the user to fix them at Planned (`src/App.jsx:1983-1987`).
- **Exception handling:** Without the permission the selectors are disabled and a notice names Warehouse (`1981`, `2016`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Setting a required SKU to Completed removes it from the "not sent" gate refusal. (b) Setting a required SKU to Rejected blocks the move out of Production, naming the count. (c) The requirement column is not editable on this screen. (d) "Set all" changes every row's selector.
- **Evidence:** `src/App.jsx:1952-2042`, `5843-5852`

#### FR-033 — The requirement decision and the status chase are separate permissions
- **Module:** M6 · **Role:** All · **Priority:** MUST
- **Trigger:** Any STP screen renders.
- **Expected behaviour:** `setStpRequired` (Catalog) and `updateSTP` (Warehouse) are independent permissions held by different roles by default, so neither team can make the other's decision.
- **Validations:** Both are present as separate keys in `PERM_KEYS` and `DEFAULT_PERMS`.
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-VERIFIED` (the key separation is asserted by the executed self-check through the full `PERM_KEYS` admin assertion and the round-trip case) / `IMPLEMENTED-UNVERIFIED` for the screen wiring.
- **Acceptance criteria:** (a) Warehouse cannot change a requirement cell. (b) Catalog cannot change an STP status selector. (c) Admin can do both.
- **Evidence:** `src/roles.js:13-14`, `31-33`, `41-42`; `src/App.jsx:6302`

#### FR-034 — Export the STP requirement report
- **Module:** M6 · **Role:** All (read) · **Priority:** SHOULD
- **Trigger:** The user presses CSV or Excel on the STP requirement screen.
- **Expected behaviour:** One row per model per material in use, carrying brand, model, stage, PO, material, the SKU codes sharing that material, their combined units, and the requirement value (Required / Not required / Not decided / Mixed).
- **Validations:** Only materials with at least one SKU in that model produce a row.
- **Exception handling:** n/a
- **Status:** `PARTIAL` — iterates the hardcoded material list, so SKUs with other materials are omitted from the file. The Reports tab's equivalent report groups by the stored material instead, so the two disagree. See AUD-013.
- **Acceptance criteria:** (a) Two SKUs of the same material in one model collapse to one row with both codes and the summed units. (b) A model whose SKUs of one material disagree shows "Mixed". (c) The file's row count matches the on-screen matrix's populated cells.
- **Evidence:** `src/App.jsx:4323-4335`; compare `4886-4902`; compare `supabase/functions/send-stp-report/index.ts:33-36`

#### FR-035 — An undecided requirement is visible rather than blocking
- **Module:** M6 · **Role:** All · **Priority:** SHOULD
- **Trigger:** A model at Ordered or Production has at least one SKU with no requirement decision.
- **Expected behaviour:** The move out of Production is not blocked. Instead a warning alert states the count of undecided SKUs, and the requirement screen shows a live undecided count.
- **Validations:** n/a
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-UNVERIFIED` · **`CLARIFICATION`** — the trade-off is deliberate per `src/App.jsx:230-232` and `371-372`, but no business owner has confirmed it. See OQ-03.
- **Acceptance criteria:** (a) A model with only undecided SKUs can move from Production to Received. (b) That model raises a warning alert naming the undecided count. (c) The requirement screen shows the same count.
- **Evidence:** `src/App.jsx:230-236`, `373-374`, `520-521`, `4362-4363`

#### FR-036 — Request and send the STP requirement report by email
- **Module:** M6 / M15 · **Roles:** Admin, Catalog (requester) · **Priority:** SHOULD
- **Trigger:** The user presses "Email MD / Factory" on the STP requirement screen.
- **Expected behaviour:** An approval code is requested from the server. On success a code-entry panel appears; entering the 8-character code sends the server-generated report to the server-configured recipients.
- **Validations:** The code field accepts only the 32-symbol alphabet, upper-cases input and truncates to 8 characters (`src/App.jsx:4479`); the send is refused client-side unless the code matches the expected shape (`4453`).
- **Exception handling:** Every failure path reports the server's message; buttons disable while a request or send is in flight (`4448`, `4457`, `4424`).
- **Status:** `IMPLEMENTED-UNVERIFIED` — no deployment was available to exercise this. See §20.
- **Acceptance criteria:** (a) Pressing the button sends a code to the configured approver and shows the code panel. (b) An incorrect code is refused and sends no email. (c) A correct code sends exactly one email to the configured recipients. (d) Re-using the same code fails.
- **Evidence:** `src/App.jsx:4437-4495`, `845-866`; `supabase/functions/*`; `REPORT-EMAIL-SETUP.md:40-49`
- **Note:** The email reports models at Ordered and Production from the server, not the filtered content on screen. See OQ-08.

---

### M7 · Goods receipt and inward stock

#### FR-037 — Confirm receipt per SKU in a model's detail panel
- **Module:** M7 · **Roles:** Admin, Catalog · **Priority:** MUST
- **Trigger:** The user opens a Received-stage model.
- **Expected behaviour:** A table of every SKU with planned units and an editable received quantity. Typing a quantity sets the receipt state automatically. Quick buttons mark one SKU received-in-full or nothing-arrived, and one button marks every SKU received in full. The shortfall per row and overall is shown. Saving writes the quantities and states with an audit entry.
- **Validations:** Quantities are non-negative (`src/App.jsx:2064`); blank clears both quantity and state.
- **Exception handling:** The permission is re-checked in the handler (`5979`). Without it the inputs are read-only and a notice names Catalog (`2095`, `2119`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Entering 0 sets "Not received"; below planned sets "Short"; at or above planned sets "Received in full". (b) Clearing the field returns the row to "Pending". (c) The overall summary switches between "N still unconfirmed", "N units short overall" and "All N units received". (d) Saving with any row unconfirmed still blocks the move to Live.
- **Evidence:** `src/App.jsx:2049-2162`, `5977-5992`

#### FR-038 — Book stock in across many models from one screen
- **Module:** M7 · **Roles:** Admin, Catalog · **Priority:** MUST
- **Trigger:** The user opens Inward → Inward stock.
- **Expected behaviour:** Every SKU on every model at Ordered, Production or Received, grouped by model and ordered by urgency. Edits accumulate in a draft shown as unsaved, with an "N unsaved" indicator, and commit in one action grouped per model. Bulk controls mark everything on screen, everything on one model, or one SKU as received-in-full, nothing-received, or cleared. Ordered-versus-received totals and counts of unconfirmed, short and never-arrived SKUs are shown. An "Unconfirmed only" filter is available.
- **Validations:** Draft values take precedence over stored values everywhere, so nothing on screen reads stale (`src/App.jsx:4053`).
- **Exception handling:** Without the permission a notice names Catalog and inputs are read-only (`4130`, `4240`). With nothing to book in, an explanatory message states when models appear and when they leave.
- **Status:** `PARTIAL` — a background re-read is not suppressed while an inward draft is open, and draft entries for SKUs that no longer exist are dropped silently on save. See AUD-016.
- **Acceptance criteria:** (a) "Everything received in full" marks every SKU on screen and shows the unsaved count. (b) Saving issues one write per affected model, not one per SKU. (c) The ordered-versus-received totals reflect draft values before saving. (d) "Unconfirmed only" hides rows with a confirmed state.
- **Evidence:** `src/App.jsx:4041-4277`

#### FR-039 — Move several models to Received in one action
- **Module:** M7 · **Roles:** Admin, Catalog · **Priority:** SHOULD
- **Trigger:** The user ticks models in the bulk-inward bar and confirms.
- **Expected behaviour:** Only models at Production that pass the gate and that the role may move into Received are offered. "Select all ready" ticks them all. Confirming moves each selected model to Received.
- **Validations:** Readiness combines `gateBlock` and `moveStatus` (`src/App.jsx:4092-4093`); the action is disabled while unsaved receipt edits exist, with an explanatory tag (`4174`, `4177`).
- **Exception handling:** Each move still passes through `move()`, so an individually invalid move is refused with its own reason.
- **Status:** `PARTIAL` — each model is moved separately, producing one write and one message per model. See AUD-014.
- **Acceptance criteria:** (a) A model with a rejected required STP file is not offered as ready. (b) The confirm control is disabled while any receipt edit is unsaved. (c) Confirming moves every ticked model and clears the selection.
- **Evidence:** `src/App.jsx:4092-4102`, `4165-4179`

#### FR-040 — Short and nil deliveries are recorded and chased, not hidden
- **Module:** M7 · **Role:** All · **Priority:** MUST
- **Trigger:** A SKU is confirmed short or not received.
- **Expected behaviour:** The shortfall is retained on the SKU, summed per model, reported in the received report, and raised as an alert — a warning for short deliveries with the total units missing, and an urgent alert for SKUs that never arrived.
- **Validations:** n/a
- **Exception handling:** n/a
- **Status:** `PARTIAL` · **`CLARIFICATION`** — the alerts have no resolution mechanism, so an accepted short delivery alerts indefinitely. See AUD-020 and OQ-04.
- **Acceptance criteria:** (a) A short SKU produces a warning naming the total units missing across the model. (b) A nil SKU produces an urgent alert. (c) The received report shows planned, received and short-by per SKU. (d) Neither condition blocks the move to Live.
- **Evidence:** `src/App.jsx:376-380`, `237`, `4903-4909`, `530-538`

#### FR-041 — Export the inward stock working list
- **Module:** M7 · **Role:** All (read) · **Priority:** COULD
- **Trigger:** The user presses CSV or Excel on the inward screen.
- **Expected behaviour:** One row per SKU across every model on screen, carrying brand, model, stage, PO, SKU, material, units ordered, units received, short-by and receipt status — using draft values where present.
- **Validations:** n/a
- **Exception handling:** Unconfirmed rows export an empty received quantity and short-by.
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Unsaved draft quantities appear in the file. (b) Unconfirmed rows have blank received and short-by cells. (c) The row count equals the SKU count across all listed models, regardless of the "Unconfirmed only" filter.
- **Evidence:** `src/App.jsx:4104-4114`

#### FR-042 — The inward nav badge counts unbooked SKUs
- **Module:** M7 · **Role:** All · **Priority:** COULD
- **Trigger:** The header renders.
- **Expected behaviour:** The Inward tab carries a badge counting every SKU on a non-archived model at Ordered, Production or Received whose receipt is not yet confirmed.
- **Validations:** n/a
- **Exception handling:** The badge is hidden at zero.
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) The badge equals the count of unconfirmed SKUs on the inward screen with no filter applied. (b) Confirming and saving every SKU removes the badge. (c) Archived models are excluded.
- **Evidence:** `src/App.jsx:5745-5747`, `6150-6164`

---

### M8 · Marketplace listing

#### FR-043 — Maintain listing status per SKU per marketplace
- **Module:** M8 · **Roles:** Admin, Catalog · **Priority:** MUST
- **Trigger:** The user opens a Received- or Live-stage model.
- **Expected behaviour:** A grid of SKUs against the four marketplaces. Each cell cycles Not listed → In progress → Live → Blocked on click. A per-column button sets one marketplace Live for every SKU; one button marks everything live. Saving merges the changes and records an audit entry. Live counts per marketplace, fully-listed count and blocked count update as cells change.
- **Validations:** Counts read from the working draft so the summary tracks clicks before saving (`src/App.jsx:2195-2199`).
- **Exception handling:** Without the permission cells are disabled, their titles state the status, and a notice names Catalog (`2224`, `2258-2259`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Clicking a cell four times returns it to its starting value. (b) Setting all four marketplaces Live on a SKU increments the fully-listed count. (c) A blocked cell is counted as blocked and raises an urgent alert. (d) The editor is unavailable before Received.
- **Evidence:** `src/App.jsx:2169-2297`, `5871-5882`

#### FR-044 — Work the listing queue across all models
- **Module:** M8 · **Roles:** Admin, Catalog · **Priority:** MUST
- **Trigger:** The user opens Listing.
- **Expected behaviour:** Every SKU on a Received or Live model that is not yet Live everywhere, grouped by model, ordered by urgency, each showing the marketplaces it is missing. Filter chips per marketplace carry outstanding counts. Per model, "Mark all live" sets every pending SKU Live everywhere. With a marketplace filter active, one button sets that marketplace Live on every outstanding SKU across all models. The queue exports to CSV and Excel.
- **Validations:** Cells toggle between Live and Not listed rather than cycling, matching the queue's purpose.
- **Exception handling:** An empty queue shows a confirmation that every SKU in the warehouse is live on all four marketplaces (`src/App.jsx:3907-3918`).
- **Status:** `PARTIAL` — the cross-model marketplace action issues one write per model. See AUD-014.
- **Acceptance criteria:** (a) A SKU live on all four marketplaces disappears from the queue. (b) The per-marketplace counts equal the number of queued SKUs missing that marketplace. (c) "Mark all live" on a model clears all of its queued rows. (d) Model names open the model.
- **Evidence:** `src/App.jsx:3860-4022`

#### FR-045 — Listing completeness gates the move to Live
- **Module:** M8 · **Role:** All · **Priority:** MUST
- **Trigger:** A move from Received to Live is attempted.
- **Expected behaviour:** The move is refused unless every SKU is Live on all four marketplaces, and the refusal names the marketplaces still outstanding.
- **Validations:** `pendingMarketplaces` returns the marketplaces with at least one non-Live SKU (`src/App.jsx:543-546`).
- **Exception handling:** The reason appears on the board card, in the list's status column, on the control's tooltip and as a message on attempted use.
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) One SKU not live on Meesho refuses the move with "Not live on Meesho". (b) Setting it Live allows the move. (c) The same reason appears on every surface that offers the move.
- **Evidence:** `src/App.jsx:530-546`, `3923-3926`

#### FR-046 — The listing nav badge counts pending SKUs
- **Module:** M8 · **Role:** All · **Priority:** COULD
- **Trigger:** The header renders.
- **Expected behaviour:** The Listing tab carries a badge counting the SKUs in the listing queue across non-archived models.
- **Validations:** n/a
- **Exception handling:** Hidden at zero.
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) The badge equals the queue length. (b) Clearing the queue removes the badge.
- **Evidence:** `src/App.jsx:5741`, `6150-6164`

#### FR-047 — Dashboard reports marketplace listing progress
- **Module:** M8 · **Role:** All · **Priority:** SHOULD
- **Trigger:** The dashboard renders with at least one Received or Live model holding SKUs.
- **Expected behaviour:** A per-marketplace progress bar showing live SKUs against total SKUs in play, with blocked counts called out, plus a button into the listing queue carrying the pending count. A KPI card shows fully-listed models against models ready.
- **Validations:** n/a
- **Exception handling:** With nothing in the warehouse, a message states that listing starts once stock arrives (`src/App.jsx:3751-3754`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Each bar's ratio equals live SKUs over all SKUs on Received and Live models. (b) A blocked SKU is named in the marketplace's line. (c) The Fully listed card turns urgent when any model has a blocked SKU.
- **Evidence:** `src/App.jsx:3749-3783`, `3689-3694`

---

### M9 · Sales and stock

#### FR-048 — Log a sale against a live model
- **Module:** M9 · **Roles:** Admin, Sales · **Priority:** MUST
- **Trigger:** The user opens a Live-stage model and completes the sales form.
- **Expected behaviour:** Date (defaulting to today), marketplace, optional SKU, units sold, revenue, returns and a note are captured. Entries accumulate and are never overwritten. Saving appends the entry and records an audit line naming the units and marketplace.
- **Validations:** Units must be greater than zero or the submission is inert (`src/App.jsx:2491`, `2634`); revenue and returns default to zero.
- **Exception handling:** Without `logSales` the form is replaced with "Sales can be logged by the Sales or Admin role." (`2642-2644`).
- **Status:** `PARTIAL` — the handler performs no permission check, unlike the receipt and STP-requirement handlers. See AUD-009.
- **Acceptance criteria:** (a) A zero or blank unit count cannot be submitted. (b) A logged entry appears in the history immediately and reduces stock on hand. (c) A SKU-specific entry reduces that SKU's stock; a non-specific entry reduces only the model total. (d) The form clears its numeric fields after a successful log.
- **Evidence:** `src/App.jsx:2480-2508`, `5994-6003`

#### FR-049 — Derive and display stock on hand per SKU
- **Module:** M9 · **Role:** All (read) · **Priority:** MUST
- **Trigger:** A Live-stage model's detail panel renders.
- **Expected behaviour:** Per SKU: received, sold, returned, on hand, and a bar showing the percentage of received stock remaining, coloured by health, annotated "reorder" below the threshold. Nothing is stored; everything is derived from receipts and sales entries.
- **Validations:** On hand is floored at zero; percentage is zero when nothing was received (`src/App.jsx:189-190`).
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) 30 received, 25 sold, 2 returned gives 7 on hand and 23%. (b) A SKU at or below 20% is marked for reorder and shown in the alert colour. (c) Non-SKU-specific sales do not change any individual SKU's figures.
- **Evidence:** `src/App.jsx:184-205`, `2531-2571`

#### FR-050 — Signal SKUs needing reorder across the business
- **Module:** M9 · **Role:** All · **Priority:** SHOULD
- **Trigger:** The dashboard renders, or a Live model's panel renders.
- **Expected behaviour:** Every SKU at or below 20% of received stock on a live, non-archived model enters a reorder queue sorted most-depleted-first. The count drives a dashboard to-do row, an urgent alert on the model, and the Stock on hand KPI card.
- **Validations:** n/a
- **Exception handling:** n/a
- **Status:** `PARTIAL` — models at Received are excluded, so stock already in the warehouse but not yet listed is never evaluated. See AUD-020.
- **Acceptance criteria:** (a) A live SKU at 20% appears in the queue; one at 21% does not. (b) The dashboard to-do row count equals the queue length. (c) The queue is ordered by remaining percentage ascending.
- **Evidence:** `src/App.jsx:177-214`, `3577`, `3590`, `3705-3710`

#### FR-051 — Summarise sales performance per model
- **Module:** M9 · **Role:** All (read) · **Priority:** SHOULD
- **Trigger:** A Live-stage model's detail panel renders.
- **Expected behaviour:** Totals for units, last 7 days, last 30 days, revenue, and returns with a return rate percentage; a per-marketplace unit breakdown; and the 20 most recent entries newest-first.
- **Validations:** Return rate is zero when no units were sold (`src/App.jsx:268`).
- **Exception handling:** With no entries, a message invites the first log (`2675-2679`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Rolling 7- and 30-day figures count only entries dated within those windows. (b) The return rate equals returns divided by units, to one decimal place. (c) The per-marketplace breakdown sums to the total units. (d) At most 20 history rows are shown.
- **Evidence:** `src/App.jsx:251-270`, `2515-2529`, `2647-2673`

---

### M10 · Dashboard, alerts and navigation

#### FR-052 — Present a prioritised "what needs doing" strip
- **Module:** M10 · **Role:** All · **Priority:** MUST
- **Trigger:** The dashboard renders.
- **Expected behaviour:** Up to nine to-do rows, each shown only when its count is non-zero, each a button that navigates to the relevant view with the matching filter pre-applied: ready to move forward, running behind, launching within 14 days, waiting on SKU codes, ordered with no PO, STP file not sent, delivery not confirmed, SKUs awaiting listing, SKUs low on stock. When all are zero, a single "Everything is on track" line is shown.
- **Validations:** Counts are derived, never stored.
- **Exception handling:** With no models at all, an onboarding panel explains the six stages and offers the Add phone action when permitted (`src/App.jsx:3595-3608`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) A zero-count row is absent, not shown as zero. (b) Pressing "running behind schedule" opens the List view filtered to late models. (c) The "ready for you to move forward" count equals the Needs-my-action chip count for the same role. (d) Rows are keyboard-operable.
- **Evidence:** `src/App.jsx:3579-3591`, `3612-3633`, `5750-5754`

#### FR-053 — Present KPI cards with drill-through and per-card export
- **Module:** M10 · **Role:** All · **Priority:** SHOULD
- **Trigger:** The dashboard renders.
- **Expected behaviour:** Cards for phones tracked, not procuring (only when non-empty), each pipeline stage, units sold, fully listed, running late, launching within 14 days, stock on hand and units in pipeline. Each card carries a sub-line of context and a tone (neutral, good, warning, urgent). Most navigate on click; Planned, Ordered and In production also expose CSV and Excel download buttons for their stage report.
- **Validations:** Download buttons appear only when the stage holds at least one model.
- **Exception handling:** Card clicks and the download buttons do not interfere — the download stops event propagation (`src/App.jsx:3527-3528`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) The Ordered card's sub-line names the count with no PO when any lack one. (b) Pressing the card's CSV button downloads the ordered report without navigating. (c) The Running late card is urgent when non-zero and good when zero. (d) Clickable cards are reachable and operable by keyboard.
- **Evidence:** `src/App.jsx:3517-3537`, `3637-3715`

#### FR-054 — Present the pipeline funnel and segment breakdown
- **Module:** M10 · **Role:** All · **Priority:** COULD
- **Trigger:** The dashboard renders.
- **Expected behaviour:** A bar per stage scaled to the busiest stage, coloured urgent where that stage contains late models, with a tooltip naming the count, units and late count. Un-Procurement earns a row only when something is in it. A second chart breaks the portfolio down by price segment.
- **Validations:** Scale denominators are floored at 1 to avoid division by zero (`src/App.jsx:3571`, `3790`).
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) The pipeline shows six rows when nothing is un-procured and seven when something is. (b) A stage containing a late model shows an urgent bar. (c) Rows navigate to the board and are keyboard-operable.
- **Evidence:** `src/App.jsx:3567-3571`, `3721-3747`, `3785-3806`

#### FR-055 — Present the consolidated alert list
- **Module:** M10 · **Role:** All · **Priority:** MUST
- **Trigger:** The dashboard renders.
- **Expected behaviour:** Every alert from every non-archived model, urgent first, each naming the model, the problem and the stage, each opening that model on click. The heading states the total and the urgent count. The list is capped at 25 with a "+N more" line. With no alerts, a confirmation line is shown instead.
- **Validations:** Alerts come only from `problemsOf`.
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Urgent alerts sort above warnings. (b) Clicking an alert opens the named model's detail panel. (c) With 30 alerts, 25 are listed and "+5 more" is shown. (d) Rows are keyboard-operable.
- **Evidence:** `src/App.jsx:3809-3847`, `342-403`

#### FR-056 — Provide a launch calendar
- **Module:** M10 · **Role:** All · **Priority:** COULD
- **Trigger:** The user opens Calendar.
- **Expected behaviour:** Six months from the current offset, each listing its launches by day with the model name and either its lateness, its readiness to move, or its current stage. A load bar per month is scaled to the busiest month on screen, and a month with four or more launches is flagged as busy. Navigation moves three months at a time with a Today reset. Archived and un-procured models are excluded.
- **Validations:** Models without a launch date are skipped (`src/App.jsx:2954`).
- **Exception handling:** With nothing scheduled, a message invites adding a phone (`2972-2977`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) A month with four launches is outlined as busy and says so. (b) Entries open the model on click or Enter. (c) "Earlier"/"Later" shift by three months and Today returns to the current month. (d) Archived models do not appear.
- **Evidence:** `src/App.jsx:2946-3053`

---

### M11 · Reporting and export

#### FR-057 — Provide nine reports with on-screen preview
- **Module:** M11 · **Role:** All (read) · **Priority:** MUST
- **Trigger:** The user opens Reports.
- **Expected behaviour:** A tab per report — All Phones, Planned, Ordered, Production/STP, STP Requirement, Received, Listing, Late Models, Sales — each showing its row count on the tab, with the active report's rows previewed in a scrollable table and its row count stated.
- **Validations:** Reports are built from non-archived models only.
- **Exception handling:** An empty report shows "No data for this report yet." (`src/App.jsx:5010-5012`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Each tab's count equals the rows shown when it is selected. (b) The Planned report includes a placeholder row for a Planned model with no SKUs. (c) The Late Models report contains exactly the models flagged late. (d) Archived models appear in no report.
- **Evidence:** `src/App.jsx:4856-5017`, `6307`
- **Note:** Tab counts are recomputed for all nine reports on every render. See AUD-022.

#### FR-058 — Download any report as CSV or Excel-compatible file
- **Module:** M11 · **Role:** All (read) · **Priority:** MUST
- **Trigger:** The user presses Download CSV or Download Excel.
- **Expected behaviour:** CSV quotes every cell and doubles embedded quotes; the Excel variant is tab-separated with newlines and tabs collapsed to spaces. A byte-order mark is prepended so non-ASCII characters survive. The file name derives from the report name with spaces replaced.
- **Validations:** Null and undefined cells become empty strings.
- **Exception handling:** The download anchor is attached to the document and the object URL kept alive for two seconds, because Firefox ignores clicks on detached nodes and revoking immediately cancels the transfer (`src/App.jsx:3438-3444`).
- **Status:** `PARTIAL` — the "Excel" file is tab-separated text with an `.xls` extension, which Excel opens with a format-mismatch warning (AUD-035); neither format neutralises spreadsheet formula injection (AUD-006).
- **Acceptance criteria:** (a) A model name containing a comma survives the CSV round trip in one column. (b) Rupee and non-ASCII characters render correctly on open. (c) The download reliably completes in Chrome and Firefox.
- **Evidence:** `src/App.jsx:3438-3468`

#### FR-059 — Provide per-screen exports alongside the Reports view
- **Module:** M11 · **Role:** All (read) · **Priority:** SHOULD
- **Trigger:** The user presses an export control on a working screen.
- **Expected behaviour:** Scoped exports exist for a model's SKU list, its STP statuses, its listing grid, its sales entries, the inward working list, the STP requirement matrix, the catalog listing queue, a single PO, and a draft PO selection.
- **Validations:** n/a
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Each export's row count matches what the screen shows. (b) Draft (unsaved) values are included where the screen shows them, specifically on the inward and listing screens. (c) Every export offers both formats.
- **Evidence:** `src/App.jsx:1908-1911`, `1963-1968`, `2201-2209`, `2503-2508`, `4104-4114`, `4334-4335`, `3897-3905`, `4681-4694`

#### FR-060 — Report content is consistent with the screens it describes
- **Module:** M11 · **Role:** All · **Priority:** SHOULD
- **Trigger:** Any STP requirement report is produced.
- **Expected behaviour:** The STP requirement report produced by the screen, by the Reports tab, and by the server-side email should describe the same rows for the same data.
- **Validations:** None exist — the three code paths are independent.
- **Exception handling:** n/a
- **Status:** **`PARTIAL` — this requirement is currently violated.** The screen export iterates the four hardcoded materials; the Reports tab groups by the material stored on each SKU; the Edge Function groups by the stored material with its own default of `-`. A SKU whose material is off the hardcoded list is omitted from the screen export but present in the other two. See AUD-013.
- **Acceptance criteria:** (a) For a data set containing a SKU with an off-list material, all three outputs contain the same number of rows and the same values. (b) A single shared row-builder is the only implementation.
- **Evidence:** `src/App.jsx:4323-4335` vs `4886-4902` vs `supabase/functions/send-stp-report/index.ts:32-36`

---

### M12 · Import

#### FR-061 — Import phone models from a file or pasted text
- **Module:** M12 · **Roles:** Admin, Procurement, Catalog, Customer Care · **Priority:** SHOULD
- **Trigger:** The user opens Add phone → Import a list.
- **Expected behaviour:** A three-step flow: download a filled-in template, upload or paste rows, review the validated preview and import. Files may be chosen or dropped. Every row is parsed, validated and classified as ready, in error, or already tracked. Duplicates are skipped by default with an opt-out. Importing creates each model at Research with today's research date and an audit line recording the CSV origin.
- **Validations:** Extension must be `.csv`, `.tsv`, `.txt` or `.xls`; size at most 2 MB; brand, model name and a parseable launch date required per row; segment matched case-insensitively against the four values with a Mid Range default (`src/App.jsx:3083-3140`).
- **Exception handling:** A rejected extension explains that `.xlsx` must be saved as CSV first; an oversize file is named as too large; a read failure reports "Could not read that file." Rows in error are previewed greyed out and never imported. The permission is re-checked in the handler.
- **Status:** `PARTIAL` — no cap on row count, and each model is written as a separate request. See AUD-028.
- **Acceptance criteria:** (a) A row with a malformed date is listed with "bad date — use YYYY-MM-DD" and is not imported. (b) `20/07/2026` is accepted and stored as `2026-07-20`. (c) A header row is skipped. (d) With the duplicate skip on, already-tracked rows are excluded from the import count. (e) A value containing a quoted comma stays in one column.
- **Evidence:** `src/App.jsx:3060-3268`, `6065-6087`

#### FR-062 — Report the outcome of an import honestly
- **Module:** M12 · **Role:** All · **Priority:** SHOULD
- **Trigger:** An import completes.
- **Expected behaviour:** Every model's write is awaited. If any fail, the message states how many were imported, how many failed, and the first failure's reason. With no database configured the message states that the import is tab-local.
- **Validations:** n/a
- **Exception handling:** Failures are counted from both errors and conflicts (`src/App.jsx:6082`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) With no database, the message says "in this tab only". (b) A partial failure names the counts and the first reason. (c) A full success names the number imported.
- **Evidence:** `src/App.jsx:6079-6086`

#### FR-063 — Provide a worked import template
- **Module:** M12 · **Role:** All · **Priority:** COULD
- **Trigger:** The user presses a template download button.
- **Expected behaviour:** A file with the four headers and four example rows using launch dates relative to today, in CSV or Excel-compatible format.
- **Validations:** n/a
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Both template buttons produce a file without error. (b) The template's own rows import cleanly with no validation errors.
- **Evidence:** `src/App.jsx:3066-3080`

---

### M13 · Notes, attachments and audit trail

#### FR-064 — Post and remove notes on a model
- **Module:** M13 · **Role:** Any signed-in role · **Priority:** SHOULD
- **Trigger:** The user opens a model's Notes tab.
- **Expected behaviour:** A text area with a Post control; Ctrl/Cmd+Enter also posts. Notes list newest-first with the author's name, role label and a relative timestamp, and each can be deleted. Posting records an audit line.
- **Validations:** Blank or whitespace-only notes cannot be posted (`src/App.jsx:2362`); the stored text is trimmed (`165`).
- **Exception handling:** Deleting a note does not write an audit entry (`6025-6032`).
- **Status:** `PARTIAL` — note writing is gated only on being signed in (`canWrite={role !== "none"}`), so every role including Customer Care and Sales can post and delete notes on any model; the handler performs no permission check. See AUD-009.
- **Acceptance criteria:** (a) An empty note cannot be posted. (b) A posted note shows the author's name and role. (c) Timestamps render as "just now", minutes, hours or a date. (d) Deleting removes the note immediately.
- **Evidence:** `src/App.jsx:2347-2391`, `6014-6032`, `2842`

#### FR-065 — Attach reference links to a model
- **Module:** M13 · **Role:** Any signed-in role · **Priority:** COULD
- **Trigger:** The user opens a model's Files tab.
- **Expected behaviour:** A label, a type from five options (PO document, Invoice, STP file, QC photo, Other) and a URL are captured. The application stores the link, not the file, and says so. Links list newest-first with their type, author and relative time, open in a new tab, and can be removed. Attaching records an audit line naming the type and label.
- **Validations:** Both label and URL must be non-blank (`src/App.jsx:2324`); both are trimmed.
- **Exception handling:** None for the URL itself.
- **Status:** `PARTIAL` — **the URL scheme is not validated**, so a `javascript:` or `data:` URL can be stored and rendered as a link. `rel="noopener noreferrer"` and `target="_blank"` are set. See AUD-006.
- **Acceptance criteria:** (a) A link with no label cannot be attached. (b) An attached link opens in a new tab and does not expose the opener. (c) Only `http:` and `https:` URLs are accepted *(this criterion is currently not met)*.
- **Evidence:** `src/App.jsx:168-175`, `2323-2327`, `2393-2449`, `6034-6052`

#### FR-066 — Maintain a per-model audit trail
- **Module:** M13 · **Role:** System · **Priority:** MUST
- **Trigger:** Any mutating action on a model.
- **Expected behaviour:** One entry per write recording the timestamp, the author's name, their role and a description of the action. The History tab lists them newest-first in a scrollable pane. The trail is capped at 200 entries, keeping the most recent.
- **Validations:** An unknown author records "Unknown" and role "none" (`src/App.jsx:150-151`).
- **Exception handling:** n/a
- **Status:** `PARTIAL` — note and attachment deletions write no entry, and the 200-entry cap silently discards the oldest history. See AUD-024.
- **Acceptance criteria:** (a) A stage move, SKU save, PO change, STP update, receipt, listing change, sale and archive each produce a named entry. (b) Entries show who, when and what. (c) The 201st entry removes the first.
- **Evidence:** `src/App.jsx:142-158`, `2452-2469`

#### FR-067 — Record the audit author from the active session
- **Module:** M13 · **Role:** System · **Priority:** SHOULD
- **Trigger:** Any audit or note entry is created.
- **Expected behaviour:** The display name is taken up to the role suffix in brackets, and the role key is recorded alongside it.
- **Validations:** n/a
- **Exception handling:** A missing session yields "Unknown" / "none".
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) "Priya (Procurement)" records as author "Priya" with role `procurement`. (b) The History tab renders the role's label, not its key.
- **Evidence:** `src/App.jsx:147-166`, `2375`

---

### M14 · Persistence, concurrency and synchronisation

#### FR-068 — Persist every change to Supabase through a single write path
- **Module:** M14 · **Role:** System · **Priority:** MUST
- **Trigger:** Any mutating handler.
- **Expected behaviour:** Local state is updated first, then the affected model is persisted. Writes to one model are serialised in a per-model queue. A successful write adopts the fresh version stamp for the next save. Outstanding writes are counted.
- **Validations:** With no database the write path is a resolved no-op (`src/App.jsx:5659`).
- **Exception handling:** Thrown errors are caught and reported as a message; the outstanding count decrements in all cases (`5690-5693`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Two rapid edits to one model produce two sequential writes, not two concurrent ones. (b) An error is reported and does not leave the outstanding count stuck. (c) With no database nothing is written and the user is told the work is tab-local.
- **Evidence:** `src/App.jsx:5658-5695`

#### FR-069 — Refuse a save that would overwrite a newer version
- **Module:** M14 · **Role:** System · **Priority:** MUST
- **Trigger:** A save on a model whose version stamp is known.
- **Expected behaviour:** The update is sent as a compare-and-swap filtered on the known `updated_at`. A zero-row result means another browser saved first: the local edit is kept, the model is marked conflicted, and the user is told to refresh before editing it again.
- **Validations:** The version stamp is URL-encoded before use (`src/App.jsx:832`).
- **Exception handling:** Every later edit to a conflicted model reports that it was not saved, each time.
- **Status:** `IMPLEMENTED-UNVERIFIED` — the mechanism is traced end to end through `src/App.jsx`, `schema.sql` and `schema-phase3.sql`, but **no two-browser concurrency test was executed**. See §20.
- **Acceptance criteria:** (a) Saving a model edited elsewhere since load does not overwrite the other edit. (b) The local edit is retained on screen rather than discarded. (c) A banner states how many models need a refresh. (d) The header status dot turns urgent.
- **Evidence:** `src/App.jsx:828-837`, `5673-5683`, `6168-6179`, `6264-6273`; `schema.sql:48-58`; `schema-phase3.sql`

#### FR-070 — Create a model with an insert, never an upsert
- **Module:** M14 · **Role:** System · **Priority:** MUST
- **Trigger:** A save on a model with no known version stamp.
- **Expected behaviour:** A plain insert is issued. A duplicate-key failure is reported as a conflict rather than merged, because merge-on-conflict would silently overwrite a row this browser never read. On success the fresh version stamp is read back.
- **Validations:** The duplicate is recognised from the message or SQL state `23505` (`src/App.jsx:820`).
- **Exception handling:** Any other error is returned unchanged.
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) Creating a model whose id already exists reports a conflict and overwrites nothing. (b) A successful create ends with a usable version stamp for the next save.
- **Evidence:** `src/App.jsx:811-827`

#### FR-071 — Re-read the database on refocus and on a timer
- **Module:** M14 · **Role:** System · **Priority:** MUST
- **Trigger:** The tab regains focus, or 90 seconds elapse while it is visible.
- **Expected behaviour:** Users, models and role permissions are re-read in parallel. A hidden tab and an in-flight read are both skipped, so two reads cannot stack.
- **Validations:** `document.hidden` and an in-flight flag are both checked (`src/App.jsx:5633`).
- **Exception handling:** A read error sets the offline state and surfaces the message; the loading flags clear either way.
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) A change made in another browser appears within 90 seconds, or immediately on refocus. (b) Refocusing during a read does not start a second one. (c) A background tab does not poll.
- **Evidence:** `src/App.jsx:5575-5639`

#### FR-072 — Never replace local work during a background re-read
- **Module:** M14 · **Role:** System · **Priority:** MUST
- **Trigger:** A background re-read, either before it starts or after its response arrives.
- **Expected behaviour:** If a detail panel is open or any model is conflicted, the background read is abandoned without applying its result — checked both before the request and again after it returns, because the user may have opened an editor while it was in flight. Manual refresh remains the explicit discard-and-reload path.
- **Validations:** Open-panel and conflict state are read through refs so the check sees current values (`src/App.jsx:5570-5572`, `5577-5578`).
- **Exception handling:** n/a
- **Status:** `PARTIAL` — protects the detail panel and conflicted models only. Unsaved drafts on the Inward, STP requirement and PO builder screens are not protected. See AUD-016.
- **Acceptance criteria:** (a) With a detail panel open, a 90-second tick does not change the data behind it. (b) Opening a panel mid-request still prevents the response being applied. (c) Pressing refresh does replace the data.
- **Evidence:** `src/App.jsx:5575-5620`

#### FR-073 — Bound every request and surface a real error
- **Module:** M14 · **Role:** System · **Priority:** MUST
- **Trigger:** Any database request.
- **Expected behaviour:** Each request is aborted after 12 seconds and reported as "Database did not respond within 12s". A non-JSON response body does not mask the real HTTP status. The boot screen offers a way to continue offline after 4 seconds.
- **Validations:** The abort is distinguished from other failures by its name (`src/App.jsx:753`).
- **Exception handling:** A failed first read drops the user onto the login screen with a warning rather than stranding them on a spinner (`5615-5619`).
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) An unreachable host produces an error within about 12 seconds, not an indefinite wait. (b) An HTML error page from a proxy reports the HTTP status, not a JSON parse error. (c) The boot screen offers "continue offline" after a few seconds. (d) The timeout is cleared on every path.
- **Evidence:** `src/App.jsx:665-666`, `731-757`, `3353-3380`, `6117`

#### FR-074 — State the persistence situation honestly at all times
- **Module:** M14 · **Role:** All · **Priority:** MUST
- **Trigger:** Continuously.
- **Expected behaviour:** A header status indicator shows synced with a timestamp, syncing, local-only, or refresh-required, with a tooltip explaining each. A full-width banner appears when no database is connected, stating plainly that changes stay in the tab and are lost on refresh. A second banner names the number of models needing a refresh. Background syncing shows a small non-blocking corner indicator, never a blocking overlay. Success messages only claim a save after the write completes.
- **Validations:** n/a
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) With no database, the banner is visible and every save message says the work is tab-local. (b) A background sync does not block interaction. (c) A conflicted model produces the refresh-required banner and an urgent status dot. (d) The first load shows a boot screen, later loads do not.
- **Evidence:** `src/App.jsx:5551-5557`, `6166-6196`, `6247-6273`, `6325-6338`, `5706-5724`

---

### M15 · STP report email approval

#### FR-075 — Issue a short-lived approval code to configured approvers
- **Module:** M15 · **Role:** Server · **Priority:** MUST
- **Trigger:** A POST to `request-stp-report-approval` from the configured origin.
- **Expected behaviour:** An 8-character code from an unambiguous alphabet is generated, hashed with a server-side pepper together with a fresh approval id, and stored with a 10-minute expiry alongside a hashed request IP. The code is emailed to the configured approvers with an idempotency key. The approval id and expiry are returned; the code is not.
- **Validations:** All seven required environment values must be present or the function returns 500 without acting. The request origin must match exactly. Only POST is accepted. Configured addresses are de-duplicated, pattern-checked and capped at 10.
- **Exception handling:** Exceeding 3 requests per hour from one IP returns 429 with a wait message. A failed approval email deletes the pending row and returns 502.
- **Status:** `IMPLEMENTED-UNVERIFIED` — no deployment was available. See §20.
- **Acceptance criteria:** (a) The approver receives an 8-character code. (b) A fourth request within an hour from the same IP is refused. (c) The response never contains the code. (d) A missing environment secret produces 500 and no email.
- **Evidence:** `supabase/functions/request-stp-report-approval/index.ts`; `schema-report-approval.sql:36-50`

#### FR-076 — Consume an approval exactly once and send a fixed report
- **Module:** M15 · **Role:** Server · **Priority:** MUST
- **Trigger:** A POST to `send-stp-report` with an approval id and code.
- **Expected behaviour:** The id and code are shape-checked, the code is re-hashed and the approval claimed under a row lock. A valid claim marks the approval consumed. The report is then built server-side from models at Ordered and Production, grouped by model and material, capped at 500 rows, and emailed as an HTML table plus a CSV attachment to the configured recipients with an idempotency key. The attempt is logged with its outcome.
- **Validations:** Id must match a 36-character UUID shape; code must match the 8-character alphabet. The claim rejects a consumed, expired or 5-times-failed approval, and increments the attempt count on a wrong code.
- **Exception handling:** An invalid body, id or code returns 400/403 without touching the database beyond the claim. A build failure returns 502. An empty report returns 422. A provider failure marks the log row failed and returns 502.
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) A correct code sends exactly one email to the configured recipients. (b) Re-using the code fails and sends nothing. (c) Five wrong codes invalidate the approval. (d) The log row records `sent` with a provider id, or `failed` with the status.
- **Evidence:** `supabase/functions/send-stp-report/index.ts`; `schema-report-approval.sql:52-69`
- **Note:** The approval is marked consumed before the email is attempted, so a provider failure burns the code and a new one must be requested. See AUD-029.

#### FR-077 — Keep approval data unreachable from the browser
- **Module:** M15 · **Role:** Server · **Priority:** MUST
- **Trigger:** Schema deployment.
- **Expected behaviour:** Both approval tables have row-level security enabled, all privileges revoked from the anonymous and authenticated roles, and their two functions executable only by `service_role`. The setup guide states explicitly that anonymous policies must not be added.
- **Validations:** Declared in SQL.
- **Exception handling:** n/a
- **Status:** `IMPLEMENTED-UNVERIFIED` — the SQL is correct as written; **no deployed database was available to confirm it was applied**.
- **Acceptance criteria:** (a) A browser request for `report_approvals` with the anonymous key is refused. (b) The same for `report_send_log`. (c) Neither function is callable with the anonymous key.
- **Evidence:** `schema-report-approval.sql:31-34`, `71-74`; `REPORT-EMAIL-SETUP.md:8-10`, `51`

#### FR-078 — No browser input influences recipients, content or data
- **Module:** M15 · **Role:** Server · **Priority:** MUST
- **Trigger:** Any send.
- **Expected behaviour:** Recipients, sender and report scope come entirely from server environment configuration and a fixed query. The only values the browser supplies are the approval id and the code. HTML cells are escaped and CSV cells are quoted when they contain a delimiter or quote.
- **Validations:** Addresses are pattern-checked and capped at 25 recipients.
- **Exception handling:** n/a
- **Status:** `PARTIAL` — recipient and content control is correctly server-side, but the CSV attachment does not neutralise spreadsheet formula injection. See AUD-006.
- **Acceptance criteria:** (a) Adding a recipient field to the request body has no effect. (b) A model name containing HTML is escaped in the email body. (c) A model name beginning `=` is not evaluated as a formula when the attachment is opened *(this criterion is currently not met)*.
- **Evidence:** `supabase/functions/send-stp-report/index.ts:7-9`, `17`, `29`, `38-40`

---

### M16 · Configuration and deployment

#### FR-079 — Configure the database connection from the application
- **Module:** M16 · **Role:** Admin only · **Priority:** MUST
- **Trigger:** No connection is configured, or Admin presses the configure control.
- **Expected behaviour:** A dedicated screen accepts the project URL and anonymous key, tests the connection before accepting it, and stores a working pair in this browser's local storage. Setup steps are listed. A skip option continues with local memory only, stating that data will not be saved.
- **Validations:** Both fields must be non-blank before the test is offered; the URL has a trailing slash stripped; the test performs a real request and the configuration is cleared again if it fails (`src/App.jsx:5270-5277`).
- **Exception handling:** A failed test shows the server's message or a generic hint. The save control appears only after a successful test.
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) A wrong key fails the test and is not stored. (b) A successful test enables Save and continue, which loads the data. (c) The screen is reachable only by a role holding the reset permission.
- **Evidence:** `src/App.jsx:5264-5346`, `6104-6109`

#### FR-080 — Accept a build-time database configuration
- **Module:** M16 · **Role:** System · **Priority:** MUST
- **Trigger:** Application start.
- **Expected behaviour:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` baked in at build time provide a working connection for every visitor without touching the setup screen. A configuration saved in the browser takes precedence, so one machine can be pointed elsewhere.
- **Validations:** Both values are trimmed and a trailing slash stripped; both must be non-empty to be used.
- **Exception handling:** Unreadable local storage falls through to the build-time values.
- **Status:** `IMPLEMENTED-UNVERIFIED`
- **Acceptance criteria:** (a) With both variables set at build time, a fresh browser connects with no setup. (b) A locally saved configuration overrides them. (c) With neither available, an admin reaches the setup screen and others reach the local-only banner.
- **Evidence:** `src/App.jsx:668-687`; `README.md` "Connect Supabase"

#### FR-081 — Provide the database schema as runnable migrations
- **Module:** M16 · **Role:** Admin / operator · **Priority:** MUST
- **Trigger:** Initial setup, or an upgrade of an existing project.
- **Expected behaviour:** `schema.sql` creates everything from scratch. `schema-compatibility.sql`, `schema-phase3.sql`, `schema-roles.sql` and `schema-report-approval.sql` are additive migrations for an existing project that do not delete data. Each states what it does and whether it is safe to re-run.
- **Validations:** Additive scripts use `if not exists` / `add column if not exists` and re-create triggers idempotently.
- **Exception handling:** `schema.sql` **drops its tables before recreating them** and is explicitly flagged as unsafe against a populated database.
- **Status:** `PARTIAL` — the destructive behaviour is warned about in `README.md` but **not** on the in-application setup screen, which instructs the operator to run `schema.sql`. See AUD-030. `REPORT-EMAIL-SETUP.md` also instructs the operator to run a file that does not exist in the repository.
- **Acceptance criteria:** (a) Each additive migration can be run twice with no error and no data loss. (b) The setup screen warns before telling an operator to run a destructive script *(this criterion is currently not met)*. (c) Every migration referenced in documentation exists in the repository *(this criterion is currently not met)*.
- **Evidence:** `schema.sql:8-11`, `83-101`; `schema-compatibility.sql`; `schema-phase3.sql`; `schema-roles.sql:1-15`; `schema-report-approval.sql`; `src/App.jsx:5332-5338`; `REPORT-EMAIL-SETUP.md:7`

#### FR-082 — Build and deploy the application
- **Module:** M16 · **Role:** Maintainer · **Priority:** MUST
- **Trigger:** A release.
- **Expected behaviour (documented):** Pushing to `main` runs a GitHub Actions workflow that builds `dist/` and publishes it to GitHub Pages, with the Supabase URL and key supplied as repository secrets.
- **Validations:** Relative asset paths via `base: "./"` so the app works from a project subpath.
- **Exception handling:** n/a
- **Status:** **`DOCUMENTED-NOT-FOUND`** — `npm run build` works and was executed successfully during this audit, but **no `.github/` directory exists in the repository**, so the described workflow is not present. See AUD-007.
- **Acceptance criteria:** (a) `npm run build` produces a working `dist/` *(met — verified)*. (b) A committed workflow file builds and publishes on push to `main` *(not met)*. (c) The workflow also runs `npm run check` *(not met)*.
- **Evidence:** `README.md` "Deploy"; `vite.config.js`; `package.json:5-9`; absence of `.github/`

#### FR-083 — Deploy the Edge Functions with the documented gateway setting
- **Module:** M16 · **Role:** Maintainer · **Priority:** MUST
- **Trigger:** Edge Function deployment.
- **Expected behaviour:** Both functions are deployed with the platform JWT gateway deliberately disabled, so a browser CORS preflight can reach their handlers; each handler performs its own approval checks on every send. Seven secrets must be configured.
- **Validations:** `supabase/config.toml` disables `verify_jwt` for exactly those two functions.
- **Exception handling:** A missing secret makes the function return 500 without acting.
- **Status:** `IMPLEMENTED-UNVERIFIED` — configuration and commands are documented and committed; no deployment was performed or observed.
- **Acceptance criteria:** (a) Both functions respond to a browser preflight from the configured origin. (b) A request from any other origin is refused with 403. (c) Neither function acts when a secret is missing.
- **Evidence:** `supabase/config.toml`; `REPORT-EMAIL-SETUP.md:29-38`; `request-stp-report-approval/index.ts:40-43`

---

### M17 · Recommended additions (none implemented)

Everything in this module is a **proposal arising from this audit**. None of it
exists in the evidence baseline.

| ID | Recommended requirement | Rationale / finding closed | Priority |
| --- | --- | --- | --- |
| FR-R01 | Replace the PIN login with Supabase Auth, and carry the role as an authenticated claim. | AUD-001, AUD-005 | `MUST` |
| FR-R02 | Enforce every write permission in Postgres row-level security, keyed on the authenticated user's role, so the browser ceases to be the security boundary. | AUD-002, AUD-003, AUD-009, AUD-010 | `MUST` |
| FR-R03 | Commit the documented GitHub Actions workflow, running `npm run build` and `npm run check` on every push. | AUD-007 | `MUST` |
| FR-R04 | Add a confirmation step and an explicit destructive warning wherever an operator is instructed to run `schema.sql`, and remove references to migrations that do not exist. | AUD-030, AUD-007 | `MUST` |
| FR-R05 | Provide one shared STP requirement row-builder used by the screen export, the Reports tab and the Edge Function; drive the requirement matrix columns from the materials actually present on the SKUs. | AUD-013 | `MUST` |
| FR-R06 | Prevent the removal or re-roling of the last administrator, and allow a stored admin permission row to be repaired from the matrix. | AUD-011, AUD-010 | `MUST` |
| FR-R07 | Validate attachment URLs against an `http:`/`https:` allow-list, and prefix exported cells beginning `= + - @` so spreadsheets do not evaluate them. | AUD-006 | `SHOULD` |
| FR-R08 | Add unit tests for `gateBlock`, `moveStatus`, `plannedDate`, `delayOf`, `runwayOf`, `stockOfSku`, `stockOfModel`, `salesSummary`, `problemsOf`, the CSV `splitRow` parser and every report builder, following the existing self-check pattern. | AUD-021 | `MUST` |
| FR-R09 | Batch bulk operations into one write and one message per action rather than one per model. | AUD-014 | `SHOULD` |
| FR-R10 | Promote SKUs and sales entries from JSONB arrays to child tables so a write touches only the row that changed. | AUD-004, AUD-012, AUD-018, AUD-024 | `SHOULD` |
| FR-R11 | Allow a completion date to be edited, with an audit entry, so historical models can be backfilled truthfully. | AUD-025, OQ-07 | `SHOULD` |
| FR-R12 | Move marketplaces, materials, the reorder threshold and the stage schedule into a configuration table, following the `role_permissions` precedent. | AUD-019 | `COULD` |
| FR-R13 | Recompute the module-scope "today" value on focus or at midnight so a tab left open overnight does not stamp yesterday's date. | AUD-031 | `SHOULD` |
| FR-R14 | Make the STP requirement matrix cells keyboard-operable, and provide a keyboard path for backward stage moves. | AUD-015 | `SHOULD` |
| FR-R15 | Cap import row counts and batch the writes; report progress for large imports. | AUD-028 | `COULD` |
| FR-R16 | Add error reporting and a conflict log so concurrency problems and failures are observable rather than only visible to the user who hit them. | AUD-026 | `SHOULD` |

---

## 8. User journeys and workflows

### 8.1 The primary journey — a phone from discovery to selling

```
                         ┌──────────────────────────────────────────────┐
                         │  Launch date is set by the phone maker.      │
                         │  Every milestone below counts back from it.  │
                         └──────────────────────────────────────────────┘

  RESEARCH  ──100d──▶  PLANNED  ──85d──▶  ORDERED  ──75d──▶  PRODUCTION
  Procurement          Procurement        Procurement        Warehouse
  /Catalog             SKUs + materials   PO number           STP status
  /Customer Care       + quantities        assigned            per SKU
      │                     │                  │                  │
      │  gate: none    gate: ≥1 SKU,     gate: PO number    gate: ≥1 SKU, no
      │                 all coded          recorded          required STP
      │                                                      rejected or unsent
      │                                                            │
      ▼                                                            ▼
  UN-PROCUREMENT ◀── decision not to buy                      RECEIVED ──25d
  (terminal; record kept,                                     Catalog
   no deadlines, no alerts)                                   qty per SKU
                                                                   │
                                                        gate: every SKU
                                                        confirmed AND live
                                                        on all 4 marketplaces
                                                                   │
                                                                   ▼
                                                              LIVE ──0d
                                                              Catalog + Sales
                                                              listings + sales
                                                                   │
                                                        stock ≤20% ──▶ reorder
```

### 8.2 Journey UJ-01 — Procurement officer brings a new phone to order

| Step | Actor | Screen | Action | System response | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Procurement | Header | Press Add phone | Add panel opens, brand field focused | `src/App.jsx:3366`, `6236` |
| 2 | Procurement | Add panel | Enter brand, model, launch date, segment | Launch-date hint states whether the runway is comfortable, tight, or already past; a duplicate raises a non-blocking warning naming the existing model | `3306-3317`, `3390-3401` |
| 3 | Procurement | Add panel | Save | Model created at Research with today's research date; detail panel opens; message confirms tracking | `3325-3337`, `6089-6101` |
| 4 | Procurement | Detail | Press Move to Planned | No data gate at Research; model advances; planned date stamped | `503-540`, `5785` |
| 5 | Procurement | Detail | Add SKUs, choose materials, adjust units; or bulk-paste a list | Material default fills units unless overridden; blank codes are outlined and counted | `1715-1863` |
| 6 | Procurement | Detail | Save SKUs | SKUs stored; audit line records the count; empty rows discarded | `1750-1754`, `5832-5839` |
| 7 | Procurement | Detail | Press Move to Ordered | Refused while any SKU code is blank, naming the count; otherwise advances | `504-508` |
| 8 | Procurement | Orders | Tick this model and others, type the PO number, assign | One PO written to every selected model, each with its own audit line | `4651-4788`, `5959-5966` |
| 9 | Procurement | Detail | Export the SKU sheet for the supplier | CSV or Excel file named for brand and model | `1907-1945` |
| 10 | Procurement | Detail | Press Move to Production | Refused without a PO; otherwise advances and the model leaves Procurement's queue | `511-512` |

### 8.3 Journey UJ-02 — Catalog decides what paperwork the factory owes

| Step | Actor | Screen | Action | System response | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Catalog | Inward → STP requirement | Open the matrix | Models at Ordered and Production listed against the four materials; required and undecided counts shown | `src/App.jsx:4293-4295`, `4362-4363` |
| 2 | Catalog | Matrix | Click a cell | Every SKU of that material in that model cycles to Required; audit line records the SKU count | `4310-4313`, `5854-5869` |
| 3 | Catalog | Matrix | Press "Req" on a material column | That decision is applied to every listed model — **one write per model** | `4316-4317`; AUD-014 |
| 4 | Catalog | Matrix | Press "Email MD / Factory" | An approval code is emailed to the configured approver; the code-entry panel appears | `4444-4451` |
| 5 | Approver | Email | Read the 8-character code and pass it to the requester | Code valid for 10 minutes, one use, 5 attempts | `schema-report-approval.sql:48`, `59-67` |
| 6 | Catalog | Matrix | Enter the code and send | Server builds the report from Ordered and Production models and emails the configured recipients; the attempt is logged | `send-stp-report/index.ts` |

> **Known gap.** Steps 1–3 only present materials from the hardcoded list. A SKU
> whose material was set by bulk paste to anything else never appears, yet it
> *does* appear in the email of step 6 — so the two disagree. See AUD-013.

### 8.4 Journey UJ-03 — Warehouse chases the supplier

| Step | Actor | Screen | Action | System response | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Warehouse | Board / Dashboard | Filter to "Needs my action", or open the "STP file not sent yet" to-do row | Only models Warehouse can actually advance are listed | `src/App.jsx:649`, `3587` |
| 2 | Warehouse | Detail (Production) | Review the SKU table | Each SKU shows its requirement (read-only here) and its editable status | `1952-2042` |
| 3 | Warehouse | Detail | Set statuses, or use "Set all" | Draft updates; completed, rejected and not-sent counts update | `1960`, `1970` |
| 4 | Warehouse | Detail | Save STP status | Statuses stored; audit line written | `5843-5852` |
| 5 | Warehouse | Detail | Export the STP sheet | File carries brand, model, PO, SKU, material, units, requirement and status | `1963-1968` |
| 6 | Warehouse | — | Attempt to move to Received | **Refused** — Warehouse does not own the Received stage; the message names the role | `473`, `610-611` |

### 8.5 Journey UJ-04 — Catalog books a shipment in and takes it live

| Step | Actor | Screen | Action | System response | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Catalog | Inward → Inward stock | Open the screen | Every SKU on every model at Ordered, Production or Received, urgency-ordered, with ordered-versus-received totals | `src/App.jsx:4048-4050`, `4133-4144` |
| 2 | Catalog | Inward | Type received quantities, or use the bulk controls | Receipt state is derived from the quantity; edited rows are highlighted and counted as unsaved | `4056-4070`, `4157` |
| 3 | Catalog | Inward | Press Save changes | One write per affected model through the normal optimistic-lock path | `4074-4083` |
| 4 | Catalog | Inward | Tick ready models and press Inward selected | Only Production models passing the gate are offered; refused while any receipt edit is unsaved | `4092-4102`, `4174` |
| 5 | Catalog | Detail (Received) | Open the listing grid | SKUs against four marketplaces, each cell cycling on click | `2169-2297` |
| 6 | Catalog | Listing | Work the queue; filter by marketplace; bulk-mark live | Queue shows the exact marketplaces each SKU is missing | `3860-4022` |
| 7 | Catalog | Detail / Board | Move to Live | Refused until every SKU is confirmed and live everywhere, naming the outstanding marketplaces | `530-538` |

### 8.6 Journey UJ-05 — Sales records performance and triggers a reorder

| Step | Actor | Screen | Action | System response | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Sales | Detail (Live) | Review the KPI row and stock table | Totals, rolling 7- and 30-day units, revenue, returns and per-SKU stock on hand | `src/App.jsx:2515-2571` |
| 2 | Sales | Detail | Log a sale: date, marketplace, SKU, units, revenue, returns, note | Entry appended, never overwritten; stock on hand recalculated immediately | `2490-2501`, `5994-6003` |
| 3 | System | — | Stock falls to 20% or below | SKU enters the reorder queue; model raises a low-stock alert; dashboard to-do row and Stock on hand card update | `178`, `208-214`, `389-393` |
| 4 | Procurement | Dashboard | Open the "SKUs low on stock" row | Navigates to the board for the reorder decision | `3590` |
| 5 | Procurement | — | Decide to reorder | **No in-application reorder action exists** — the next order is raised as a new PO on the existing model, or as a new model | AUD-020 |

### 8.7 Journey UJ-06 — Two people edit one model at the same time

| Step | Actor | Action | System response | Evidence |
| --- | --- | --- | --- | --- |
| 1 | User A | Opens model 42; the version stamp is read | Stamp held in the per-model write state | `src/App.jsx:5662-5665` |
| 2 | User B | Opens model 42 in another browser | Same stamp held independently | — |
| 3 | User A | Saves a SKU change | Compare-and-swap succeeds; the trigger issues a new stamp; A adopts it | `830-837`, `5685-5688`; `schema.sql:52-58` |
| 4 | User B | Saves a PO change | Compare-and-swap matches **zero rows**; A's change is not overwritten | `834-836` |
| 5 | System | — | Model 42 marked conflicted; B's local edit retained on screen; message asks B to refresh; banner and urgent status dot shown | `5677-5683`, `6168-6179`, `6264-6273` |
| 6 | User B | Edits again without refreshing | Every further edit is local-only and says so each time | `5667-5672` |
| 7 | User B | Presses refresh | Full re-read; conflict state cleared; B's unsaved work is discarded | `5611-5613` |

> **Audit note.** This journey is traced through the code, SQL and trigger
> definitions. It was **not executed** — no Supabase project was available. See
> §20 and AUD-008.

### 8.8 Status transition table

| From | To | Allowed roles (default) | Data gate | Date effect |
| --- | --- | --- | --- | --- |
| Research | Planned | Admin, Procurement | none | stamps research + planned |
| Research | Un-Procurement | Admin, Procurement | none | stamps nothing |
| Planned | Ordered | Admin, Procurement | ≥1 SKU; every SKU coded | stamps up to ordered |
| Ordered | Production | Admin, Procurement, Warehouse, Catalog | PO number present | stamps up to production |
| Production | Received | Admin, Catalog | ≥1 SKU; no required STP rejected; no required STP unsent | stamps up to received |
| Received | Live | Admin, Catalog | ≥1 SKU; every SKU confirmed; every SKU live on all 4 marketplaces | stamps up to live |
| Un-Procurement | Research | Admin, Procurement | none | keeps existing dates |
| any | one stage back | role must own the target stage | none | deletes later dates |
| any | two or more stages forward | — | **never permitted** | — |
| Planned…Live | Un-Procurement | — | **never permitted** | — |

### 8.9 Approval points

| Approval | Who approves | What it gates | Mechanism | Status |
| --- | --- | --- | --- | --- |
| Decision to procure | Procurement / Admin | Research → Planned | Implicit in the stage move; no separate record | `IMPLEMENTED-UNVERIFIED` |
| Decision not to procure | Procurement / Admin | Research → Un-Procurement | Explicit "Not procuring" action with an audit entry | `IMPLEMENTED-UNVERIFIED` |
| Whether an STP file is owed | Catalog / Admin | Production → Received, for SKUs marked required | Tri-state matrix decision | `IMPLEMENTED-UNVERIFIED` |
| Release of the STP report by email | Configured approver (holds the mailbox) | The email send | Server-issued one-time 8-character code | `IMPLEMENTED-UNVERIFIED` |
| Goods accepted | Catalog / Admin | Received → Live | Per-SKU receipt confirmation | `IMPLEMENTED-UNVERIFIED` |
| Permission changes | Admin | All permissions | Admin matrix, with Manage users and DB/reset locked | `IMPLEMENTED-VERIFIED` (lock mechanism) |

`[CLARIFICATION]` There is **no spend approval, no budget authority check and no
value threshold** anywhere in the application. A PO of any size can be raised by
anyone holding `savePO`. If a financial approval is required by the business, it
is not represented here. See OQ-02.

---

## 9. Role and permission matrix

### 9.1 Permission matrix (shipped defaults)

`✔` = granted. `—` = withheld. `🔒` = permanently locked to Admin.

| Permission | Admin | Procurement | Warehouse | Catalog | Sales | Customer Care |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Add phone | ✔ | ✔ | — | ✔ | — | ✔ |
| Archive | ✔ | ✔ | — | — | — | — |
| Edit research | ✔ | ✔ | — | — | — | — |
| Edit SKUs | ✔ | ✔ | — | — | — | — |
| Save PO | ✔ | ✔ | — | — | — | — |
| STP status | ✔ | — | ✔ | — | — | — |
| STP required | ✔ | — | — | ✔ | — | — |
| Goods receipt | ✔ | — | — | ✔ | — | — |
| Listings | ✔ | — | — | ✔ | — | — |
| Log sales | ✔ | — | — | — | ✔ | — |
| Manage users | ✔ 🔒 | — | — | — | — | — |
| DB / reset | ✔ 🔒 | — | — | — | — | — |

**Evidence:** `src/roles.js:35-51`; `schema-roles.sql:52-82`. The matrix is
editable by Admin at runtime; the table above is the shipped default and the
offline fallback.

### 9.2 Stage ownership matrix (which stages a role may move work into)

| Stage | Admin | Procurement | Warehouse | Catalog | Sales | Customer Care |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Research | ✔ | ✔ | — | — | — | — |
| Planned | ✔ | ✔ | — | — | — | — |
| Ordered | ✔ | ✔ | — | — | — | — |
| Production | ✔ | ✔ | ✔ | ✔ | — | — |
| Received | ✔ | — | — | ✔ | — | — |
| Live | ✔ | — | — | ✔ | — | — |
| Un-Procurement | ✔ | ✔ | — | — | — | — |

**Evidence:** `src/App.jsx:466-481`; `schema-roles.sql:52-78`. Admin's row is
forced to every stage on load whatever the stored value (`src/roles.js:76`).

### 9.3 Screen access matrix

All eight views are reachable by every signed-in role; what differs is whether
the controls on them are editable. There is no per-view access control.

| View | Admin | Procurement | Warehouse | Catalog | Sales | Customer Care |
| --- | --- | --- | --- | --- | --- | --- |
| Dashboard | read | read | read | read | read | read |
| Board | full | move own stages | move Production | move Production/Received/Live | read | read |
| List | full | move own stages | move Production | move own stages | read | read |
| Calendar | read | read | read | read | read | read |
| Orders | full | build + assign POs; receive | read | receive | read | read |
| Inward | full | read | read | book in + decide STP | read | read |
| Listing | full | read | read | full | read | read |
| Reports | read + export | read + export | read + export | read + export | read + export | read + export |
| Users (modal) | full | — | — | — | — | — |
| DB Setup | full | — | — | — | — | — |

`[PROPOSED]` Reports are readable and exportable by every role, including Sales
and Customer Care. Whether sales revenue should be exportable by Customer Care
is a business decision that has not been made. See OQ-09.

### 9.4 Enforcement depth — where each check actually lives

This table is the most important security statement in the document.

| Check | Enforced in the browser | Enforced in the database | Notes |
| --- | :---: | :---: | --- |
| Identity (who you are) | ✔ PIN hash comparison | ✖ | AUD-001 |
| Role permissions | ✔ `CAN.*` | ✖ | AUD-002 |
| Stage ownership | ✔ `canEnterStage` | ✖ | AUD-002 |
| Stage data gates | ✔ `gateBlock` | ✖ | AUD-002 |
| Model read access | ✔ (none — all roles read all) | ✖ open to anonymous | AUD-003 |
| Model write access | ✔ per permission | ✖ open to anonymous | AUD-003 |
| Account read access | ✖ | ✖ open to anonymous — **PIN hashes readable** | AUD-001, AUD-003 |
| Optimistic lock | ✔ sends the filter | ✔ the filter is evaluated in Postgres | Genuine server-side enforcement |
| Email send authorisation | ✖ (deliberately) | ✔ one-time approval claimed under a row lock | Genuine server-side enforcement |
| Approval table access | — | ✔ privileges revoked from anonymous | Genuine server-side enforcement |

Only three controls in the application are enforced outside the browser: the
optimistic lock, the email approval claim, and the approval tables' privileges.
Everything else is advisory.

---

## 10. Data requirements

### 10.1 Logical entity model

```
  users                       role_permissions
  ─────                       ────────────────
  id (PK, text)               role (PK, text)
  name                        label, color, sort
  role ──────────────────────▶ can        (jsonb: 12 permission booleans)
  pin  (djb2 hash)            advance_to (jsonb: array of stage keys)
  avatar                      updated_at
  created_at

  phones  (one row per phone model — everything below lives in this row)
  ──────────────────────────────────────────────────────────────────────
  id (PK, integer, random)
  brand, name, segment, launch (date), stage, po, archived
  created_at, updated_at  ◀── updated_at is the optimistic-lock version
  done          jsonb  { stageKey: "YYYY-MM-DD" }
  skus          jsonb  [ { rid, sku, material, units,
                           stpStatus, stpRequired,
                           receivedQty, receiptState,
                           listings: { Flipkart, Amazon, Meesho, Shopify } } ]
  sales_entries jsonb  [ { rid, date, marketplace, skuRid,
                           units, revenue, returns, notes } ]
  notes         jsonb  [ { rid, at, by, role, text } ]
  attachments   jsonb  [ { rid, at, by, label, url, kind } ]
  audit         jsonb  [ { rid, at, by, role, action } ]  — capped at 200

  stage_summary (view)            ── defined in schema.sql, NEVER QUERIED (AUD-032)

  report_approvals                report_send_log
  ────────────────                ───────────────
  id (PK, uuid)                   approval_id (PK, FK → report_approvals.id)
  code_hash                       status ('sending'|'sent'|'failed')
  request_ip_hash                 recipient_count (> 0)
  requested_at, expires_at        resend_email_id, error
  attempts (0..5), consumed_at     created_at, sent_at
```

### 10.2 Entity definitions and validations

| Entity | Attribute | Type / constraint | Validation | Evidence |
| --- | --- | --- | --- | --- |
| users | `id` | text, PK | app-generated `"u" + timestamp` for new accounts | `schema.sql:15,22`; `src/App.jsx:5075` |
| users | `role` | text, CHECK in 6 values | widened by migration to include `customer_care` | `schema.sql:17`; `schema-roles.sql:18-20` |
| users | `pin` | text, NOT NULL | djb2 hash of a 4–6 digit PIN | `src/App.jsx:423-427` |
| users | `avatar` | text, default `'U'` | first letter of the display name, upper-cased | `src/App.jsx:5067` |
| phones | `id` | integer, PK | random 1..2,000,000,000; checked against visible ids | `src/App.jsx:3282-3287` |
| phones | `brand`, `name` | text, NOT NULL | non-blank, trimmed | `src/App.jsx:3319-3330` |
| phones | `segment` | text, default `'Mid Range'` | one of Budget / Mid Range / Premium / Flagship — **enforced in the UI only, no CHECK** | `src/App.jsx:3375`; `schema.sql:30` |
| phones | `launch` | date, NOT NULL | required at create; accepts `YYYY-MM-DD` or `DD/MM/YYYY` on import | `schema.sql:31`; `src/App.jsx:3131-3135` |
| phones | `stage` | text, CHECK in 7 values | enforced in both the app and the database | `schema.sql:32-33` |
| phones | `po` | text, nullable | trimmed; no format rule | `src/App.jsx:5970` |
| phones | `skus[].units` | number | non-negative via input `min="0"` | `src/App.jsx:1809` |
| phones | `skus[].stpRequired` | `null` / `true` / `false` | tri-state; `null` is distinct from `false` | `src/App.jsx:130-134` |
| phones | `skus[].stpStatus` | one of 6 strings | enforced by the selector; **no constraint in the database** | `src/App.jsx:225`, `2018` |
| phones | `skus[].receiptState` | `null` / `full` / `short` / `none` | derived from the quantity, never typed directly | `src/App.jsx:2062-2068` |
| phones | `skus[].listings.*` | one of 4 strings | enforced by the cycle; **no constraint in the database** | `src/App.jsx:216`, `2177-2181` |
| phones | `sales_entries[].units` | number > 0 | submission inert at zero or blank | `src/App.jsx:2491` |
| phones | `attachments[].url` | text | **scheme not validated** | `src/App.jsx:2324`; AUD-006 |
| phones | `audit` | array, max 200 | oldest entries dropped | `src/App.jsx:145`, `157` |
| report_approvals | `attempts` | integer, CHECK 0..5 | incremented on a wrong code | `schema-report-approval.sql:13`, `63` |
| report_approvals | — | CHECK `expires_at > requested_at` | set to `now() + 10 minutes` | `schema-report-approval.sql:15`, `48` |
| report_send_log | `recipient_count` | integer, CHECK > 0 | from the server configuration | `schema-report-approval.sql:25` |

### 10.3 Derived values (never stored)

| Value | Formula | Evidence |
| --- | --- | --- |
| Stage target date | `launch − daysBeforeLaunch`, clamped to the date added | `src/App.jsx:286-292` |
| Stage delay | completed: actual − target; open: today − target, floored at 0 | `295-302` |
| Model worst delay | max delay across stages 0..index+1; zero when terminal | `319-320` |
| Is late | worst delay > 3 | `331` |
| Progress % | `(index + 1) / 6`, zero when terminal | `327` |
| Runway | date added → launch, versus 100 days | `307-311` |
| Model units | sum of SKU units | `326` |
| SKU stock on hand | received − sold + returned, floored at 0 | `184-192` |
| Stock % remaining | on hand / received | `190` |
| Needs reorder | received > 0 and % ≤ 20 | `191` |
| Model stock on hand | sum of SKU on hand − non-SKU-specific net sales, floored at 0 | `194-205` |
| Sales totals / 7d / 30d / return rate | summed from entries with rolling date windows | `251-270` |
| Is fully listed | all four marketplaces Live | `221` |
| Pending marketplaces | marketplaces with ≥1 non-Live SKU | `543-546` |
| Alerts | `problemsOf` | `342-403` |
| Can advance | `advanceStatus` = terminal + next + role + gate | `567-577` |

### 10.4 Data integrity requirements

| ID | Requirement | Current state |
| --- | --- | --- |
| DR-01 | A model's stage must be one of the seven known values. | Enforced in the database by CHECK. `IMPLEMENTED-UNVERIFIED` |
| DR-02 | A user's role must be one of the six known values. | Enforced in the database by CHECK. `IMPLEMENTED-UNVERIFIED` |
| DR-03 | A SKU identifier must be unique within its model. | Repaired on read, not constrained. `PARTIAL` (AUD-012) |
| DR-04 | A sales entry's `skuRid` must reference a SKU on the same model, or be null. | **Not enforced.** A SKU deleted after a sale leaves an orphaned reference; the stock calculation silently stops counting it and the history shows "—". `PARTIAL` (AUD-018) |
| DR-05 | A model's version stamp must change on every write. | Enforced by a database trigger. `IMPLEMENTED-UNVERIFIED` |
| DR-06 | An STP status must be one of the six known values. | UI only; no database constraint. `PARTIAL` |
| DR-07 | A listing status must be one of the four known values. | UI only; no database constraint. `PARTIAL` |
| DR-08 | A price segment must be one of the four known values. | UI only; no database constraint. `PARTIAL` |
| DR-09 | An approval may be consumed at most once. | Enforced in Postgres under a row lock. `IMPLEMENTED-UNVERIFIED` |
| DR-10 | An attachment URL must be a web URL. | **Not enforced.** `PARTIAL` (AUD-006) |
| DR-11 | Received quantity and receipt state must agree. | Enforced by deriving one from the other in both editors. `IMPLEMENTED-UNVERIFIED` |
| DR-12 | No model may be silently overwritten by a stale client. | Enforced by compare-and-swap. `IMPLEMENTED-UNVERIFIED` |

### 10.5 Retention and volume

`[CLARIFICATION]` No retention policy exists in the repository.

| Aspect | Current behaviour | Risk |
| --- | --- | --- |
| Audit entries | Oldest dropped beyond 200 per model | Silent history loss (AUD-024) |
| Notes, attachments, sales entries | Unbounded within the model's row | A single row grows without limit, and every save rewrites all of it (AUD-004) |
| Archived models | Retained indefinitely, hidden from views | None |
| Un-procured models | Retained indefinitely as the research record | None — this is the stated purpose |
| Deleted models | Hard-deleted, no soft delete, no undo | Irrecoverable (FR-019) |
| Approval rows | Retained indefinitely; no purge job | Table grows slowly; hashes only, so low sensitivity |
| Send log | Retained indefinitely | Useful audit; no purge job |

---

## 11. Integration requirements

| ID | Integration | Direction | Protocol | Authentication | Status |
| --- | --- | --- | --- | --- | --- |
| INT-01 | Supabase PostgREST — models, users, role permissions | Read/write | HTTPS REST | Public anonymous key in the browser bundle | `IMPLEMENTED-UNVERIFIED`; the key grants full access (AUD-003) |
| INT-02 | Supabase Edge Function `request-stp-report-approval` | Write (invoke) | HTTPS POST | None at the gateway (deliberate); origin-checked; rate-limited per IP | `IMPLEMENTED-UNVERIFIED` |
| INT-03 | Supabase Edge Function `send-stp-report` | Write (invoke) | HTTPS POST | None at the gateway (deliberate); origin-checked; one-time approval code | `IMPLEMENTED-UNVERIFIED` |
| INT-04 | Resend email API | Outbound | HTTPS POST with an idempotency key | Server-held API key, never in the browser | `IMPLEMENTED-UNVERIFIED` |
| INT-05 | Supabase Postgres RPC `create_report_approval` / `claim_report_approval` | Read/write | PostgREST RPC | `service_role`, Edge Functions only | `IMPLEMENTED-UNVERIFIED` |
| INT-06 | GitHub Pages hosting | Outbound deploy | Git push → Actions | Repository secrets | `DOCUMENTED-NOT-FOUND` (AUD-007) |
| INT-07 | Browser local storage — connection config and session | Read/write | Web Storage | Same-origin only | `IMPLEMENTED-UNVERIFIED`; stores the PIN hash (AUD-005) |
| INT-08 | File download (reports and exports) | Outbound | Blob + object URL | n/a | `IMPLEMENTED-UNVERIFIED` |
| INT-09 | File upload (import) | Inbound | `FileReader`, 2 MB cap | n/a | `IMPLEMENTED-UNVERIFIED` |
| INT-10 | External document stores (Drive, Dropbox, SharePoint) | Reference only | Stored URL | None — the link is opened in the user's browser | `PARTIAL`; scheme not validated (AUD-006) |
| INT-11 | Marketplace APIs (Flipkart, Amazon, Meesho, Shopify) | — | — | — | **Not implemented.** Listing status is manual |
| INT-12 | `lucide-react` icon library | Build-time | npm | n/a | `IMPLEMENTED-VERIFIED` (build succeeds) |

### 11.1 Integration non-functional requirements

| ID | Requirement | Current state |
| --- | --- | --- |
| INT-NFR-01 | Every outbound database request must be time-bounded. | 12-second abort. `IMPLEMENTED-UNVERIFIED` |
| INT-NFR-02 | An integration failure must be reported to the user in plain language, never silently swallowed. | Met for the database and the email paths; **not** met for the reset delete (FR-019) |
| INT-NFR-03 | Email sends must be idempotent under retry. | Idempotency keys on both sends. `IMPLEMENTED-UNVERIFIED` |
| INT-NFR-04 | No credential may reach the browser bundle other than the Supabase anonymous key. | Met — the Resend key and service role key are server-only |
| INT-NFR-05 | The Edge Functions must accept requests only from the configured application origin. | Origin equality check. `PARTIAL` — an `Origin` header is trivially forged by a non-browser client, so this is not an authorisation control; the approval code is (AUD-033) |
| INT-NFR-06 | The email functions must refuse to act when misconfigured rather than acting partially. | Both return 500 before any side effect when a secret is missing. `IMPLEMENTED-UNVERIFIED` |

---

## 12. Reporting requirements and KPI definitions

### 12.1 Report inventory

| ID | Report | Scope | Columns | Status |
| --- | --- | --- | --- | --- |
| RPT-01 | All Phones | Every non-archived model | Brand, Model, Segment, Launch, Stage, PO, SKUs, Total units, Late?, Days to launch | `IMPLEMENTED-UNVERIFIED` |
| RPT-02 | Planned | Models at Planned, one row per SKU (or a placeholder row when none) | Brand, Model, Segment, Launch, SKU, Material, Units planned, SKU status | `IMPLEMENTED-UNVERIFIED` |
| RPT-03 | Ordered | Models at Ordered, one row per SKU | Brand, Model, Segment, Launch, PO, SKU, Material, Units | `IMPLEMENTED-UNVERIFIED` |
| RPT-04 | Production / STP | Models at Production, one row per SKU | …plus STP required, STP status | `IMPLEMENTED-UNVERIFIED` |
| RPT-05 | STP Requirement | Models at Ordered or Production, one row per model per material | Brand, Model, Stage, PO, Material, SKUs, Units, STP file | `PARTIAL` — three divergent implementations (AUD-013) |
| RPT-06 | Received | Models at Received, one row per SKU | …plus Planned qty, Received qty, Short by, Status | `IMPLEMENTED-UNVERIFIED` |
| RPT-07 | Listing | Models at Received or Live, one row per SKU | Brand, Model, Stage, SKU, Material, 4 marketplace columns, Fully listed | `IMPLEMENTED-UNVERIFIED` |
| RPT-08 | Late Models | Models flagged late | Brand, Model, Segment, Launch, Stage, Days late, Days to launch | `IMPLEMENTED-UNVERIFIED` |
| RPT-09 | Sales | Models at Live, one row per sales entry | Brand, Model, Date, Marketplace, Units sold, Revenue, Returns, Notes | `IMPLEMENTED-UNVERIFIED` |
| RPT-10 | Inward stock (screen export) | Models at Ordered, Production or Received, one row per SKU | …plus Units ordered, Units received, Short by, Receipt status | `IMPLEMENTED-UNVERIFIED` |
| RPT-11 | Catalog pending listing (screen export) | Queued SKUs | Brand, Model, SKU, Material, 4 marketplace columns, Missing on | `IMPLEMENTED-UNVERIFIED` |
| RPT-12 | PO sheet (screen export) | One PO, or a draft selection | PO, Brand, Model, Launch, SKU, Material, Units | `IMPLEMENTED-UNVERIFIED` |
| RPT-13 | STP requirement email | Models at Ordered or Production, server-built, ≤500 rows | Brand, Model, Stage, PO, Material, SKUs, Units, STP file | `IMPLEMENTED-UNVERIFIED` |

### 12.2 KPI definitions

These are the quantities the application actually computes and displays. **No
target value exists for any of them in the repository.** The "proposed target"
column is explicitly a proposal from this audit for discussion, not a commitment
and not a measurement.

| ID | KPI | Definition as implemented | Source | Proposed target (for discussion) |
| --- | --- | --- | --- | --- |
| KPI-01 | Models tracked | Count of non-archived models | `models.length` | — (volume measure) |
| KPI-02 | Models late | Count where worst delay > 3 days | `isLate` | `PROPOSED` 0; alert threshold already encoded |
| KPI-03 | Worst delay (days) | Max stage delay up to the next stage | `worstDelay` | `PROPOSED` ≤ 3 |
| KPI-04 | Launching within 14 days and not Live | Count of non-terminal models with 0 ≤ days-to-launch ≤ 14 and stage ≠ live | Dashboard | `PROPOSED` 0 at launch minus 1 day |
| KPI-05 | Models ready to advance (per role) | Count where `advanceStatus(model, role).ok` | FilterBar / Dashboard | — (work queue) |
| KPI-06 | Ordered without a PO | Count at Ordered with no PO | Dashboard | `PROPOSED` 0 |
| KPI-07 | STP files not sent | Count at Production with any SKU not sent | Dashboard | `PROPOSED` 0 by the Production target date |
| KPI-08 | STP requirement undecided (SKUs) | Count of SKUs at Ordered/Production with `stpRequired == null` | STP screen, alerts | `PROPOSED` 0 before Production |
| KPI-09 | Receipts unconfirmed | Count at Received with any unconfirmed SKU | Dashboard, Inward badge | `PROPOSED` 0 within N days of arrival — N unknown |
| KPI-10 | Units short on delivery | Sum of planned − received over confirmed SKUs | Received report | `CLARIFICATION` — no tolerance defined |
| KPI-11 | SKUs pending listing | Length of the listing queue | Listing badge | `PROPOSED` 0 by launch date |
| KPI-12 | Fully listed models | Models at Received/Live where every SKU is live everywhere | Dashboard | `PROPOSED` 100% of Live models |
| KPI-13 | Listing completion per marketplace | Live SKUs ÷ all SKUs on Received/Live models | Dashboard | `PROPOSED` 100% |
| KPI-14 | Blocked listings | SKUs with any marketplace Blocked | Dashboard, alerts | `PROPOSED` 0 |
| KPI-15 | Units sold | Sum of sales entry units on Live models | Dashboard, Sales report | — (outcome measure) |
| KPI-16 | Revenue | Sum of sales entry revenue on Live models | Dashboard | — (outcome measure) |
| KPI-17 | Return rate | Returns ÷ units sold, one decimal place | Sales tracker | `CLARIFICATION` — no acceptable rate defined |
| KPI-18 | Units sold, 7 and 30 day | Entry units within rolling windows | Sales tracker | — (trend measure) |
| KPI-19 | Stock on hand | Sum of per-SKU on hand across Live models | Dashboard | — (volume measure) |
| KPI-20 | SKUs needing reorder | SKUs on Live models at ≤20% of received | Dashboard, alerts | `PROPOSED` acted on within N days — N unknown |
| KPI-21 | Units in pipeline | Sum of SKU units across all models | Dashboard | — (volume measure) |
| KPI-22 | Models not procured | Count at Un-Procurement | Dashboard | — (decision record) |

### 12.3 Reporting gaps

| ID | Gap | Impact | Recommendation |
| --- | --- | --- | --- |
| RG-01 | **No historical or trend reporting of any kind.** Every figure is a snapshot of current state. | KPI-02, KPI-03, KPI-11 and KPI-12 cannot be trended, so improvement cannot be demonstrated. | `PROPOSED` capture a daily snapshot of the stage counts and delay distribution |
| RG-02 | No cycle-time report (actual days per stage), although the data to compute it is in `done`. | The 100/85/75/60/25/0 schedule cannot be validated against reality. | `PROPOSED` a cycle-time report from `done` |
| RG-03 | No supplier performance view, although STP status and receipt shortfalls are captured per SKU. | Repeat offenders are invisible. | `PROPOSED` — requires a supplier field, which does not exist |
| RG-04 | No cost, margin or landed-cost reporting. | Procurement value cannot be reported. | `CLARIFICATION` — out of current scope |
| RG-05 | Reports have no date-range filter; they report current state only. | A month-end or period report is not possible. | `PROPOSED` add date-range filtering |
| RG-06 | The Sales report covers Live models only, so sales history is lost if a model is moved back. | Reporting blind spot after a backward move. | `PROPOSED` report sales regardless of stage |
| RG-07 | Reports exclude archived models with no option to include them. | Archiving removes a model from history as well as from the board. | `PROPOSED` an include-archived option |

---

## 13. Non-functional requirements

| ID | Category | Requirement | Current state | Status |
| --- | --- | --- | --- | --- |
| NFR-001 | Security · Authentication | Users must be authenticated by a mechanism that cannot be bypassed by a client. | A client-side PIN comparison against a hash readable by any anonymous caller. | **NOT MET** (AUD-001) |
| NFR-002 | Security · Authorization | Write permissions must be enforced server-side. | Enforced in the browser only. | **NOT MET** (AUD-002) |
| NFR-003 | Security · Data access | The database must not grant unrestricted access to an anonymous public key. | RLS is enabled but the policies are `using (true) with check (true)`. | **NOT MET** (AUD-003) |
| NFR-004 | Security · Credential handling | No sending credential may appear in the browser bundle. | Met: the Resend key and `service_role` key are server-only. | `IMPLEMENTED-UNVERIFIED` |
| NFR-005 | Security · Secrets at rest | Approval codes and request IPs must not be stored in clear. | Peppered SHA-256 only. | `IMPLEMENTED-UNVERIFIED` |
| NFR-006 | Security · PIN strength | Credentials must resist offline brute force. | 4–6 digit PIN hashed with djb2, a non-cryptographic 32-bit function; the search space is ≤10⁶. | **NOT MET** (AUD-001) |
| NFR-007 | Security · Session | A session must expire and must not retain a credential. | Expires after 12 hours, but the stored object includes the PIN hash. | `PARTIAL` (AUD-005) |
| NFR-008 | Security · Output encoding | Data leaving the application must not be executable by the receiving program. | HTML is escaped in the email; **exported CSV cells are not neutralised against spreadsheet formula evaluation**, and attachment URL schemes are not validated. | `PARTIAL` (AUD-006) |
| NFR-009 | Security · Rate limiting | Sensitive server endpoints must be rate-limited. | 3 approval requests per hour per hashed IP; 5 code attempts per approval. **No limit on sign-in attempts.** | `PARTIAL` |
| NFR-010 | Reliability · Request bounding | No request may hang indefinitely. | 12-second abort on every database call. | `IMPLEMENTED-UNVERIFIED` |
| NFR-011 | Reliability · Lost update prevention | Concurrent edits must not silently overwrite each other. | Optimistic locking with compare-and-swap, serialised per model. | `IMPLEMENTED-UNVERIFIED`; not runtime-tested (§20) |
| NFR-012 | Reliability · Honest status | The interface must never claim a save that did not happen. | `saved()` awaits the write; the local-only banner and per-message warnings are explicit. | `IMPLEMENTED-UNVERIFIED`; cross-talk between concurrent saves (AUD-017) |
| NFR-013 | Reliability · Unsaved work | The user must not lose work silently. | `beforeunload` guard; background reads suppressed while a detail panel is open; conflicted edits retained. | `PARTIAL` — other screens' drafts unprotected (AUD-016); the detail panel remounts on save (AUD-034) |
| NFR-014 | Reliability · Graceful degradation | A failed database must leave a usable, honest application. | Boot screen with an offline escape after 4 seconds; login warning; local-only banner; demonstration accounts withheld. | `IMPLEMENTED-UNVERIFIED` |
| NFR-015 | Performance · Bundle size | The application must load quickly over a typical connection. | 328.65 kB JavaScript, 95.27 kB gzipped; one chunk, no code splitting. | `IMPLEMENTED-VERIFIED` (measured by the executed build) |
| NFR-016 | Performance · Build time | The build must be fast enough for frequent deployment. | 1.69 seconds, 1500 modules. | `IMPLEMENTED-VERIFIED` (measured) |
| NFR-017 | Performance · Render cost | Interaction must stay responsive as data grows. | Derivation is memoised on the model list, but the dashboard recomputes alerts and queues on every render, and the Reports view builds all nine reports on every render. | `PARTIAL` (AUD-022) |
| NFR-018 | Performance · Network | Synchronisation must not transfer more than necessary. | Every 90 seconds the full `phones` table is read with no pagination or field selection, including all JSONB. | `PARTIAL` (AUD-004) |
| NFR-019 | Performance · Write amplification | A write must not rewrite unrelated data. | Every save rewrites the entire model row including all SKUs, sales, notes, attachments and audit. | `PARTIAL` (AUD-004) |
| NFR-020 | Usability · Single source of truth | The same rule must produce the same answer on every screen. | `gateBlock`, `moveStatus`, `advanceStatus`, `problemsOf` and `passesFilters` are each the sole implementation of their rule. | `IMPLEMENTED-UNVERIFIED` — a genuine strength |
| NFR-021 | Usability · Actionable refusals | A refusal must say what to do about it. | Every gate and permission refusal names the blocking condition or the role. | `IMPLEMENTED-UNVERIFIED` |
| NFR-022 | Usability · Empty states | Every view must explain itself when empty. | Tailored empty states on the board, list, calendar, inward, listing, STP, PO, reports and dashboard, distinguishing "no data" from "filtered out". | `IMPLEMENTED-UNVERIFIED` |
| NFR-023 | Usability · Responsive layout | The application must be usable on a phone. | Sticky header; swipeable tab strip with scroll-snap below 900 px; single-column forms below 640 px; strapline hidden; horizontal scroll on every wide table. | `IMPLEMENTED-UNVERIFIED` |
| NFR-024 | Accessibility · Keyboard | All functionality must be keyboard-operable. | Dialogs trap and restore focus and close on Escape; table rows, KPI cards, to-do rows, funnel rows and calendar entries are focusable and Enter-operable; column sorting is a real button with `aria-sort`. **The STP requirement matrix is mouse-only**, and backward stage moves have no keyboard path outside the detail panel. | `PARTIAL` (AUD-015) |
| NFR-025 | Accessibility · Announcements | State changes must be announced. | A permanently mounted `role="status"` live region for messages (deliberately mounted before the text arrives); `aria-current` on the active tab; `aria-label` on every icon-only control; `aria-pressed` on toggles. | `IMPLEMENTED-UNVERIFIED` |
| NFR-026 | Accessibility · Disabled controls | A disabled control must not appear or announce as usable. | Real `disabled` attributes with explicit non-interactive styling, replacing earlier opacity-only fakes. | `IMPLEMENTED-UNVERIFIED` |
| NFR-027 | Accessibility · Motion | Animation must respect the operating system's reduced-motion preference. | Two media queries: specific keyframe overrides and a global animation/transition suppression. | `IMPLEMENTED-UNVERIFIED` |
| NFR-028 | Accessibility · Colour | Status must not be conveyed by colour alone. | Every status cell and tag carries text as well as colour. | `IMPLEMENTED-UNVERIFIED` |
| NFR-029 | Accessibility · Contrast | Text must be legible in both themes. | Two full token sets with distinct values per theme; native select options are explicitly re-coloured for dark mode. | `IMPLEMENTED-UNVERIFIED` — not measured against WCAG ratios |
| NFR-030 | Maintainability · Modularity | Code must be organised so a change has a bounded blast radius. | 6,391 of 6,482 source lines are in one file. | **NOT MET** (AUD-023) |
| NFR-031 | Maintainability · Automated verification | Business rules must be protected by tests. | One self-check covering `src/roles.js` only — about 1.3% of source lines. No linter, no type checker. | **NOT MET** (AUD-021) |
| NFR-032 | Maintainability · Dead code | The codebase must not carry unused code. | `persistLegacy`, `money()` and the `stage_summary` view are all unreferenced. | `PARTIAL` (AUD-032) |
| NFR-033 | Maintainability · Documented shortcuts | A deliberate shortcut must carry its limit and its upgrade trigger. | Met where it matters: module-scope role tables, the `.xls` tab-separated format and the single-tenant assumption each carry an explicit comment. | `IMPLEMENTED-UNVERIFIED` — a genuine strength |
| NFR-034 | Operability · Observability | Failures must be visible to someone who can act. | No error reporting, no metrics, no client logging. Only `report_send_log` records anything server-side. | **NOT MET** (AUD-026) |
| NFR-035 | Operability · Migration safety | A migration must not destroy data unexpectedly. | Four additive migrations are idempotent and documented as safe; `schema.sql` drops its tables and the in-application setup screen instructs operators to run it without that warning. | `PARTIAL` (AUD-030) |
| NFR-036 | Operability · Reproducible deployment | Deployment must be automated and reproducible. | Documented but the workflow file is absent. | **NOT MET** (AUD-007) |
| NFR-037 | Portability · Hosting | The application must work from a project subpath. | Relative asset base. | `IMPLEMENTED-VERIFIED` (build output uses relative paths) |
| NFR-038 | Portability · Browser support | The application must work in current evergreen browsers. | `color-mix`, `backdrop-filter` (feature-queried), `AbortController`, `??=`, optional chaining. No transpilation target below Vite's default. | `IMPLEMENTED-UNVERIFIED` — no browser matrix is stated anywhere |
| NFR-039 | Localisation | Dates and currency must suit the operating market. | `en-IN` dates and rupee formatting throughout, hardcoded. | `IMPLEMENTED-UNVERIFIED`; single-locale by design |
| NFR-040 | Correctness · Date handling | Date arithmetic must not shift a date across a day boundary. | Local-calendar strings throughout, with UTC conversion deliberately avoided. | `IMPLEMENTED-UNVERIFIED`; "today" is captured once at module load (AUD-031) |

---

## 14. Dependencies, assumptions and constraints

### 14.1 Dependencies

| ID | Dependency | Type | Version | Criticality | Notes |
| --- | --- | --- | --- | --- | --- |
| DEP-01 | React | Runtime library | `^18.3.1` | Critical | The entire user interface |
| DEP-02 | React DOM | Runtime library | `^18.3.1` | Critical | — |
| DEP-03 | `lucide-react` | Runtime library | `^0.383.0` | Low | Icons only; 14 icons used |
| DEP-04 | Vite | Build tool | `^5.4.0` | Critical | Build emits a CJS-API deprecation warning |
| DEP-05 | `@vitejs/plugin-react` | Build tool | `^4.3.1` | Critical | — |
| DEP-06 | Node.js | Build/runtime toolchain | not pinned | Critical | No `engines` field; no `.nvmrc`; the self-check emits a `MODULE_TYPELESS_PACKAGE_JSON` warning because `package.json` lacks `"type": "module"` |
| DEP-07 | Supabase (Postgres + PostgREST) | Managed service | not pinned | Critical | The only data store |
| DEP-08 | Supabase Edge Functions (Deno) | Managed service | not pinned | High | The email approval and send |
| DEP-09 | Resend | Third-party email API | not pinned | High | Only outbound channel; a paid service |
| DEP-10 | GitHub Pages | Hosting | — | High | Per `README.md`; the workflow is absent |
| DEP-11 | GitHub Actions | CI/CD | — | High | `DOCUMENTED-NOT-FOUND` |
| DEP-12 | Modern evergreen browser | Client platform | unstated | Critical | `color-mix`, `AbortController`, `??=` |
| DEP-13 | Browser local storage | Client platform | — | Medium | Connection config and session; degrades gracefully |

**Dependency observations.**
No dependency is exactly pinned — every version carries a caret, and there is no
committed lockfile policy statement, although `package-lock.json` is present and
committed. There is no automated dependency update or vulnerability scanning
configuration. No `engines` constraint means a future Node release could break
the build without warning.

### 14.2 Assumptions

Each assumption is labelled by how it was established.

| ID | Assumption | Basis | If wrong |
| --- | --- | --- | --- |
| ASM-01 | The user population is small, internal and trusted. | **Inferred by this audit** from the PIN login, the shared anonymous key and the explicit single-tenant comment (`src/App.jsx:483-487`). | The security findings move from "accepted risk" to "immediate blocker". |
| ASM-02 | All users are within one organisation and may see all data. | **Inferred** — there is no per-row ownership, no team scoping and no read restriction by role. | A multi-team or multi-tenant need requires a data-model change, not a configuration change. |
| ASM-03 | The business sells on exactly four marketplaces. | **Repository fact** — hardcoded (`src/App.jsx:95`). | Adding a fifth requires a code change and a data migration of every SKU's `listings` object. |
| ASM-04 | The business orders exactly four case materials. | **Repository fact** — hardcoded (`src/App.jsx:102-107`). | A fifth material is already partly possible via bulk paste, but becomes invisible to the STP matrix (AUD-013). |
| ASM-05 | The 100/85/75/60/25/0 day schedule reflects real lead times. | **Assumed** — no derivation, source or review date is recorded. | Delay reporting and KPI-02/03 are measuring against the wrong baseline. See OQ-01. |
| ASM-06 | A 3-day slip is tolerable before a model is called late. | **Assumed** — the threshold is a bare literal (`src/App.jsx:331`). | Lateness is over- or under-reported. See OQ-06. |
| ASM-07 | 20% of received stock is the right reorder trigger. | **Assumed** — a bare literal (`src/App.jsx:178`). | Reorders are raised too early or too late. |
| ASM-08 | A 12-hour session is appropriate for shared machines. | **Assumed** — a bare literal (`src/App.jsx:695`). | Either an inconvenience or an exposure. |
| ASM-09 | Users work in a single timezone. | **Inferred** from `en-IN` formatting and local-calendar date handling. | Dates could differ by one day between users. |
| ASM-10 | Stock is tracked only from the receipt point, with no opening balance. | **Repository fact** — stock is derived from `receivedQty` only. | Pre-existing stock cannot be represented. |
| ASM-11 | One PO per model at a time is sufficient. | **Repository fact** — `po` is a single nullable text column. | A model split across two POs cannot be represented. |
| ASM-12 | Supplier identity need not be recorded. | **Repository fact** — no supplier field exists anywhere. | Supplier performance reporting is impossible (RG-03). |
| ASM-13 | The documented GitHub Pages deployment is the live deployment. | **Documented** in `README.md`, which links a live URL. **The workflow is not in the repository**, so the deployment mechanism actually in use is unknown to this audit. | The release process is undocumented in practice. See OQ-10. |
| ASM-14 | The email approver and the report recipients are correctly configured in the deployed environment. | **Documented** in `REPORT-EMAIL-SETUP.md`; **not verifiable** — no deployment was available. | Reports go nowhere, or to the wrong recipients. |

### 14.3 Constraints

| ID | Constraint | Type | Consequence |
| --- | --- | --- | --- |
| CON-01 | The application is browser-only; there is no application server of its own. | Architectural | Every rule a client could bypass must live in Postgres, or it is advisory. This is the root cause of AUD-001 to AUD-003. |
| CON-02 | The Supabase key shipped in the bundle is readable by every visitor. | Platform | Normal for a browser-only Supabase client, and precisely why RLS must carry the authorization. |
| CON-03 | GitHub Pages serves static files only. | Hosting | No server-side rendering, no server-side session, no server-side secret beyond the Edge Functions. |
| CON-04 | All model detail is held in JSONB on one row. | Data model | A write rewrites everything; concurrent edits to different SKUs of one model collide (AUD-004). |
| CON-05 | PostgREST compare-and-swap is the only locking primitive available. | Platform | Conflict handling must be client-orchestrated, which is why the conflict latch exists (AUD-008). |
| CON-06 | Attachments are links; the application stores no files. | Scope | Document retention depends on third-party stores outside this application's control. |
| CON-07 | Marketplace status is manual. | Scope | Listing data is only as current as the catalog team's entry. |
| CON-08 | No build-time type checking or linting exists. | Tooling | Refactoring a 6,391-line file carries no automated safety net (AUD-021, AUD-023). |
| CON-09 | Resend is a paid third-party service. | Commercial | Email volume has a cost; this audit sent no email. |
| CON-10 | `schema.sql` is destructive by design. | Operational | It must never run against production (AUD-030). |

---

## 15. Open questions

Each question blocks a requirement from being confirmed. None can be answered
from the repository.

| ID | Question | Why it matters | Blocks | Owner |
| --- | --- | --- | --- | --- |
| OQ-01 | Where does the 100/85/75/60/25/0 day milestone schedule come from, and when was it last reviewed against actual supplier lead times? | It is the baseline for every delay figure and for KPI-02 and KPI-03. If it is wrong, the application reports lateness that is not real, or hides lateness that is. | BR-019, ASM-05, KPI-02, KPI-03 | Procurement lead |
| OQ-02 | Is any financial or spend approval required before a purchase order is raised? | No value threshold, budget check or approval step exists. A PO of any size can be raised by anyone holding `savePO`. | §8.9, FR-026, FR-027 | Finance / MD |
| OQ-03 | Should an undecided STP requirement block the move out of Production? | It currently does not — it raises a warning only. The code records this as a deliberate decision, but no business owner has confirmed it. | BR-015, FR-035 | Catalog lead |
| OQ-04 | What is the acceptable tolerance for a short delivery, and what should happen when one is accepted? | Short and nil deliveries do not block the move to Live, and their alerts have no resolution mechanism, so an accepted shortfall alerts indefinitely. | BR-017, FR-040, KPI-10, AUD-020 | Procurement / Catalog |
| OQ-05 | Should a model be able to move to Un-Procurement from stages after Research? | The gate permits Research only, but a code comment describes un-procuring from Ordered, and the Admin matrix lets any role be granted the Un-Procurement stage. | BR-004, FR-017 | Procurement lead |
| OQ-06 | Is a 3-day slip the right tolerance before a model is reported as late? | It determines every late count, the Running late card and the Late Models report. | BR-023, ASM-06, KPI-02 | Procurement lead |
| OQ-07 | How should models already in flight be entered, given that completion dates cannot be set retrospectively? | A backfilled model is stamped with today's date for every stage it passes, so it reports as perfectly on time. This silently corrupts any historical delay analysis. | §5.3, FR-R11, AUD-025 | Procurement lead |
| OQ-08 | Should the emailed STP report reflect what the sender is looking at, or always the full Ordered-plus-Production set? | The button sits on a screen the user has been working, but the email is built server-side from a fixed query, so the two can differ. | FR-036, BR-125 | MD / Catalog lead |
| OQ-09 | Should every role be able to read and export every report, including sales revenue? | All eight views and all nine reports are readable by all six roles. Customer Care and Sales can export revenue. | §9.3 | MD |
| OQ-10 | How is the application actually deployed today, given that the documented workflow is not in the repository? | Without this, the release process cannot be reproduced or audited, and the Supabase credentials in use are unknown. | FR-082, ASM-13, AUD-007 | Maintainer |
| OQ-11 | Who are the named approver and recipients of the STP report in the live environment? | They are server-side configuration this audit could not read. The in-application label says "MD / Factory". | BR-120, ASM-14 | MD |
| OQ-12 | What is the data retention expectation for audit entries, notes and archived models? | The audit trail silently truncates at 200 entries per model; nothing else is ever purged. | BR-100, §10.5, AUD-024 | MD / compliance |
| OQ-13 | Is the data held in this application commercially sensitive — supplier terms, launch dates before announcement, sales volumes? | This determines whether the security findings are an accepted risk or an urgent remediation. Unannounced launch dates and sales volumes are typically sensitive. | AUD-001 to AUD-003, Phase 1 | MD |
| OQ-14 | How many concurrent users are expected, and how many models per season? | Determines whether the whole-row write model and the unpaginated 90-second sync are adequate. | AUD-004, NFR-018, NFR-019 | Procurement lead |
| OQ-15 | Should a SKU added or changed after the PO was sent be tracked as requiring a re-send? | The application warns but records nothing, so an unsent revision is invisible. | FR-025 | Procurement lead |

---

## 16. Risks and proposed mitigations

Likelihood and impact are **this audit's assessment**. Risk score = likelihood ×
impact on a 1–5 scale.

| ID | Risk | Likelihood | Impact | Score | Proposed mitigation | Linked |
| --- | --- | :---: | :---: | :---: | --- | --- |
| RSK-01 | Anyone who obtains the deployed URL can read every account row, including PIN hashes, and crack a 4-digit PIN essentially instantly, then sign in as Admin. | 4 | 5 | **20** | Phase 1: replace PIN login with Supabase Auth; restrict `users` reads. | AUD-001, AUD-005 |
| RSK-02 | Anyone with the public key can delete or alter every phone record directly, bypassing the application entirely. | 4 | 5 | **20** | Phase 1: role-based RLS write policies. | AUD-002, AUD-003 |
| RSK-03 | Commercially sensitive data — unannounced launch dates, order volumes, sales revenue — is readable by anyone who finds the endpoint. | 3 | 5 | **15** | Phase 1, and answer OQ-13 to confirm sensitivity. | AUD-003, OQ-13 |
| RSK-04 | An administrator removes or re-roles the last admin account and locks the organisation out of user and permission management. | 2 | 5 | **10** | Phase 1: guard the last admin; add a recovery path. | AUD-011 |
| RSK-05 | An operator follows the in-application setup instruction to run `schema.sql` against a populated database and destroys all data. | 2 | 5 | **10** | Phase 1: warn in the setup screen; remove the instruction; make the bootstrap script non-destructive. | AUD-030 |
| RSK-06 | The STP requirement sent to the factory omits SKUs whose material is off the hardcoded list, so parts are made without required paperwork — or paperwork is chased for parts that do not need it. | 3 | 4 | **12** | Phase 1: one shared row-builder; drive columns from the data. | AUD-013 |
| RSK-07 | A business rule is broken by a future change and nobody notices, because nothing tests it. | 4 | 3 | **12** | Phase 2: unit tests for every rule in §6. | AUD-021 |
| RSK-08 | The release process cannot be reproduced because the deployment workflow is not in the repository. | 3 | 3 | **9** | Phase 1: commit the workflow; answer OQ-10. | AUD-007 |
| RSK-09 | Concurrent editors of one model collide repeatedly because any edit rewrites the whole row, and each collision locks that model out of saving until a manual refresh. | 3 | 3 | **9** | Phase 2: child tables and per-SKU writes; clear the latch on a successful single-model re-read. | AUD-004, AUD-008 |
| RSK-10 | Delay reporting is measured against a schedule nobody has validated, so management acts on misleading lateness figures. | 3 | 3 | **9** | Answer OQ-01; add a cycle-time report to validate the schedule. | ASM-05, RG-02 |
| RSK-11 | Historical models are backfilled and report as perfectly on time, making the delay data useless for trend analysis. | 3 | 3 | **9** | Answer OQ-07; allow an audited date edit. | AUD-025 |
| RSK-12 | A deleted SKU orphans its sales entries, silently understating units sold and overstating stock on hand. | 2 | 4 | **8** | Phase 2: foreign-key the sales entries; warn before deleting a SKU with sales. | AUD-018 |
| RSK-13 | An exported report opened in Excel executes a formula injected through a brand, model, SKU or note field. | 2 | 3 | **6** | Phase 1: prefix cells beginning `= + - @`. | AUD-006 |
| RSK-14 | A `javascript:` URL stored as an attachment runs in a colleague's browser when clicked. | 2 | 3 | **6** | Phase 1: allow only `http:` and `https:`. | AUD-006 |
| RSK-15 | A failure that only one user sees is never reported, so recurring problems are never fixed. | 4 | 2 | **8** | Phase 3: error reporting and a conflict log. | AUD-026 |
| RSK-16 | The 6,391-line single file makes every change risky and slows maintenance, with no test or type safety net. | 4 | 2 | **8** | Phase 2: split by domain after the tests exist. | AUD-023, AUD-021 |
| RSK-17 | An unsaved draft is lost when the detail panel remounts on a save, or when a background sync lands on another screen. | 3 | 2 | **6** | Phase 2: preserve drafts; extend the background-read suppression. | AUD-016, AUD-034 |
| RSK-18 | Performance degrades as the model count grows — a full unpaginated table read every 90 seconds and nine report builds per render. | 3 | 2 | **6** | Phase 3: paginate, select fields, memoise. Answer OQ-14. | AUD-004, AUD-022 |
| RSK-19 | A tab left open overnight stamps yesterday's date on today's stage moves. | 3 | 2 | **6** | Phase 2: recompute "today" on focus. | AUD-031 |
| RSK-20 | A key dependency releases a breaking change, since nothing is exactly pinned and nothing is scanned. | 2 | 3 | **6** | Phase 3: pin exactly, add an update and audit workflow, set `engines`. | §14.1 |
| RSK-21 | Resend delivery fails after the approval is consumed, so the sender must request a new code each time; repeated failures hit the 3-per-hour limit. | 2 | 2 | **4** | Phase 3: consume the approval only after a successful send, or allow a re-send against the same approval. | AUD-029 |
| RSK-22 | Keyboard-only or assistive-technology users cannot set STP requirements at all. | 2 | 3 | **6** | Phase 2: make the matrix cells real buttons. | AUD-015 |

---

## 17. Acceptance criteria and UAT scenarios

### 17.1 Overall acceptance criteria

| ID | Criterion | How it is judged |
| --- | --- | --- |
| AC-01 | Every requirement marked `IMPLEMENTED-UNVERIFIED` in this document passes its stated acceptance criteria when exercised against a real deployment. | UAT run-through, §17.2 |
| AC-02 | No stage transition is possible that violates §6.2, from any screen. | UAT-03, UAT-04, UAT-05, UAT-06 |
| AC-03 | No role can perform an action its permission matrix withholds, from any screen. | UAT-11, UAT-12 |
| AC-04 | A concurrent edit never silently overwrites another user's work. | UAT-16 |
| AC-05 | No message claims a save that did not reach the database. | UAT-17, UAT-18 |
| AC-06 | The STP requirement screen export, the Reports tab and the emailed report describe identical rows for identical data. | UAT-09 — **expected to fail against the current build** (AUD-013) |
| AC-07 | All functionality is reachable by keyboard alone. | UAT-20 — **expected to fail** (AUD-015) |
| AC-08 | Write permissions are enforced even when the browser is bypassed. | UAT-21 — **expected to fail** (AUD-002, AUD-003) |
| AC-09 | The last administrator cannot be removed or demoted. | UAT-13 — **expected to fail** (AUD-011) |
| AC-10 | Every migration referenced by documentation exists and is safe to run as instructed. | UAT-22 — **expected to fail** (AUD-007, AUD-030) |

### 17.2 UAT scenarios

Prerequisites for every scenario: a Supabase project with `schema.sql` and all
four additive migrations applied; at least one account per role with known PINs;
Edge Function secrets configured; a browser per role.

| ID | Scenario | Steps | Expected result | Verifies |
| --- | --- | --- | --- | --- |
| UAT-01 | Sign in and session | Sign in as each of the six roles; refresh; wait past 12 hours (or edit the stored timestamp). | Each role signs in; refresh keeps the session; an expired session returns the login screen. | FR-001, FR-003 |
| UAT-02 | Wrong credentials | Enter a 3-digit PIN, then a wrong 4-digit PIN. | Submit blocked at 3 digits; the wrong PIN is refused and the field clears; no sign-in. | FR-001 |
| UAT-03 | Create and advance to Planned | As Procurement, add a phone with brand, model and a launch date 120 days out; advance. | Model created at Research with today's date; advances without a gate. | FR-013, BR-011 |
| UAT-04 | Planned gate | Advance a Planned model with no SKUs; add a SKU with a blank code and advance; fill the code and advance. | Refused "No SKUs added yet"; refused "1 SKU missing a code"; then advances. | BR-012, FR-014 |
| UAT-05 | Ordered gate | Advance an Ordered model with no PO; add a PO; advance. | Refused "No PO number recorded"; then advances. | BR-013, FR-027 |
| UAT-06 | Production gate | As Catalog mark one SKU STP Required; as Warehouse leave it Not Sent and attempt to advance; set it Rejected and attempt; set it Completed and advance. | Refused "1 STP file not sent yet"; refused "1 STP file rejected"; then advances. | BR-014, BR-048, FR-031, FR-032 |
| UAT-07 | Received gate | Leave one SKU unconfirmed and attempt Live; confirm all, leave one marketplace not Live and attempt; set all Live and advance. | Refused "1 SKU not confirmed"; refused "Not live on <marketplace>"; then advances. | BR-016, FR-037, FR-043, FR-045 |
| UAT-08 | Undecided STP does not block | Leave every SKU's requirement undecided and move Production → Received. | The move succeeds; a warning alert names the undecided SKU count. | BR-015, FR-035, OQ-03 |
| UAT-09 | Report consistency | Create a model, bulk-paste a SKU with material `Leather` (off the hardcoded list), then compare the STP screen export, the Reports tab STP Requirement report, and the emailed report. | All three contain the same rows. **Against the current build the screen export omits the `Leather` row while the other two include it.** | AC-06, AUD-013, FR-034, FR-060 |
| UAT-10 | Bulk paste parsing | Paste a header line, a full line, a line with no units, a line with `5,000` units, and a blank line. | Header skipped; units defaulted from material; 5000 parsed as 5000; blank reported as skipped. | BR-033, FR-022 |
| UAT-11 | Role refusals | As Warehouse attempt to move a model to Received; as Sales attempt to edit SKUs; as Customer Care attempt to move anything. | Each refusal names the role and the action; the data remains visible; read-only notices name the responsible team. | FR-009, FR-011, FR-012 |
| UAT-12 | Permission matrix | As Admin remove `savePO` from Procurement and save; sign in as Procurement. | The PO field is read-only with a notice naming Procurement; the PO builder's assign control is withdrawn. | FR-007 |
| UAT-13 | Last-admin protection | As Admin, re-role the only admin account to Sales and save. | The change should be refused. **Against the current build it is accepted and user management becomes unreachable.** | AC-09, AUD-011, FR-008 |
| UAT-14 | Drag and drop parity | Drag a Planned model with a blank SKU code onto Ordered; drag any model two stages ahead; drag as a role that does not own the target. | No column highlights and no move occurs in all three cases. | FR-016, BR-003, BR-009 |
| UAT-15 | Bulk inward | Book in quantities for several models on the Inward screen; attempt bulk inward with unsaved edits; save, then bulk inward. | Bulk inward disabled while unsaved, with an explanatory tag; after saving, every ready model moves. | FR-038, FR-039, BR-059 |
| UAT-16 | Concurrency | Open the same model in two browsers; save in A, then save in B. | B's save is refused; A's change survives; B's local edit stays on screen; the refresh-required banner appears; further edits in B report they were not saved; refresh clears it. | AC-04, FR-069, UJ-06 |
| UAT-17 | Honest messaging offline | Clear the stored configuration and the build-time variables; sign in; make a change. | The local-only banner is shown and every save message states the change is tab-local and lost on refresh. | AC-05, FR-074, BR-099 |
| UAT-18 | Timeout handling | Point the configuration at an unroutable host; load. | The boot screen offers "continue offline" after a few seconds; an error appears within about 12 seconds; the login screen shows the warning and offers no demonstration accounts. | FR-002, FR-073 |
| UAT-19 | Import | Import a file containing a valid row, a bad date, a duplicate, and a quoted comma in a model name; with duplicate skipping on, then off. | Bad row listed and excluded; duplicate excluded then included; the quoted comma stays in one column; the result message names the counts. | FR-061, FR-062, BR-106, BR-108 |
| UAT-20 | Keyboard-only operation | Using only the keyboard: sign in, navigate the tabs, sort the list, open a model, close it with Escape, operate a dashboard to-do row, and set an STP requirement cell. | Everything is reachable and operable. **Against the current build the STP requirement cell cannot be operated.** | AC-07, AUD-015, NFR-024 |
| UAT-21 | Server-side authorization | With the public anonymous key, issue a direct request to delete a phone row and to read the users table, outside the application. | Both are refused. **Against the current build both succeed.** | AC-08, AUD-002, AUD-003 |
| UAT-22 | Migration safety | Follow the in-application setup instructions on a database that already contains models. | The operator is warned before any destructive step, and every referenced migration file exists. **Against the current build `schema.sql` drops the tables with no in-application warning, and `REPORT-EMAIL-SETUP.md` references a file that is not in the repository.** | AC-10, AUD-030, AUD-007 |
| UAT-23 | Email approval | Press Email MD / Factory; enter a wrong code; enter the correct code; re-use it; request four codes within an hour. | Wrong code refused with no email; correct code sends exactly one email to the configured recipients; re-use refused; the fourth request refused with a wait message; `report_send_log` records the outcome. | FR-036, FR-075, FR-076, BR-117, BR-118 |
| UAT-24 | Stock and reorder | On a Live model with 30 received, log 25 sold and 2 returned. | On hand 7, 23%, no reorder flag; log 2 more sold → 5 on hand, 17%, reorder flagged, alert raised, dashboard row and card updated. | FR-048, FR-049, FR-050, BR-053, BR-055 |
| UAT-25 | Un-Procurement | Move a Research model to Un-Procurement; check the calendar, reports and alerts; return it to Research. | No deadlines, no alerts, excluded from the calendar; a dedicated card and a funnel row appear; on return it resumes tracking with its dates intact. | FR-017, BR-002, BR-004, BR-006 |
| UAT-26 | Archive | Archive a model; check the board, dashboard, calendar and every report; restore it. | Absent everywhere until the Archived chip is used; restored to its original stage. | FR-018, BR-102 |
| UAT-27 | Audit trail | Perform a stage move, SKU save, PO change, STP update, receipt, listing change, sale and archive on one model, then open History. | Eight entries, each naming who, when and what. | FR-066, BR-100 |
| UAT-28 | Responsive layout | Load at 375 px width; use the tab strip, the board, a wide table and a form. | Tabs form one swipeable strip; tables scroll horizontally; forms are single-column; no content is clipped and the page does not scroll horizontally. | NFR-023 |
| UAT-29 | Reduced motion | Enable the operating system's reduced-motion setting and reload. | No slide, pulse or progress animation plays. | NFR-027 |
| UAT-30 | Attachment safety | Attach a link with a `javascript:` scheme and click it. | The link should be rejected at entry. **Against the current build it is stored and rendered.** | AUD-006, FR-065 |

---

## 18. Proposed implementation priorities and phases

`[PROPOSED]` Sequencing and effort bands are this audit's recommendation. **No
dates, no budget and no resourcing are proposed**, because none of the inputs
for those exist in the repository. Effort bands are relative: S ≈ under a day,
M ≈ a few days, L ≈ a week or more, for one developer familiar with the code.

### Phase 1 — Make it safe to hold real data

Rationale: every item here is either a security boundary that does not exist, or
a path to irrecoverable data loss. Nothing else should be built first.

| Order | Item | Closes | Effort |
| --- | --- | --- | --- |
| 1.1 | Replace PIN login with Supabase Auth; carry the role as an authenticated claim. | AUD-001, AUD-005, NFR-001, NFR-006, NFR-007 | L |
| 1.2 | Replace the open RLS policies with role-based read and write policies derived from `role_permissions`. Restrict `users` so PIN-equivalent material is never readable. | AUD-002, AUD-003, NFR-002, NFR-003 | L |
| 1.3 | Guard the last administrator against removal and demotion; add a documented recovery path. | AUD-011 | S |
| 1.4 | Remove the instruction to run `schema.sql` from the setup screen; add an explicit destructive warning; provide a non-destructive bootstrap script. | AUD-030 | S |
| 1.5 | Commit the documented GitHub Actions workflow running `npm run build` and `npm run check`; fix or remove the reference to the missing migration file. | AUD-007, NFR-036 | S |
| 1.6 | One shared STP requirement row-builder for all three outputs; drive the matrix columns from the materials present on the SKUs. | AUD-013, AC-06, RG-01 | M |
| 1.7 | Validate attachment URL schemes; neutralise spreadsheet formula injection in every export and in the email attachment. | AUD-006, NFR-008 | S |
| 1.8 | Add permission re-checks to every mutating handler, matching the pattern already used for receipts and STP requirement. | AUD-009 | S |

### Phase 2 — Make it safe to change

Rationale: Phase 1 adds security; Phase 2 adds the ability to keep it. Tests
come before the refactor, not after.

| Order | Item | Closes | Effort |
| --- | --- | --- | --- |
| 2.1 | Unit tests for every business rule in §6 — gates, transitions, dates, delay, runway, stock, sales, alerts, CSV parsing and all report builders — extending the existing self-check pattern. | AUD-021, NFR-031, RSK-07 | L |
| 2.2 | Add a linter and type checking (JSDoc-checked or TypeScript), wired into the workflow. | AUD-021, CON-08 | M |
| 2.3 | Split `src/App.jsx` by domain, behaviour-for-behaviour, under the tests from 2.1. | AUD-023, NFR-030 | L |
| 2.4 | Promote SKUs and sales entries to child tables with foreign keys; move to per-SKU writes. | AUD-004, AUD-012, AUD-018, NFR-019 | L |
| 2.5 | Clear the conflict latch on a successful single-model re-read, so a refresh of one model is enough. | AUD-008 | S |
| 2.6 | Preserve editor drafts across a save-triggered remount; extend background-read suppression to the Inward, STP and PO screens. | AUD-016, AUD-034, NFR-013 | M |
| 2.7 | Recompute the module-scope "today" on focus and at midnight. | AUD-031, NFR-040 | S |
| 2.8 | Batch bulk operations into one write and one message per action. | AUD-014 | M |
| 2.9 | Make the STP requirement cells real buttons; add a keyboard path for backward stage moves. | AUD-015, NFR-024, AC-07 | S |
| 2.10 | Audit note and attachment deletions; replace the silent 200-entry truncation with an append-only audit table. | AUD-024, NFR-032 | M |

### Phase 3 — Make it scale and observable

| Order | Item | Closes | Effort |
| --- | --- | --- | --- |
| 3.1 | Error reporting and a conflict/usage log. | AUD-026, NFR-034, RSK-15 | M |
| 3.2 | Paginate and field-select the synchronisation read; memoise the dashboard and report computations. | AUD-004, AUD-022, NFR-017, NFR-018 | M |
| 3.3 | Daily snapshot of stage counts and delay distribution, and a cycle-time report, so the milestone schedule can be validated and improvement demonstrated. | RG-01, RG-02, OQ-01 | M |
| 3.4 | Move marketplaces, materials, the reorder threshold and the stage schedule into a configuration table. | AUD-019, ASM-03, ASM-04 | M |
| 3.5 | Allow an audited edit of completion dates for historical backfill. | AUD-025, OQ-07 | S |
| 3.6 | Consume the email approval only after a successful send; allow a re-send against the same approval. | AUD-029, RSK-21 | S |
| 3.7 | Pin dependencies exactly; add `engines`; add dependency update and vulnerability scanning. | §14.1, RSK-20 | S |
| 3.8 | Report date ranges, an include-archived option, and sales history independent of stage. | RG-05, RG-06, RG-07 | M |
| 3.9 | Remove the dead `persistLegacy`, `money()` and `stage_summary` artefacts. | AUD-032 | S |
| 3.10 | Extend the reorder evaluation to Received-stage models; give short and nil delivery alerts a resolution path. | AUD-020, OQ-04 | M |

### Phase 4 — Business decisions, then scope

Nothing in Phase 4 can be scheduled until the corresponding open question is
answered. These are **not** recommendations to build; they are consequences of
answers that may come back.

| Item | Depends on |
| --- | --- |
| Spend approval workflow with value thresholds | OQ-02 |
| Supplier entity and supplier performance reporting | ASM-12, RG-03 |
| Per-role report and view restrictions | OQ-09 |
| Multiple POs per model | ASM-11 |
| Cost, margin and landed-cost tracking | RG-04 |
| Marketplace API integration | §5.2 |
| Retention and purge policy | OQ-12 |

---

## 19. Checks executed during this audit

This section records exactly what was run, with the actual results. Nothing
else was executed.

| ID | Check | Command | Result | Notes |
| --- | --- | --- | --- | --- |
| TST-001 | Permissions self-check | `npm run check` | **PASS** — printed `roles.js OK` | All assertions in `src/roles.selfcheck.mjs` passed. Emits a `MODULE_TYPELESS_PACKAGE_JSON` warning because `package.json` has no `"type": "module"`. This is the project's only automated test. |
| TST-002 | Production build | `npm run build` | **PASS** — 1500 modules transformed, built in 1.69 s | Output: `dist/index.html` 0.59 kB (0.41 kB gzipped); `dist/assets/index-CFAe8xUG.js` 328.65 kB (95.27 kB gzipped). Emits a deprecation warning for Vite's CJS Node API. Wrote to `dist/`, which is git-ignored. |
| TST-003 | Repository inventory | `find`, `ls`, `wc -l` | Complete | 4 source files (6,482 lines), 2 Edge Functions (115 lines), 5 SQL files, 2 Markdown documents, 4 configuration files. |
| TST-004 | Full source review | Line-by-line read | Complete | `src/App.jsx` (6,391), `src/roles.js` (86), `src/roles.selfcheck.mjs` (66), `src/main.jsx` (5), both Edge Functions, all five SQL files, `README.md`, `REPORT-EMAIL-SETUP.md`, `package.json`, `vite.config.js`, `index.html`, `supabase/config.toml`, `.claude/settings.local.json`. |
| TST-005 | Dead-code verification | `grep -n` for `persistLegacy`, `money`, `stage_summary` | Confirmed | `persistLegacy` defined at `src/App.jsx:5642`, never called. `money` defined at line 44, never called. `stage_summary` appears in `schema.sql` only, never in application code. |
| TST-006 | Permission-guard verification | `grep -n` for `CAN.` in handlers | Confirmed | `CAN.*` guards exist inside `addPhone`, `importPhones`, `saveReceipt`, `setStpRequired` and `bulkReceive` only. `logSale`, `saveSKU`, `savePO`, `updateSTP`, `saveListings`, `assignPO`, `addNote`, `addAttachment`, `setArchived` and `resetAll` have none. |
| TST-007 | Last-admin guard verification | `grep -n 'list.length <= 1'` | Confirmed | `src/App.jsx:5082` is the only guard; it tests the total account count, not the admin count. |
| TST-008 | STP material-source verification | `grep -n MATERIAL_NAMES` | Confirmed | Used at `src/App.jsx:4325`, `4372`, `4378`, `4397` — the matrix and its export. The Reports tab (`4892`) and the Edge Function (`send-stp-report/index.ts:34`) group by the stored material instead. |
| TST-009 | Deployment artefact verification | `ls -la .github` | **Absent** | `ls: cannot access '.github': No such file or directory`. |
| TST-010 | Documented migration verification | `ls`, `grep` | **Absent** | `REPORT-EMAIL-SETUP.md:7` instructs running after `schema-pin-login-rollback.sql`; no such file exists in the repository. |
| TST-011 | Office automation availability | PowerShell COM probe | **PASS** | Word 16.0 and PowerPoint 16.0 available — used to generate the DOCX and PPTX deliverables. |
| TST-012 | Git baseline | `git log -1`, `git status --porcelain` | Confirmed | Baseline `afad51c`; working tree clean apart from untracked `deliverables/` and `.presentation-build/`. |

### 19.1 Checks deliberately not run

| Check | Reason |
| --- | --- |
| Linting | No linter is configured in the project (`README.md` states this). |
| Type checking | No type checker is configured. |
| Unit tests beyond TST-001 | None exist. |
| Database migrations | Explicitly out of scope for this audit, and `schema.sql` is destructive. |
| Any Supabase read or write | No project credentials were used; `.env.local` was deliberately not opened or printed. |
| Edge Function deployment or invocation | Would require deployment and would consume a paid email service. |
| Email send | Paid integration; would email real configured recipients. |
| Runtime browser testing | No deployed instance and no database were available. |
| Concurrency testing | Requires a live database and two sessions. |
| Accessibility audit tooling | Requires a running instance. |
| Load or performance testing | Requires a running instance and representative data. |
| Penetration testing | Requires authorisation and a target environment. |

---

## 20. Audit limitations

These bound every conclusion in this document and in the companion audit report.

1. **No runtime environment.** No Supabase project, no deployed application and
   no browser session were available. Everything except TST-001 and TST-002 is
   static analysis. Statements about concurrency behaviour, row-level security
   effects, email delivery and accessibility in practice are inferences from
   code and SQL, not observations.
2. **Database state unknown.** Whether the five SQL files have been applied to
   the live project, in what order, and whether the live schema matches them,
   could not be determined. The schema files describe intent.
3. **Deployment state unknown.** `README.md` links a live GitHub Pages URL, but
   the workflow that would publish it is not in the repository. How the live
   instance is built and deployed is unknown (OQ-10).
4. **Server configuration unknown.** The seven Edge Function secrets, including
   the approver and recipient lists, are server-side and were not read.
5. **No business stakeholder input.** Every objective, benefit, KPI target and
   priority in this document is inferred from code or proposed by this audit.
   Nothing has been confirmed by a business owner.
6. **Credentials not inspected.** `.env.local` exists in the working directory
   and was deliberately not opened. No credential, token or key value appears
   anywhere in these deliverables.
7. **Excluded from line-by-line review:** `node_modules/` (dependencies),
   `dist/` (build output, regenerated by TST-002), `package-lock.json`
   (generated, 57 kB), `.presentation-build/` previews (binary PNG),
   `deliverables/*.pptx` and `*.pdf` (pre-existing binary artefacts from an
   earlier presentation exercise, unrelated to the application), and the inline
   SVG favicon data URI in `index.html`. The `CSS` template literal in
   `src/App.jsx` (lines 908–1201) was reviewed for responsive, theming,
   motion-preference and disabled-state behaviour rather than property by
   property.
8. **Pre-existing deliverables not validated.** `deliverables/` already
   contained three PPTX/PDF pairs dated 6 November 2026 from an earlier scope
   and KRA/KPI exercise. Their content was not reviewed, reconciled or
   superseded by this audit, and they are listed in `deliverables/README.md` as
   pre-existing.
9. **Severity, likelihood and priority are this audit's judgement**, not an
   organisational risk assessment, and they assume the data has at least some
   commercial sensitivity. OQ-13 governs that assumption.

---

## 21. Traceability matrix

Requirement → implementation evidence → test coverage → audit finding → UAT
scenario. "—" in the test column means **no automated test exists**, which is
the case for every row except the permission module.

| FR | Business rules | Implementation evidence | Automated test | Audit findings | UAT |
| --- | --- | --- | --- | --- | --- |
| FR-001 | BR-081 | `src/App.jsx:5382-5517`, `423-427` | — | AUD-001, AUD-005 | UAT-01, UAT-02 |
| FR-002 | — | `src/App.jsx:6120-6132`, `5414-5436` | — | — | UAT-18 |
| FR-003 | BR-086 | `src/App.jsx:689-712` | — | AUD-005 | UAT-01 |
| FR-004 | BR-085 | `src/App.jsx:5599-5608` | — | — | UAT-01 |
| FR-005 | — | `src/App.jsx:5701-5704` | — | — | UAT-01 |
| FR-006 | BR-074, BR-076, BR-077, BR-078 | `src/roles.js:60-85`; `src/App.jsx:5584-5595` | **TST-001** | — | UAT-12 |
| FR-007 | BR-073, BR-075 | `src/App.jsx:5177-5252`, `6343-6353` | **TST-001** (lock only) | AUD-010 | UAT-12 |
| FR-008 | BR-080, BR-082, BR-083, BR-084 | `src/App.jsx:5025-5256`, `6354-6379` | — | AUD-011 | UAT-13 |
| FR-009 | — | `src/App.jsx:1701-1707`, `6310` | — | — | UAT-11 |
| FR-010 | — | `src/App.jsx:6236-6242`, `6089-6093` | — | — | UAT-11 |
| FR-011 | BR-009, BR-010 | `src/App.jsx:462-481`, `561-565`, `584-621` | — | AUD-002 | UAT-11, UAT-14, UAT-21 |
| FR-012 | — | `src/roles.js:34-47`; `schema-roles.sql:73-78` | **TST-001** | — | UAT-11 |
| FR-013 | BR-109 | `src/App.jsx:3294-3423`, `6089-6101` | — | AUD-009 | UAT-03 |
| FR-014 | BR-003, BR-008, BR-009, BR-010, BR-018 | `src/App.jsx:503-540`, `567-577`, `5765-5813` | — | — | UAT-04 – UAT-07 |
| FR-015 | BR-007 | `src/App.jsx:584-621`, `5788` | — | AUD-015 | UAT-14, UAT-25 |
| FR-016 | BR-009 | `src/App.jsx:1405-1418`, `1482-1488` | — | AUD-015 | UAT-14 |
| FR-017 | BR-002, BR-004, BR-005, BR-006 | `src/App.jsx:2915-2922`, `593-606` | — | — | UAT-25 |
| FR-018 | BR-102 | `src/App.jsx:2923-2930`, `6054-6063` | — | AUD-009, RG-07 | UAT-26 |
| FR-019 | — | `src/App.jsx:1217-1249`, `6005-6012`, `872-875` | — | AUD-009 | — |
| FR-020 | — | `src/App.jsx:626-656`, `1304-1399` | — | — | UAT-26 |
| FR-021 | BR-028 – BR-032 | `src/App.jsx:1715-1863`, `5832-5839` | — | AUD-009 | UAT-04 |
| FR-022 | BR-033, BR-035 | `src/App.jsx:1728-1748` | — | AUD-013 | UAT-09, UAT-10 |
| FR-023 | BR-112 | `src/App.jsx:1907-1945`, `3445-3468` | — | AUD-006, AUD-035 | — |
| FR-024 | BR-034 | `src/App.jsx:111-125`, `781` | — | AUD-012 | — |
| FR-025 | BR-031 | `src/App.jsx:1762`, `2800-2811` | — | OQ-15 | — |
| FR-026 | BR-037, BR-038 | `src/App.jsx:4651-4788`, `5959-5966` | — | AUD-009, OQ-02 | UAT-05 |
| FR-027 | BR-036 | `src/App.jsx:1868-1901`, `5968-5975` | — | AUD-009 | UAT-05, UAT-12 |
| FR-028 | — | `src/App.jsx:4676-4686`, `4790-4847` | — | — | — |
| FR-029 | BR-040, BR-041, BR-042 | `src/App.jsx:4498-4641`, `5885-5956` | — | AUD-027 | — |
| FR-030 | BR-100 | `src/App.jsx:5961`, `5931`, `147-158` | — | AUD-024 | UAT-27 |
| FR-031 | BR-043, BR-045, BR-046 | `src/App.jsx:4287-4432`, `5854-5869` | — | AUD-013, AUD-014, AUD-015 | UAT-06, UAT-09, UAT-20 |
| FR-032 | BR-047, BR-048 | `src/App.jsx:1952-2042`, `5843-5852` | — | AUD-009 | UAT-06 |
| FR-033 | BR-044 | `src/roles.js:13-14`, `31-33`; `src/App.jsx:6302` | **TST-001** | — | UAT-11 |
| FR-034 | BR-050 | `src/App.jsx:4323-4335` | — | **AUD-013** | UAT-09 |
| FR-035 | BR-015, BR-070 | `src/App.jsx:230-236`, `373-374`, `520-521` | — | OQ-03 | UAT-08 |
| FR-036 | BR-114 – BR-125 | `src/App.jsx:4437-4495`, `845-866` | — | AUD-029, OQ-08 | UAT-23 |
| FR-037 | BR-051, BR-052 | `src/App.jsx:2049-2162`, `5977-5992` | — | — | UAT-07 |
| FR-038 | BR-057, BR-058 | `src/App.jsx:4041-4277` | — | AUD-016 | UAT-15 |
| FR-039 | BR-059 | `src/App.jsx:4092-4102`, `4165-4179` | — | AUD-014 | UAT-15 |
| FR-040 | BR-017, BR-052 | `src/App.jsx:376-380`, `237`, `4903-4909` | — | AUD-020, OQ-04 | UAT-07 |
| FR-041 | — | `src/App.jsx:4104-4114` | — | AUD-006 | — |
| FR-042 | — | `src/App.jsx:5745-5747`, `6150-6164` | — | — | UAT-15 |
| FR-043 | BR-060, BR-061, BR-062, BR-066 | `src/App.jsx:2169-2297`, `5871-5882` | — | AUD-009 | UAT-07 |
| FR-044 | BR-063, BR-066 | `src/App.jsx:3860-4022` | — | AUD-014 | UAT-07 |
| FR-045 | BR-016 | `src/App.jsx:530-546` | — | — | UAT-07 |
| FR-046 | BR-063 | `src/App.jsx:5741`, `6150-6164` | — | — | — |
| FR-047 | — | `src/App.jsx:3749-3783`, `3689-3694` | — | AUD-022 | — |
| FR-048 | BR-054 | `src/App.jsx:2480-2508`, `5994-6003` | — | **AUD-009**, AUD-018 | UAT-24 |
| FR-049 | BR-053, BR-054 | `src/App.jsx:184-205`, `2531-2571` | — | AUD-018 | UAT-24 |
| FR-050 | BR-055, BR-056 | `src/App.jsx:177-214`, `3705-3710` | — | AUD-020 | UAT-24 |
| FR-051 | — | `src/App.jsx:251-270`, `2515-2529` | — | RG-06 | UAT-24 |
| FR-052 | BR-067 | `src/App.jsx:3579-3591`, `5750-5754` | — | AUD-022 | — |
| FR-053 | — | `src/App.jsx:3517-3537`, `3637-3715` | — | AUD-022 | — |
| FR-054 | BR-002 | `src/App.jsx:3567-3571`, `3721-3806` | — | — | UAT-25 |
| FR-055 | BR-067 – BR-072 | `src/App.jsx:3809-3847`, `342-403` | — | AUD-020, AUD-022 | UAT-08 |
| FR-056 | BR-102 | `src/App.jsx:2946-3053` | — | — | UAT-25, UAT-26 |
| FR-057 | BR-111 | `src/App.jsx:4856-5017` | — | AUD-022, RG-05, RG-07 | UAT-09 |
| FR-058 | BR-112 | `src/App.jsx:3438-3468` | — | AUD-006, AUD-035 | UAT-09 |
| FR-059 | BR-112 | `src/App.jsx:1908`, `2201`, `4104`, `4334`, `3897`, `4681` | — | AUD-006 | UAT-09 |
| FR-060 | BR-050, BR-125 | `src/App.jsx:4323-4335` vs `4886-4902` vs `send-stp-report/index.ts:32-36` | — | **AUD-013** | **UAT-09** |
| FR-061 | BR-103 – BR-110 | `src/App.jsx:3060-3268`, `6065-6087` | — | AUD-028 | UAT-19 |
| FR-062 | BR-099 | `src/App.jsx:6079-6086` | — | — | UAT-19 |
| FR-063 | BR-113 | `src/App.jsx:3066-3080` | — | — | UAT-19 |
| FR-064 | — | `src/App.jsx:2347-2391`, `6014-6032` | — | AUD-009, AUD-024 | UAT-27 |
| FR-065 | — | `src/App.jsx:168-175`, `2393-2449` | — | **AUD-006**, AUD-024 | UAT-30 |
| FR-066 | BR-100 | `src/App.jsx:142-158`, `2452-2469` | — | AUD-024 | UAT-27 |
| FR-067 | — | `src/App.jsx:147-166`, `2375` | — | — | UAT-27 |
| FR-068 | BR-092, BR-099 | `src/App.jsx:5658-5695` | — | AUD-017 | UAT-17 |
| FR-069 | BR-087, BR-088, BR-089, BR-093 | `src/App.jsx:828-837`, `5673-5683`; `schema.sql:48-58` | — | AUD-008 | **UAT-16** |
| FR-070 | BR-090, BR-091 | `src/App.jsx:811-827`, `3275-3287` | — | — | — |
| FR-071 | BR-094, BR-096 | `src/App.jsx:5575-5639` | — | AUD-004, NFR-018 | UAT-16 |
| FR-072 | BR-095 | `src/App.jsx:5575-5620` | — | AUD-016, AUD-034 | — |
| FR-073 | BR-097, BR-098 | `src/App.jsx:665-666`, `731-757`, `6117` | — | — | UAT-18 |
| FR-074 | BR-099 | `src/App.jsx:6166-6196`, `6247-6273`, `5706-5724` | — | AUD-017 | UAT-17 |
| FR-075 | BR-115 – BR-119, BR-123, BR-124 | `request-stp-report-approval/index.ts`; `schema-report-approval.sql:36-50` | — | AUD-033 | UAT-23 |
| FR-076 | BR-117, BR-122, BR-123, BR-125 | `send-stp-report/index.ts`; `schema-report-approval.sql:52-69` | — | AUD-029 | UAT-23 |
| FR-077 | BR-121 | `schema-report-approval.sql:31-34`, `71-74` | — | — | UAT-21 |
| FR-078 | BR-120 | `send-stp-report/index.ts:7-9`, `17`, `29` | — | AUD-006 | UAT-23 |
| FR-079 | — | `src/App.jsx:5264-5346`, `6104-6109` | — | **AUD-030** | UAT-22 |
| FR-080 | — | `src/App.jsx:668-687` | — | — | UAT-17 |
| FR-081 | — | all five SQL files; `src/App.jsx:5332-5338` | — | **AUD-030, AUD-007** | **UAT-22** |
| FR-082 | — | `README.md`; `package.json:5-9`; absence of `.github/` | **TST-002** (build only) | **AUD-007** | UAT-22 |
| FR-083 | — | `supabase/config.toml`; `REPORT-EMAIL-SETUP.md:29-38` | — | AUD-033 | UAT-23 |

### 21.1 Coverage summary

| Dimension | Count | Note |
| --- | --- | --- |
| Functional requirements documented | 83 existing + 16 recommended | |
| Business rules documented | 125 | |
| Non-functional requirements documented | 40 | |
| Requirements with any automated test coverage | **4 of 83** (FR-006, FR-007 partially, FR-012, FR-033) | All via TST-001, all in `src/roles.js` |
| Requirements verified at runtime | **2 of 83** (FR-082 build only, plus NFR-015/016/037 measured) | TST-002 |
| Requirements with an open business question | 11 | OQ-01 to OQ-15 |
| Requirements that are `PARTIAL` or worse | 24 | |
| NFRs explicitly **NOT MET** | 8 | NFR-001, 002, 003, 006, 030, 031, 034, 036 |
| UAT scenarios expected to fail against the current build | 6 | UAT-09, UAT-13, UAT-20, UAT-21, UAT-22, UAT-30 |

---

## 22. Approval and sign-off

> ### ⚠ STATUS: PENDING — NOT APPROVED
>
> **No approval has been sought, given or recorded.** This document was produced
> by reverse-engineering an existing codebase. The signature block below is a
> template for a review that has not taken place. Every row is unsigned and
> every date is blank by design.
>
> Signing this document should be understood as confirming three things:
> that the functional requirements in §7 describe what the business actually
> wants, that the inferred objectives in §2.3 and the open questions in §15 have
> been answered, and that the risks in §16 are accepted or scheduled.

| Role | Name | Responsibility | Signature | Date |
| --- | --- | --- | --- | --- |
| Business sponsor / MD | _pending_ | Confirms §2 objectives, §16 risk acceptance, OQ-02, OQ-09, OQ-11, OQ-13 | ☐ | ______ |
| Procurement lead | _pending_ | Confirms M3–M5 requirements, OQ-01, OQ-05, OQ-06, OQ-07, OQ-14, OQ-15 | ☐ | ______ |
| Warehouse lead | _pending_ | Confirms M6 STP status requirements | ☐ | ______ |
| Catalog lead | _pending_ | Confirms M6–M8 requirements, OQ-03, OQ-04, OQ-08 | ☐ | ______ |
| Sales lead | _pending_ | Confirms M9 requirements | ☐ | ______ |
| Technical owner / maintainer | _pending_ | Confirms §4 current state, §14 constraints, §18 phases, OQ-10 | ☐ | ______ |
| QA owner | _pending_ | Confirms §17 acceptance criteria and UAT scope | ☐ | ______ |

### 22.1 Conditions recommended before sign-off

1. Answer OQ-13 (data sensitivity). It determines whether Phase 1 is urgent
   remediation or planned work, and therefore whether this document can be
   signed as-is.
2. Answer OQ-01 and OQ-06. Until the milestone schedule and the lateness
   tolerance are confirmed, KPI-02 and KPI-03 cannot be reported against.
3. Answer OQ-10. The release process must be known before any remediation can
   be deployed.
4. Confirm or correct the inferred objectives in §2.3. They are the only
   statement of purpose in this document that did not come from the code, and
   every KPI target proposal in §12.2 depends on them.

### 22.2 Document control

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 1.0 | 17 Nov 2026 | Repository audit | Initial issue. Baseline commit `afad51c`. Status: draft, pending review. |

---

*End of Business Requirements Document. Companion documents:
`deliverables/Project_Audit_Report.md` (findings in full),
`deliverables/Project_Presentation.pptx` (stakeholder briefing),
`deliverables/README.md` (how to use this set).*
