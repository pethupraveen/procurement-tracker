import React, { useState, useMemo, useEffect } from "react";
import { Plus, X, Sun, Moon, Package, CheckCircle2, Circle, AlertTriangle, LayoutGrid, List, BarChart2, FileText } from "lucide-react";

/* ═══════════════════════════════════════════════════════════════
   NEW MODEL PROCUREMENT TRACKER — simple version

   The whole business loop, and nothing else:
     1. Spot a new phone     -> add it
     2. Research  → note the phone, no covers yet
     3. Planned   → choose covers, set SKU + material
     4. Ordered   → every SKU must be assigned first
     5. Production → export STP file, track STP status
     6. Received  → tick each cover received or not
     7. Live      → only when all received covers confirmed
     4. See what's running late

   Read this file top to bottom. It's in dependency order:
     helpers -> stages -> data -> derive -> UI
   ═══════════════════════════════════════════════════════════════ */


/* ── 1. DATE HELPERS ─────────────────────────────────────────────
   Everything is a plain "YYYY-MM-DD" string. No date library.      */

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const iso   = (d) => d.toISOString().slice(0, 10);
const shift = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return iso(d); };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const daysFromToday = (date) => daysBetween(iso(TODAY), date);
const showDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
const money = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const qty   = (n) => Math.round(n).toLocaleString("en-IN");


/* ── 2. THE SIX STAGES ───────────────────────────────────────────
   Every model walks this path in order. `daysBeforeLaunch` is when
   the stage SHOULD be done, counting back from the phone's launch
   date. That single number is what makes delay detection work:

        planned date = launch date - daysBeforeLaunch
        delay        = actual date - planned date                   */

const STAGES = [
  { key: "research",   label: "Research",   daysBeforeLaunch: 100, hint: "Found the phone. Deciding if it's worth it." },
  { key: "planned",    label: "Planned",    daysBeforeLaunch:  85, hint: "Decided to buy. Covers and quantities chosen." },
  { key: "ordered",    label: "Ordered",    daysBeforeLaunch:  75, hint: "Purchase order sent to the supplier." },
  { key: "production", label: "Production", daysBeforeLaunch:  60, hint: "Supplier is manufacturing the covers." },
  { key: "received",   label: "Received",   daysBeforeLaunch:  25, hint: "Stock arrived, checked, in the warehouse." },
  { key: "live",       label: "Live",       daysBeforeLaunch:   0, hint: "Listed and selling on the marketplaces." },
];
const stageIndex = (key) => STAGES.findIndex((s) => s.key === key);


/* ── 3. OPPORTUNITY SCORE REMOVED ─────────────────────────────── */


/* ── 4. THE DATA ─────────────────────────────────────────────────
   Eight phone models spread across all six stages, so every state
   is visible. In the real app this comes from the database.

   `done` records WHEN each stage was actually finished. Compare it
   against the planned date to get the delay. Stages not in `done`
   haven't happened yet.                                            */

/* A cover TYPE (e.g. "Silicone Cover") holds a LIST of SKUs.
   One silicone cover can have many SKUs — one per colour, finish or
   variant — and each SKU carries its own material and unit count.  */

/* The four places these covers actually sell */
const MARKETPLACES = ["Flipkart", "Amazon", "Meesho", "Shopify"];

/* Materials you actually buy. Edit this one array to change the
   dropdown everywhere it appears.                               */
/* The four materials you actually order, each with the quantity you
   normally book. Picking a material fills the units for you — you can
   always type over it.                                                */
const MATERIALS = [
  { name: "TPU+PC",           defaultQty: 50 },
  { name: "Silicone Cover",   defaultQty: 30 },
  { name: "TPU+PC+MSF",       defaultQty: 50 },
  { name: "Silicone MagSafe", defaultQty: 30 },
];
const MATERIAL_NAMES = MATERIALS.map((m) => m.name);
const defaultQtyFor  = (name) => MATERIALS.find((m) => m.name === name)?.defaultQty ?? 0;

let _skuSeq = 0;
const skuRow = (sku = "", material = "", units = 0) => ({
  rid: ++_skuSeq,            // stable React key, never shown to the user
  sku, material, units,
  stpStatus: "Not Sent",     // STP file is tracked per SKU, not per phone
  receivedQty: null,         // how many actually arrived
  receiptState: null,        // null = unconfirmed | "full" | "short" | "none"
  /* Listing runs per SKU per marketplace — a colour can be live on
     Flipkart and still stuck in Amazon's catalogue queue.          */
  listings: Object.fromEntries(MARKETPLACES.map((mp) => [mp, "Not listed"])),
});

const LISTING_STATES = ["Not listed", "In progress", "Live", "Blocked"];
const listingTone = (st) =>
  st === "Live" ? "ok" : st === "Blocked" ? "bad" : st === "In progress" ? "warn" : undefined;

/* A SKU is fully listed when every marketplace says Live. */
const isFullyListed = (r) => MARKETPLACES.every((mp) => r.listings?.[mp] === "Live");
const liveCount     = (r) => MARKETPLACES.filter((mp) => r.listings?.[mp] === "Live").length;
const blockedCount  = (r) => MARKETPLACES.filter((mp) => r.listings?.[mp] === "Blocked").length;

const STP_STATUSES  = ["Not Sent", "Submitted", "Acknowledged", "In Progress", "Completed", "Rejected"];
const stpTone = (st) => st === "Completed" ? "ok" : st === "Rejected" ? "bad" : st === "Not Sent" ? undefined : "warn";

/* A SKU is settled once someone has said what happened to it. */
const isConfirmed = (r) => r.receiptState != null;
const shortfallOf = (r) => Math.max(0, (r.units || 0) - (r.receivedQty || 0));
const receiptLabel = (r) =>
  r.receiptState === "full"  ? "Received in full" :
  r.receiptState === "short" ? "Short" :
  r.receiptState === "none"  ? "Not received" : "Pending";

/* Every phone holds one flat list of SKUs. Each SKU carries its own
   material and unit count — that's the whole structure.              */
const allSkus = (model) => model.skus || [];

/* Each sales entry: { rid, date, marketplace, units, revenue, returns, notes }
   Accumulated on the phone — never overwritten, always appended.      */
const SALE_MARKETPLACES = ["Flipkart", "Amazon", "Meesho", "Shopify"];

function salesSummary(entries) {
  if (!entries || !entries.length)
    return { total: 0, revenue: 0, returns: 0, d7: 0, d30: 0, byMarketplace: {} };
  const cut7  = new Date(Date.now() -  7 * 864e5);
  const cut30 = new Date(Date.now() - 30 * 864e5);
  let total = 0, revenue = 0, returns = 0, d7 = 0, d30 = 0;
  const byMp = {};
  entries.forEach((e) => {
    const d = new Date(e.date);
    total   += e.units   || 0;
    revenue += e.revenue || 0;
    returns += e.returns || 0;
    if (d >= cut7)  d7  += e.units || 0;
    if (d >= cut30) d30 += e.units || 0;
    const mp = e.marketplace || "All";
    byMp[mp] = (byMp[mp] || 0) + (e.units || 0);
  });
  const returnRate = total > 0 ? ((returns / total) * 100).toFixed(1) : "0.0";
  return { total, revenue, returns, returnRate, d7, d30, byMarketplace: byMp };
}

/* No demo data — start empty so you can enter your real phones */
const EMPTY = [];


/* ── 5. DERIVED VALUES ───────────────────────────────────────────
   Nothing below is stored. It's all calculated from the data above,
   every time. That means it can never go stale or disagree.        */

/* When a stage SHOULD be finished.

   Counted back from the launch date — but never earlier than the day you
   added the phone, because you can't be late for something you didn't know
   existed. Spot a phone 30 days before launch and everything is due at once,
   which is honest: you really are in trouble.                              */
function plannedDate(model, stageKey) {
  const fromLaunch = shift(model.launch, -STAGES[stageIndex(stageKey)].daysBeforeLaunch);
  const dayAdded   = model.done.research || iso(TODAY);
  return fromLaunch < dayAdded ? dayAdded : fromLaunch;
}

/* how late a stage is, in days. 0 or less = on time */
function delayOf(model, stageKey) {
  const planned = plannedDate(model, stageKey);
  const actual  = model.done[stageKey];
  if (actual) return daysBetween(planned, actual);           // finished: compare to plan
  const overdue = daysBetween(planned, iso(TODAY));          // not finished: how overdue now
  return overdue > 0 ? overdue : 0;
}

/* How many days you actually have, versus the ~100 the full process wants.
   Spot a phone 30 days before launch and you're compressed — the app should
   say so rather than silently stacking every deadline onto today.          */
function runwayOf(model) {
  const dayAdded = model.done.research || iso(TODAY);
  const have = daysBetween(dayAdded, model.launch);
  return { have, need: STAGES[0].daysBeforeLaunch, isRushed: have < STAGES[0].daysBeforeLaunch };
}

function derive(model) {
  const index = stageIndex(model.stage);


  /* the worst delay across every stage up to where we are now */
  const worstDelay = Math.max(0, ...STAGES.slice(0, index + 2).map((s) => delayOf(model, s.key)));

  return {
    ...model,
    index,
    units: allSkus(model).reduce((sum, r) => sum + (r.units || 0), 0),
    progress: Math.round(((index + 1) / STAGES.length) * 100),
    runway: runwayOf(model),
    daysToLaunch: daysFromToday(model.launch),
    worstDelay,
    isLate: worstDelay > 3,
    sales: salesSummary(model.salesEntries),
  };
}

/* problems worth showing at the top of the screen */
/* Single source of truth for every alert in the app.
   Board cards, the Dashboard panel, and any future notification
   system all call this — nothing generates alerts independently. */
function problemsOf(model) {
  const ps = [];
  const push = (type, text) => ps.push({ model, type, text });

  if (model.isLate)
    push("bad", `+${model.worstDelay}d behind schedule`);

  if (model.stage !== "live" && model.daysToLaunch != null
      && model.daysToLaunch >= 0 && model.daysToLaunch <= 14)
    push("warn", `Launches in ${model.daysToLaunch} day${model.daysToLaunch === 1 ? "" : "s"} — still at ${STAGES[model.index].label}`);

  if (model.stage === "planned" && allSkus(model).length === 0)
    push("warn", "No SKUs planned yet");

  if (model.stage === "planned" && allSkus(model).some((r) => !r.sku?.trim()))
    push("warn", "SKU still blank — can't move to Ordered");

  if (model.stage === "ordered" && !model.po)
    push("warn", "No PO number recorded");

  if (model.stage === "production" && allSkus(model).some((r) => !r.stpStatus || r.stpStatus === "Not Sent"))
    push("warn", "STP file not sent yet");

  if (model.stage === "production" && allSkus(model).some((r) => r.stpStatus === "Rejected"))
    push("bad", "STP file rejected on one or more SKUs");

  if (allSkus(model).some((r) => r.receiptState === "short"))
    push("warn", `Short delivery — ${qty(allSkus(model).reduce((s, r) => s + shortfallOf(r), 0))} units missing`);

  if (allSkus(model).some((r) => r.receiptState === "none"))
    push("bad", "One or more SKUs never arrived");

  if (allSkus(model).some((r) => blockedCount(r) > 0))
    push("bad", "Listing blocked on a marketplace");

  if (model.stage === "live" && allSkus(model).some((r) => !isFullyListed(r)))
    push("warn", `Live but not fully listed — ${allSkus(model).filter((r) => !isFullyListed(r)).length} SKU(s) incomplete`);

  return ps;
}



/* ── USERS, ROLES & PERMISSIONS ──────────────────────────────────
   Each user has a name, role, and a PIN (stored as a simple hash
   so the plain text is never kept in state).

   Default accounts — change PINs via the Admin panel:
     admin       / 1234
     procurement / 1111
     warehouse   / 2222
     catalog     / 3333
     sales       / 4444

   PINs are hashed with a tiny djb2 function — good enough to avoid
   storing plain text; not a security guarantee for production use.
   ─────────────────────────────────────────────────────────────── */

const hashPin = (pin) => {
  let h = 5381;
  for (let i = 0; i < pin.length; i++) h = (h * 33) ^ pin.charCodeAt(i);
  return (h >>> 0).toString(36);
};

const DEFAULT_USERS = [
  { id: "u1", name: "Arjun (Admin)",       role: "admin",       pin: hashPin("1234"), avatar: "A" },
  { id: "u2", name: "Priya (Procurement)", role: "procurement", pin: hashPin("1111"), avatar: "P" },
  { id: "u3", name: "Ravi (Warehouse)",    role: "warehouse",   pin: hashPin("2222"), avatar: "R" },
  { id: "u4", name: "Sunita (Catalog)",    role: "catalog",     pin: hashPin("3333"), avatar: "S" },
  { id: "u5", name: "Kiran (Sales)",       role: "sales",       pin: hashPin("4444"), avatar: "K" },
];

const ROLES = [
  { key: "admin",       label: "Admin",       color: "var(--bad)"    },
  { key: "procurement", label: "Procurement", color: "var(--accent)"  },
  { key: "warehouse",   label: "Warehouse",   color: "var(--warn)"   },
  { key: "catalog",     label: "Catalog",     color: "var(--ok)"     },
  { key: "sales",       label: "Sales",       color: "var(--dim)"    },
];

const ROLE_CAN_ADVANCE_TO = {
  admin:       ["planned","ordered","production","received","live"],
  procurement: ["planned","ordered"],
  warehouse:   ["production","received","live"],
  catalog:     [],
  sales:       [],
};

const CAN = {
  addPhone:    (r) => ["admin","procurement"].includes(r),
  editResearch:(r) => ["admin","procurement"].includes(r),
  editSKUs:    (r) => ["admin","procurement"].includes(r),
  savePO:      (r) => ["admin","procurement"].includes(r),
  updateSTP:   (r) => ["admin","warehouse"].includes(r),
  saveReceipt: (r) => ["admin","warehouse"].includes(r),
  saveListing: (r) => ["admin","catalog"].includes(r),
  logSales:    (r) => ["admin","sales"].includes(r),
  manageUsers: (r) => r === "admin",
  reset:       (r) => r === "admin",
};



/* ── ADVANCE LOGIC — one source of truth ─────────────────────────
   gateBlock()     — is the DATA ready to move on? returns a reason or null
   advanceStatus() — combines the data gate with the role permission.
   Used by the Detail footer, the board's quick-advance button, and the
   "Needs my action" filter, so all three can never disagree.       */

function gateBlock(model) {
  if (model.stage === "planned") {
    if (allSkus(model).length === 0) return "No SKUs added yet";
    const missing = allSkus(model).filter((r) => !r.sku?.trim());
    if (missing.length) return `${missing.length} SKU${missing.length > 1 ? "s" : ""} missing a code`;
  }
  if (model.stage === "received") {
    const unconf = allSkus(model).filter((r) => !isConfirmed(r));
    if (unconf.length) return `${unconf.length} SKU${unconf.length > 1 ? "s" : ""} not confirmed`;
  }
  return null;
}

function advanceStatus(model, role) {
  const next = STAGES[model.index + 1];
  if (!next) return { ok: false, next: null, reason: "Already live" };
  if (role && role !== "none" && !ROLE_CAN_ADVANCE_TO[role]?.includes(next.key))
    return { ok: false, next, reason: `${ROLES.find(r => r.key === role)?.label} can't move to ${next.label}` };
  const block = gateBlock(model);
  if (block) return { ok: false, next, reason: block };
  return { ok: true, next, reason: null };
}

/* ── SEARCH & SORT ──────────────────────────────────────────────── */

/* Matches brand, model name, PO, or any SKU code / material */
function matchesSearch(model, q) {
  if (!q?.trim()) return true;
  const t = q.trim().toLowerCase();
  if (`${model.brand} ${model.name}`.toLowerCase().includes(t)) return true;
  if ((model.po || "").toLowerCase().includes(t)) return true;
  if (model.segment?.toLowerCase().includes(t)) return true;
  return allSkus(model).some((r) =>
    (r.sku || "").toLowerCase().includes(t) || (r.material || "").toLowerCase().includes(t));
}

/* Late first, then soonest launch. Puts what needs attention on top. */
function byUrgency(a, b) {
  if (a.isLate !== b.isLate) return a.isLate ? -1 : 1;
  const da = a.daysToLaunch ?? 9999, db = b.daysToLaunch ?? 9999;
  return da - db;
}

/* One place that decides whether a model survives the active filters */
function passesFilters(model, f, role) {
  if (!matchesSearch(model, f.q)) return false;
  if (f.needsAction && !advanceStatus(model, role).ok) return false;
  if (f.lateOnly && !model.isLate) return false;
  if (f.soonOnly && !(model.daysToLaunch != null && model.daysToLaunch >= 0 && model.daysToLaunch <= 30)) return false;
  if (f.brand && model.brand !== f.brand) return false;
  return true;
}

const EMPTY_FILTERS = { q: "", needsAction: false, lateOnly: false, soonOnly: false, brand: "" };

/* ── DATABASE LAYER ──────────────────────────────────────────────
   Supabase REST API called directly — no npm package required.
   URL and anon key are stored in localStorage and managed through
   the DB Setup screen (Admin only).                              */

const DB_CONFIG_KEY = "proc_tracker_sb";

function dbGetConfig() {
  try { return JSON.parse(localStorage.getItem(DB_CONFIG_KEY) || "null"); }
  catch { return null; }
}
function dbSaveConfig(url, key) {
  localStorage.setItem(DB_CONFIG_KEY, JSON.stringify({ url: url.trim().replace(/\/$/, ""), key: key.trim() }));
}
function dbClearConfig() { localStorage.removeItem(DB_CONFIG_KEY); }

/* ── SESSION PERSISTENCE ─────────────────────────────────────────
   The logged-in user is written to localStorage so a page refresh
   doesn't kick you back to the login screen. Sessions expire after
   12 hours so a shared machine doesn't stay signed in forever.   */

const SESSION_KEY  = "proc_tracker_session";
const SESSION_HRS  = 12;

function loadSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!raw?.user || !raw?.at) return null;
    const ageHrs = (Date.now() - raw.at) / 3600000;
    if (ageHrs > SESSION_HRS) { localStorage.removeItem(SESSION_KEY); return null; }
    return raw.user;
  } catch { return null; }
}
function saveSession(user) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ user, at: Date.now() })); }
  catch { /* private browsing — session just won't persist */ }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

function dbClient() {
  const cfg = dbGetConfig();
  if (!cfg?.url || !cfg?.key) return null;
  const base = cfg.url + "/rest/v1";

  /* Supabase REST upsert rules:
     - POST to /<table>?on_conflict=<col>
     - Prefer header must be EXACTLY "resolution=merge-duplicates"
       (adding return=representation causes 409 on some Supabase versions)
     - apikey + Authorization both required               */
  const hdrs = (extra) => ({
    "Content-Type":  "application/json",
    "apikey":        cfg.key,
    "Authorization": "Bearer " + cfg.key,
    ...(extra || {}),
  });

  const req = async (method, path, body, extra) => {
    try {
      const r = await fetch(base + path, {
        method,
        headers: hdrs(extra),
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      const data = text ? JSON.parse(text) : null;
      if (!r.ok) return { data: null, error: data?.message || data?.hint || "HTTP " + r.status };
      return { data, error: null };
    } catch(e) { return { data: null, error: e.message }; }
  };

  return {
    get:    (p)    => req("GET",    p, null, { "Prefer": "return=representation" }),
    upsert: (p, b) => req("POST",   p, b,    { "Prefer": "resolution=merge-duplicates" }),
    patch:  (p, b) => req("PATCH",  p, b,    { "Prefer": "return=representation" }),
    del:    (p)    => req("DELETE", p),
  };
}

/* phone row <-> app shape */
const phoneToRow = (p) => ({
  id: p.id, brand: p.brand, name: p.name, segment: p.segment,
  launch: p.launch, stage: p.stage, po: p.po || null,
  done: p.done || {}, skus: p.skus || [], sales_entries: p.salesEntries || [],
});
const rowToPhone = (r) => ({
  id: r.id, brand: r.brand, name: r.name, segment: r.segment,
  launch: r.launch, stage: r.stage, po: r.po,
  done: r.done || {}, skus: r.skus || [], salesEntries: r.sales_entries || [],
});

/* user row <-> app shape (identical, just snake_case alias) */
const userToRow = (u) => ({ id: u.id, name: u.name, role: u.role, pin: u.pin, avatar: u.avatar });

async function dbPing() {
  const c = dbClient(); if (!c) return { ok: false, error: "Not configured" };
  const { error } = await c.get("/phones?limit=1");
  return { ok: !error, error };
}
async function dbLoadPhones() {
  const c = dbClient(); if (!c) return { data: null, error: "Not configured" };
  const { data, error } = await c.get("/phones?order=id");
  return { data: error ? null : (data || []).map(rowToPhone), error };
}
async function dbUpsertPhone(phone) {
  const c = dbClient(); if (!c) return { error: "Not configured" };
  return c.upsert("/phones?on_conflict=id", phoneToRow(phone));
}
async function dbDeletePhone(id) {
  const c = dbClient(); if (!c) return { error: "Not configured" };
  return c.del("/phones?id=eq." + id);
}
async function dbDeleteAllPhones() {
  const c = dbClient(); if (!c) return { error: "Not configured" };
  return c.del("/phones?id=gt.0");
}
async function dbLoadUsers() {
  const c = dbClient(); if (!c) return { data: null, error: "Not configured" };
  const { data, error } = await c.get("/users?order=created_at");
  return { data: error ? null : data, error };
}
async function dbUpsertUser(user) {
  const c = dbClient(); if (!c) return { error: "Not configured" };
  return c.upsert("/users?on_conflict=id", userToRow(user));
}
async function dbDeleteUser(id) {
  const c = dbClient(); if (!c) return { error: "Not configured" };
  return c.del("/users?id=eq." + id);
}

/* ── 6. STYLES ───────────────────────────────────────────────────
   All colours are CSS variables set on .app. Change them in one
   place and the whole thing retheme.                               */

const CSS = `
.app *, .app *::before, .app *::after { box-sizing: border-box; }
.app {
  --mono: ui-monospace, "SF Mono", Menlo, monospace;
  font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  min-height: 100vh; background: var(--bg); color: var(--text);
  -webkit-font-smoothing: antialiased;
}
.app[data-theme="dark"] {
  --bg:#0B0F1A; --card:#141A28; --line:#242C3E; --text:#E8ECF5; --dim:#8A96AD;
  --accent:#6C8CFF; --ok:#3ED9A4; --warn:#FFC24B; --bad:#FF7A85;
}
.app[data-theme="light"] {
  --bg:#F2F4F9; --card:#FFFFFF; --line:#E1E6F0; --text:#111827; --dim:#6B7689;
  --accent:#3457E5; --ok:#0E9F72; --warn:#B57A05; --bad:#D93B4A;
}
/* every number uses the mono font so columns line up */
.app .n { font-family: var(--mono); font-variant-numeric: tabular-nums; }

.app .wrap { max-width: 1280px; margin: 0 auto; padding: 20px; }
.app .row { display: flex; align-items: center; gap: 12px; }
.app .head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.app h1 { font-size: 20px; font-weight: 650; margin: 0; letter-spacing: -.02em; }
.app .sub { font-size: 13px; color: var(--dim); margin-top: 3px; }
.app h2 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); margin: 0 0 10px; font-weight: 600; }

.app .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
.app .grid { display: grid; gap: 12px; }
.app .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 18px; }
.app .stat-v { font-size: 26px; font-weight: 620; font-family: var(--mono); line-height: 1; margin-top: 6px; }
.app .stat-l { font-size: 12px; color: var(--dim); }

.app .btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border-radius: 9px;
  border: 1px solid var(--line); background: var(--card); color: var(--text);
  font: inherit; font-size: 13px; cursor: pointer;
}
.app .btn:hover { border-color: var(--accent); color: var(--accent); }
.app .btn[data-primary="1"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.app .btn[data-primary="1"]:hover { opacity: .9; color: #fff; }
.app .btn[data-on="1"] { border-color: var(--accent); color: var(--accent); }
.app .btn-icon { padding: 8px; }

.app .tag {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 20px;
  font-size: 11px; font-weight: 550; border: 1px solid var(--line); color: var(--dim);
}
.app .tag[data-tone="ok"]   { color: var(--ok);   border-color: var(--ok); }
.app .tag[data-tone="warn"] { color: var(--warn); border-color: var(--warn); }
.app .tag[data-tone="bad"]  { color: var(--bad);  border-color: var(--bad); }

.app .meter { height: 5px; border-radius: 20px; background: var(--line); overflow: hidden; }
.app .meter > i { display: block; height: 100%; background: var(--accent); transition: width .5s; }
.app .meter[data-tone="ok"] > i  { background: var(--ok); }
.app .meter[data-tone="bad"] > i { background: var(--bad); }

/* board */
.app .board { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 12px; align-items: flex-start; }
.app .col { flex: 0 0 210px; }
.app .col-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; padding: 0 2px; }
.app .col-name { font-size: 12px; font-weight: 620; text-transform: uppercase; letter-spacing: .05em; }
.app .col-count { font-family: var(--mono); font-size: 11px; color: var(--dim); margin-left: auto; }
.app .col-body { min-height: 70px; border-radius: 10px; border: 1px dashed transparent; padding: 2px; display: grid; gap: 8px; }
.app .col-body[data-over="1"] { border-color: var(--accent); background: var(--card); }
.app .col-hint { font-size: 10.5px; color: var(--dim); line-height: 1.4; margin-bottom: 8px; padding: 0 2px; min-height: 28px; }
.app .pcard { cursor: grab; padding: 11px; }
.app .pcard:hover { border-color: var(--accent); }
.app .empty { font-size: 11px; color: var(--dim); text-align: center; padding: 16px 6px; }

/* table */
.app table { width: 100%; border-collapse: collapse; font-size: 13px; }
.app th {
  text-align: left; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--dim); font-weight: 600; padding: 9px 12px; border-bottom: 1px solid var(--line);
}
.app td { padding: 11px 12px; border-bottom: 1px solid var(--line); }
.app tbody tr { cursor: pointer; }
.app tbody tr:hover { background: var(--bg); }

/* slide-in panel, used by both detail and the add form */
.app .shade { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 40; }
.app .panel {
  position: fixed; z-index: 41; top: 0; right: 0; bottom: 0; width: min(560px, 100%);
  background: var(--bg); border-left: 1px solid var(--line);
  display: flex; flex-direction: column; animation: slide .25s ease-out;
}
@keyframes slide { from { transform: translateX(30px); opacity: 0; } }
.app .panel-head { padding: 16px 18px; border-bottom: 1px solid var(--line); display: flex; gap: 12px; align-items: flex-start; }
.app .panel-body { padding: 18px; overflow-y: auto; flex: 1; display: grid; gap: 18px; }
.app .panel-foot { padding: 14px 18px; border-top: 1px solid var(--line); display: flex; gap: 8px; }

/* timeline inside the detail panel */
.app .step { display: flex; gap: 11px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.app .step:last-child { border-bottom: none; }
.app .dot {
  width: 20px; height: 20px; border-radius: 50%; flex: 0 0 20px; display: grid; place-items: center;
  border: 2px solid var(--line); color: var(--bg);
}
.app .step[data-state="done"]    .dot { background: var(--ok);   border-color: var(--ok); }
.app .step[data-state="late"]    .dot { background: var(--bad);  border-color: var(--bad); }
.app .step[data-state="now"]     .dot { background: var(--warn); border-color: var(--warn); }
.app .step-name { font-size: 13px; font-weight: 550; }
.app .step-sub { font-size: 11px; color: var(--dim); margin-top: 2px; }

/* form */
.app .field { display: grid; gap: 5px; margin-bottom: 14px; }
.app .field-l { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--dim); }
.app .field-h { font-size: 10.5px; color: var(--dim); }
.app input, .app select {
  width: 100%; padding: 9px 11px; border-radius: 9px; border: 1px solid var(--line);
  background: var(--card); color: var(--text); font: inherit; font-size: 13px; outline: none;
}
.app input:focus, .app select:focus { border-color: var(--accent); }
/* Native option popups don't inherit from the select, so in dark mode they
   render dark-on-dark and look empty. These two lines make them readable. */
.app option { background: var(--card); color: var(--text); }
.app select { -webkit-appearance: none; appearance: none; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, var(--dim) 50%),
                    linear-gradient(135deg, var(--dim) 50%, transparent 50%);
  background-position: calc(100% - 16px) calc(50% + 1px), calc(100% - 11px) calc(50% + 1px);
  background-size: 5px 5px, 5px 5px; background-repeat: no-repeat;
  padding-right: 30px; }
.app .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.app textarea {
  width: 100%; padding: 9px 11px; border-radius: 9px; border: 1px solid var(--line);
  background: var(--card); color: var(--text); font: inherit; font-size: 13px; outline: none;
}
.app textarea:focus { border-color: var(--accent); }
.app input[type=range] {
  -webkit-appearance: none; appearance: none; padding: 0; height: 5px; background: var(--line);
  border: none; border-radius: 20px; cursor: pointer;
}
.app input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%;
  background: var(--accent); border: 2px solid var(--bg); cursor: grab;
}
.app input[type=range]::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg);
}
.app .toast {
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 60;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 16px; font-size: 13px;
}
.app :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 640px) { .app .two { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .app * { animation: none !important; transition: none !important; } }

/* ── KPI cards ── */
.app .kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(175px, 1fr)); gap: 12px; margin-bottom: 20px; }
.app .kpi {
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; position: relative;
}
.app .kpi-label { font-size: 11px; color: var(--dim); letter-spacing: .03em; text-transform: uppercase; font-weight: 600; }
.app .kpi-value { font-size: 30px; font-weight: 680; font-family: var(--mono); line-height: 1; }
.app .kpi-sub   { font-size: 11px; color: var(--dim); line-height: 1.4; }
.app .kpi[data-tone="ok"]   { border-color: color-mix(in srgb, var(--ok)   40%, var(--line)); }
.app .kpi[data-tone="ok"]   .kpi-value { color: var(--ok); }
.app .kpi[data-tone="warn"] { border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); }
.app .kpi[data-tone="warn"] .kpi-value { color: var(--warn); }
.app .kpi[data-tone="bad"]  { border-color: color-mix(in srgb, var(--bad)  40%, var(--line)); }
.app .kpi[data-tone="bad"]  .kpi-value { color: var(--bad); }
.app .kpi[data-tone="accent"] .kpi-value { color: var(--accent); }
.app .kpi .kpi-dl { position: absolute; top: 10px; right: 10px; display: flex; gap: 3px; }
.app .kpi .kpi-dl button { padding: 2px 6px; font-size: 10px; border-radius: 5px; }

/* ── funnel bar ── */
.app .funnel { display: flex; flex-direction: column; gap: 7px; }
.app .funnel-row { display: grid; grid-template-columns: 88px 1fr 32px; gap: 10px; align-items: center; font-size: 12px; }
.app .funnel-bar { height: 18px; border-radius: 4px; background: var(--accent); min-width: 4px; transition: width .5s; }
.app .funnel-n { font-family: var(--mono); font-size: 12px; color: var(--dim); text-align: right; }

/* ── report panel ── */
.app .report-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.app .report-tab { padding: 6px 12px; border-radius: 8px; font-size: 12px; border: 1px solid var(--line); background: var(--card); cursor: pointer; color: var(--dim); }
.app .report-tab:hover { border-color: var(--accent); color: var(--accent); }
.app .report-tab[data-on="1"] { border-color: var(--accent); background: var(--accent); color: #fff; }
.app .report-preview { overflow-x: auto; max-height: 380px; overflow-y: auto; border-radius: 9px; border: 1px solid var(--line); }
.app .report-dl { display: flex; gap: 8px; margin-top: 12px; align-items: center; flex-wrap: wrap; }
`;


/* ── 7. SMALL PIECES ─────────────────────────────────────────── */

const Tag   = ({ tone, children }) => <span className="tag" data-tone={tone}>{children}</span>;
const Meter = ({ value, tone }) => <div className="meter" data-tone={tone}><i style={{ width: value + "%" }} /></div>;
const Stat  = ({ label, value, tone }) => (
  <div className="card">
    <div className="stat-l">{label}</div>
    <div className="stat-v" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
  </div>
);
const Field = ({ label, hint, children }) => (
  <label className="field">
    <span className="field-l">{label}</span>
    {children}
    {hint && <span className="field-h">{hint}</span>}
  </label>
);

/* ── FILTER BAR — shared by Board and List ───────────────────────
   Search, "needs my action", quick chips, and density toggle.
   State lives in App so switching views keeps your filters.      */

function FilterBar({ filters, setFilters, models, role, compact, setCompact, showDensity }) {
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const brands = [...new Set(models.map((m) => m.brand))].sort();

  const actionable = models.filter((m) => advanceStatus(m, role).ok).length;
  const lateCount  = models.filter((m) => m.isLate).length;
  const soonCount  = models.filter((m) => m.daysToLaunch != null && m.daysToLaunch >= 0 && m.daysToLaunch <= 30).length;
  const anyActive  = filters.q || filters.needsAction || filters.lateOnly || filters.soonOnly || filters.brand;

  return (
    <div className="card" style={{ marginBottom: 14, padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 10 }}>

      {/* search row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <input
            value={filters.q}
            placeholder="Search brand, model, SKU, material or PO…"
            style={{ paddingLeft: 32 }}
            onChange={(e) => set("q", e.target.value)}
          />
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
            fontSize: 13, color: "var(--dim)", pointerEvents: "none" }}>⌕</span>
          {filters.q && (
            <button className="btn" title="Clear search"
              style={{ position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)",
                padding: "2px 6px", border: "none" }}
              onClick={() => set("q", "")}>
              <X size={12} />
            </button>
          )}
        </div>

        {showDensity && (
          <button className="btn" style={{ fontSize: 11, padding: "6px 10px" }}
            onClick={() => setCompact(!compact)}
            title={compact ? "Show full cards" : "Show compact cards"}>
            {compact ? "⊞ Full" : "⊟ Compact"}
          </button>
        )}

        {anyActive && (
          <button className="btn" style={{ fontSize: 11, padding: "6px 10px", color: "var(--dim)" }}
            onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear all
          </button>
        )}
      </div>

      {/* chip row */}
      <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" data-on={filters.needsAction ? "1" : "0"}
          style={{ fontSize: 11, padding: "5px 10px" }}
          title="Only phones you can move forward right now"
          onClick={() => set("needsAction", !filters.needsAction)}>
          {filters.needsAction ? <CheckCircle2 size={11} /> : <Circle size={11} />}
          Needs my action
          <span style={{ opacity: 0.7, marginLeft: 3 }}>{actionable}</span>
        </button>

        <button className="btn" data-on={filters.lateOnly ? "1" : "0"}
          style={{ fontSize: 11, padding: "5px 10px",
            color: filters.lateOnly ? undefined : (lateCount ? "var(--bad)" : undefined) }}
          onClick={() => set("lateOnly", !filters.lateOnly)}>
          Late
          <span style={{ opacity: 0.7, marginLeft: 3 }}>{lateCount}</span>
        </button>

        <button className="btn" data-on={filters.soonOnly ? "1" : "0"}
          style={{ fontSize: 11, padding: "5px 10px" }}
          onClick={() => set("soonOnly", !filters.soonOnly)}>
          Launching ≤30d
          <span style={{ opacity: 0.7, marginLeft: 3 }}>{soonCount}</span>
        </button>

        {brands.length > 1 && (
          <select value={filters.brand} onChange={(e) => set("brand", e.target.value)}
            style={{ fontSize: 11, padding: "5px 10px", width: "auto", minWidth: 110 }}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}


/* ── 8. BOARD VIEW ───────────────────────────────────────────────
   One column per stage. Drag a card to move the model forward.     */

function Board({ models, allModels, onOpen, onMove, onAdd, onAdvance, role, compact, filters }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver]         = useState(null);
  const [collapsed, setCollapsed] = useState({});   // { stageKey: true }

  const drop = (stageKey) => {
    if (dragging && dragging.stage !== stageKey) onMove(dragging.id, stageKey);
    setDragging(null); setOver(null);
  };

  const toggleCol = (k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));

  if (allModels.length === 0) return (
    <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
      <div style={{ fontSize: 16, fontWeight: 640, marginBottom: 8 }}>Board is empty</div>
      <div style={{ fontSize: 13, color: "var(--dim)", marginBottom: 20 }}>Add a phone to see it appear here.</div>
      <button className="btn" data-primary="1" onClick={onAdd}><Plus size={14} />Add phone</button>
    </div>
  );

  const anyFilter = filters.q || filters.needsAction || filters.lateOnly || filters.soonOnly || filters.brand;

  if (models.length === 0) return (
    <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No phones match your filters</div>
      <div style={{ fontSize: 13, color: "var(--dim)" }}>
        {filters.needsAction
          ? "Nothing is waiting on your role right now."
          : "Try clearing the search or filter chips above."}
      </div>
    </div>
  );

  return (
    <div className="board">
      {STAGES.map((stage) => {
        const inThisStage = models.filter((m) => m.stage === stage.key).sort(byUrgency);
        const totalHere   = allModels.filter((m) => m.stage === stage.key).length;
        const isCollapsed = collapsed[stage.key];

        /* collapsed column — a thin vertical strip */
        if (isCollapsed) return (
          <div className="col" key={stage.key}
            style={{ minWidth: 46, maxWidth: 46, cursor: "pointer" }}
            onClick={() => toggleCol(stage.key)}
            title={`Expand ${stage.label}`}>
            <div className="col-head" style={{ justifyContent: "center", padding: "10px 0" }}>
              <span className="col-count">{inThisStage.length}</span>
            </div>
            <div style={{ writingMode: "vertical-rl", textOrientation: "mixed",
              padding: "10px 0", fontSize: 11, color: "var(--dim)", textAlign: "center",
              letterSpacing: 0.5 }}>
              {stage.label}
            </div>
          </div>
        );

        return (
          <div className="col" key={stage.key}>
            <div className="col-head">
              <span className="col-name">{stage.label}</span>
              <span className="col-count">
                {anyFilter && inThisStage.length !== totalHere
                  ? `${inThisStage.length}/${totalHere}`
                  : inThisStage.length}
              </span>
              <button className="btn" title={`Collapse ${stage.label}`}
                style={{ padding: "1px 5px", fontSize: 10, border: "none", marginLeft: 4 }}
                onClick={() => toggleCol(stage.key)}>‹</button>
            </div>
            {!compact && <div className="col-hint">{stage.hint}</div>}
            <div
              className="col-body"
              data-over={over === stage.key ? "1" : "0"}
              onDragOver={(e) => { e.preventDefault(); setOver(stage.key); }}
              onDragLeave={() => setOver((o) => (o === stage.key ? null : o))}
              onDrop={() => drop(stage.key)}
            >
              {inThisStage.map((m) => {
                const st = advanceStatus(m, role);
                return (
                  <div
                    className="card pcard" key={m.id} draggable
                    style={compact ? { padding: "8px 10px" } : undefined}
                    onDragStart={() => setDragging(m)}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    onClick={() => onOpen(m.id)}
                  >
                    {/* ── name row with quick-advance ── */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {!compact && <div style={{ fontSize: 11, color: "var(--dim)" }}>{m.brand}</div>}
                        <div style={{ fontSize: compact ? 12 : 13, fontWeight: 600,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {compact ? `${m.brand} ${m.name}` : m.name}
                        </div>
                      </div>
                      {st.next && (
                        <button className="btn"
                          title={st.ok ? `Move to ${st.next.label}` : st.reason}
                          style={{ padding: "3px 7px", fontSize: 11, flexShrink: 0,
                            opacity: st.ok ? 1 : 0.3,
                            cursor: st.ok ? "pointer" : "not-allowed",
                            borderColor: st.ok ? "var(--ok)" : undefined,
                            color: st.ok ? "var(--ok)" : undefined }}
                          onClick={(e) => { e.stopPropagation(); if (st.ok) onAdvance(m.id); }}>
                          →
                        </button>
                      )}
                    </div>

                    {/* ── meta row ── */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
                      marginTop: compact ? 4 : 8, fontSize: 11 }}>
                      {m.isLate && <Tag tone="bad">+{m.worstDelay}d</Tag>}
                      {m.daysToLaunch != null && m.daysToLaunch >= 0 && m.daysToLaunch <= 30 && !m.isLate && (
                        <Tag tone="warn">{m.daysToLaunch}d to launch</Tag>
                      )}
                      {!compact && <span style={{ color: "var(--dim)" }}>{showDate(m.launch)}</span>}
                      {!compact && allSkus(m).length > 0 && (
                        <span style={{ color: "var(--dim)" }}>· {allSkus(m).length} SKU</span>
                      )}
                      {compact && allSkus(m).length > 0 && (
                        <span style={{ color: "var(--dim)" }}>{allSkus(m).length} SKU</span>
                      )}
                    </div>

                    {/* ── blocked reason, full mode only ── */}
                    {!compact && !st.ok && st.reason && st.next && (
                      <div style={{ fontSize: 10, color: "var(--dim)", marginTop: 5,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {st.reason}
                      </div>
                    )}
                  </div>
                );
              })}
              {inThisStage.length === 0 && (
                <div style={{ fontSize: 11, color: "var(--dim)", padding: "10px 4px", textAlign: "center" }}>
                  {anyFilter && totalHere > 0 ? `${totalHere} hidden by filters` : "—"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}


/* ── 9. TABLE VIEW ─────────────────────────────────────────────── */

function Table({ models, allModels, onOpen, onAdvance, role, filters }) {
  const [sortKey, setSortKey] = useState("urgency");
  const [asc, setAsc]         = useState(true);

  const flip = (key) => {
    if (sortKey === key) setAsc((a) => !a);
    else { setSortKey(key); setAsc(true); }
  };

  const sorted = useMemo(() => {
    const list = [...models];
    const dir = asc ? 1 : -1;
    const cmp = {
      urgency: byUrgency,
      phone:   (a, b) => `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`),
      segment: (a, b) => a.segment.localeCompare(b.segment),
      launch:  (a, b) => new Date(a.launch) - new Date(b.launch),
      stage:   (a, b) => a.index - b.index,
      units:   (a, b) => a.units - b.units,
    }[sortKey] || byUrgency;
    return list.sort((a, b) => cmp(a, b) * dir);
  }, [models, sortKey, asc]);

  const Th = ({ label, sk, align }) => (
    <th onClick={() => flip(sk)}
      style={{ cursor: "pointer", userSelect: "none", textAlign: align, whiteSpace: "nowrap" }}
      title={`Sort by ${label.toLowerCase()}`}>
      {label}
      <span style={{ opacity: sortKey === sk ? 0.9 : 0.22, marginLeft: 4, fontSize: 10 }}>
        {sortKey === sk ? (asc ? "▲" : "▼") : "▲"}
      </span>
    </th>
  );

  const anyFilter = filters.q || filters.needsAction || filters.lateOnly || filters.soonOnly || filters.brand;

  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      {anyFilter && (
        <div style={{ padding: "9px 14px", fontSize: 11, color: "var(--dim)",
          borderBottom: "1px solid var(--line)" }}>
          Showing {sorted.length} of {allModels.length} phones
        </div>
      )}
      <table>
        <thead>
          <tr>
            <Th label="Phone"   sk="phone" />
            <Th label="Segment" sk="segment" />
            <Th label="Launch"  sk="launch" />
            <Th label="Stage"   sk="stage" />
            <Th label="Units"   sk="units" />
            <Th label="Status"  sk="urgency" />
            <th style={{ width: 60, textAlign: "center" }}>Move</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => {
            const st = advanceStatus(m, role);
            return (
              <tr key={m.id} onClick={() => onOpen(m.id)} tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(m.id)}>
                <td>
                  <div style={{ fontWeight: 570 }}>{m.brand} {m.name}</div>
                  <div className="n" style={{ fontSize: 11, color: "var(--dim)" }}>
                    {m.po || "no PO yet"}
                    {allSkus(m).length > 0 && ` · ${allSkus(m).length} SKU`}
                  </div>
                </td>
                <td style={{ color: "var(--dim)", fontSize: 12 }}>{m.segment}</td>
                <td className="n" style={{ fontSize: 12 }}>
                  {showDate(m.launch)}
                  {m.daysToLaunch != null && m.daysToLaunch >= 0 && m.daysToLaunch <= 30 && (
                    <div style={{ fontSize: 10, color: "var(--warn)" }}>{m.daysToLaunch}d away</div>
                  )}
                </td>
                <td style={{ fontSize: 12 }}>{STAGES[m.index].label}</td>
                <td className="n" style={{ fontSize: 12 }}>{qty(m.units)}</td>
                <td>
                  {m.isLate
                    ? <Tag tone="bad">{m.worstDelay}d late</Tag>
                    : st.ok
                      ? <Tag tone="ok">ready to move</Tag>
                      : <Tag>on time</Tag>}
                  {!st.ok && st.reason && st.next && (
                    <div style={{ fontSize: 10, color: "var(--dim)", marginTop: 3 }}>{st.reason}</div>
                  )}
                </td>
                <td style={{ textAlign: "center" }}>
                  {st.next && (
                    <button className="btn"
                      title={st.ok ? `Move to ${st.next.label}` : st.reason}
                      style={{ padding: "3px 8px", fontSize: 11,
                        opacity: st.ok ? 1 : 0.3,
                        cursor: st.ok ? "pointer" : "not-allowed",
                        borderColor: st.ok ? "var(--ok)" : undefined,
                        color: st.ok ? "var(--ok)" : undefined }}
                      onClick={(e) => { e.stopPropagation(); if (st.ok) onAdvance(m.id); }}>
                      →
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {!sorted.length && (
            <tr><td colSpan={7} style={{ textAlign: "center", padding: 36, color: "var(--dim)" }}>
              {allModels.length === 0
                ? "No phones yet. Add the first one."
                : filters.needsAction
                  ? "Nothing is waiting on your role right now."
                  : "No phones match your filters."}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}



/* ── PLANNED STAGE: COVER TYPES + THEIR SKUs ─────────────────────
   Pick cover types, then add as many SKUs as you need under each one.
   Every SKU has its own material and unit count, so a single
   "Silicone Cover" can hold ten SKUs in ten different colours.      */

function PlannedSKUEditor({ model, onSave, stage = "planned" }) {
  if (!onSave) return (
    <div>
      <h2 style={{ color: "var(--warn)" }}>▸ SKUs</h2>
      <div className="card" style={{ color: "var(--dim)", fontSize: 13 }}>
        Your role cannot edit SKUs. Contact Procurement or Admin.
      </div>
    </div>
  );
  const [draft, setDraft] = useState(
    () => (model.skus || []).map((r) => ({ ...r }))
  );
  const [bulkText, setBulkText] = useState("");
  const [bulkErr,  setBulkErr]  = useState("");
  const [saved, setSaved] = useState(false);

  const addRow    = ()      => setDraft((d) => [...d, skuRow()]);
  const removeRow = (rid)   => setDraft((d) => d.filter((r) => r.rid !== rid));
  const editRow   = (rid, patch) =>
    setDraft((d) => d.map((r) => (r.rid === rid ? { ...r, ...patch } : r)));

  /* Bulk paste: one line per SKU — "SKU, Material, Units" */
  const applyBulk = (raw, mode) => {
    const lines = raw.trim().split(/\r?\n/).filter((l) => l.trim());
    const parsed = [], bad = [];
    lines.forEach((line, i) => {
      if (i === 0 && /^\s*sku\s*[,\t]/i.test(line)) return;   // skip a header row
      const parts = line.split(/[,\t]/).map((x) => x.trim());
      const sku = parts[0];
      if (!sku) { bad.push(i + 1); return; }
      const material = parts[1] || "";
      /* join everything after the material so a pasted "5,000" isn't read as 5 */
      const n = parseInt(parts.slice(2).join("").replace(/[^\d]/g, ""), 10);
      parsed.push(skuRow(sku, material, Number.isFinite(n) ? n : defaultQtyFor(material)));
    });
    if (!parsed.length) { setBulkErr("No valid rows found. Each line needs at least a SKU."); return; }
    setDraft((d) => mode === "append"
      ? [...d.filter((r) => r.sku.trim() || r.material.trim() || r.units > 0), ...parsed]
      : parsed);
    setBulkErr(bad.length ? `${parsed.length} added, ${bad.length} blank line(s) skipped.` : "");
    setBulkText("");
  };

  const save = () => {
    const cleaned = draft.filter((r) => r.sku.trim() || r.material.trim() || r.units > 0);
    onSave(model.id, cleaned);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const missingSku = draft.filter((r) => !r.sku.trim()).length;
  const totalUnits = draft.reduce((s, r) => s + (r.units || 0), 0);

  return (
    <div>
      <h2 style={{ color: "var(--warn)" }}>
        {stage === "planned" ? "▸ Planned — SKUs to make" : "▸ SKUs (editable)"}
      </h2>
      <div className="card">
        <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 14, lineHeight: 1.5 }}>
          Add SKUs one at a time, or paste a whole list below. Each SKU has its own
          material and unit count.
          {stage === "planned"
            ? <strong> Every SKU needs a code before you can move to Ordered.</strong>
            : <strong> Changing SKUs here changes what you ordered — re-send the PO and STP file.</strong>}
        </div>

        {/* the SKU table */}
        {draft.length > 0 && (
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 190 }}>SKU *</th>
                  <th style={{ minWidth: 170 }}>Material</th>
                  <th style={{ minWidth: 100 }}>Units</th>
                  <th style={{ width: 34 }}></th>
                </tr>
              </thead>
              <tbody>
                {draft.map((r) => (
                  <tr key={r.rid} style={{ cursor: "default" }}>
                    <td style={{ padding: "6px 8px" }}>
                      <input value={r.sku} placeholder="SIL-A57-BLK"
                        style={{ fontFamily: "var(--mono)", fontSize: 12,
                          borderColor: !r.sku.trim() ? "var(--bad)" : undefined }}
                        onChange={(e) => editRow(r.rid, { sku: e.target.value })} />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <select value={r.material} style={{ fontSize: 12 }}
                        onChange={(e) => {
                          const name = e.target.value;
                          /* fill units only if the buyer hasn't typed their own figure */
                          const untouched = !r.units || r.units === defaultQtyFor(r.material);
                          editRow(r.rid, untouched
                            ? { material: name, units: defaultQtyFor(name) }
                            : { material: name });
                        }}>
                        <option value="">— select —</option>
                        {MATERIALS.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input type="number" min="0" value={r.units || ""}
                        placeholder={r.material ? String(defaultQtyFor(r.material)) : "qty"}
                        style={{ fontFamily: "var(--mono)", fontSize: 12 }}
                        onChange={(e) => editRow(r.rid, { units: +e.target.value })} />
                    </td>
                    <td style={{ padding: "6px 4px", textAlign: "center" }}>
                      <button className="btn" title="Remove this SKU"
                        style={{ padding: "4px 6px", color: "var(--bad)", borderColor: "transparent" }}
                        onClick={() => removeRow(r.rid)}>
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button className="btn" style={{ fontSize: 11, padding: "5px 10px", marginBottom: 16 }}
          onClick={addRow}><Plus size={11} />Add SKU</button>

        {/* bulk paste — always here, nothing to toggle */}
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div style={{ fontSize: 11, color: "var(--dim)", marginBottom: 6, lineHeight: 1.5 }}>
            Or paste a list — one line per SKU: <code>SKU, Material, Units</code><br />
            Leave units off to use the material default. Tabs from Excel work, header row is skipped.
          </div>
          <textarea rows={4} value={bulkText}
            style={{ fontFamily: "var(--mono)", fontSize: 12, resize: "vertical" }}
            placeholder={"SIL-A57-BLK, Silicone Cover, 30\nSIL-A57-BLU, Silicone Cover\nTPU-A57-CLR, TPU+PC"}
            onChange={(e) => setBulkText(e.target.value)} />
          {bulkErr && <div style={{ color: "var(--warn)", fontSize: 11, marginTop: 5 }}>{bulkErr}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn" style={{ fontSize: 11, padding: "4px 9px", opacity: bulkText.trim() ? 1 : 0.4 }}
              onClick={() => bulkText.trim() && applyBulk(bulkText, "append")}>Add these to the list</button>
            <button className="btn" style={{ fontSize: 11, padding: "4px 9px", opacity: bulkText.trim() ? 1 : 0.4 }}
              onClick={() => bulkText.trim() && applyBulk(bulkText, "replace")}>Replace the list</button>
          </div>
        </div>

        {/* save */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
          <button className="btn" data-primary="1" onClick={save}>
            {saved ? "✓ Saved" : "Save SKUs"}
          </button>
          <span style={{ fontSize: 12, color: "var(--dim)" }}>
            {draft.length} SKU{draft.length !== 1 ? "s" : ""} · {qty(totalUnits)} units
          </span>
          {missingSku > 0 && <Tag tone="bad">{missingSku} still blank</Tag>}
        </div>
      </div>
    </div>
  );
}


/* ── PO NUMBER — typed by the buyer, never invented ──────────────── */

function POField({ model, onSave }) {
  const [po, setPo] = useState(model.po || "");
  const [saved, setSaved] = useState(false);
  const dirty = po.trim() !== (model.po || "");
  const save = () => { onSave(model.id, po); setSaved(true); setTimeout(() => setSaved(false), 1800); };

  return (
    <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Field label="Purchase order number">
            <input value={po} placeholder="Type your real PO number"
              style={{ fontFamily: "var(--mono)" }}
              onChange={(e) => setPo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && dirty && save()} />
          </Field>
        </div>
        <button className="btn" data-primary="1" style={{ opacity: dirty ? 1 : 0.4 }}
          onClick={() => dirty && save()}>
          {saved ? "✓ Saved" : "Save PO"}
        </button>
      </div>
      {!model.po && (
        <div style={{ fontSize: 11, color: "var(--warn)", marginTop: 4 }}>
          No PO recorded yet — the export will go out without one.
        </div>
      )}
    </div>
  );
}


/* ── ORDERED STAGE: EXPORT PLANNED SKUs ──────────────────────────
   Download a CSV/Excel of all SKUs so supplier can confirm.       */

function SKUExport({ model, onPOSave }) {
  const exportFile = (fmt) => {
    const headers = ["SKU", "Material", "Units Planned"];
    const rows = allSkus(model).map((r) => [r.sku || "", r.material || "", r.units]);
    const isCSV = fmt === "csv";
    const sep = isCSV ? "," : "	";
    const mime = isCSV ? "text/csv" : "application/vnd.ms-excel";
    const ext  = isCSV ? ".csv" : ".xls";
    const lines = [headers, ...rows].map((r) =>
      isCSV ? r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",") : r.join("\t")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines], { type: mime + ";charset=utf-8;" }));
    a.download = `${model.brand}_${model.name.replace(/\s+/g,"_")}_SKUs${ext}`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const missing = allSkus(model).filter((r) => !r.sku);
  return (
    <div>
      <h2>▸ Ordered — PO number &amp; SKU export</h2>
      <div className="card">
        <POField model={model} onSave={onPOSave} />
        {missing.length > 0 && (
          <div style={{ color: "var(--warn)", fontSize: 12, marginBottom: 10 }}>
            {missing.length} cover{missing.length > 1 ? "s" : ""} still missing SKU — go back to Planned to fix.
          </div>
        )}
        <div style={{ overflowX: "auto", marginBottom: 12 }}>
          <table>
            <thead><tr><th>SKU</th><th>Material</th><th>Units</th></tr></thead>
            <tbody>
              {allSkus(model).map((r) => (
                <tr key={r.rid} style={{ cursor: "default" }}>
                  <td className="n" style={{ fontWeight: 550, fontSize: 12 }}>{r.sku || <span style={{ color: "var(--warn)" }}>missing</span>}</td>
                  <td style={{ color: "var(--dim)", fontSize: 12 }}>{r.material || "—"}</td>
                  <td className="n">{qty(r.units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" data-primary="1" onClick={() => exportFile("csv")}>↓ Export CSV</button>
          <button className="btn" onClick={() => exportFile("excel")}>↓ Export Excel</button>
        </div>
      </div>
    </div>
  );
}


/* ── PRODUCTION STAGE: STP FILE, TRACKED PER SKU ─────────────────
   One material can be rejected while the others pass, so each SKU
   carries its own STP status.                                     */

function ProductionSTP({ model, onSTPUpdate }) {
  const rows = allSkus(model);
  const [draft, setDraft] = useState(
    () => Object.fromEntries(rows.map((r) => [r.rid, r.stpStatus || "Not Sent"]))
  );
  const [saved, setSaved] = useState(false);

  const setAll = (st) => setDraft(Object.fromEntries(rows.map((r) => [r.rid, st])));
  const save   = () => { onSTPUpdate(model.id, draft); setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const exportSTP = (fmt) => {
    const headers = ["Brand", "Model", "PO", "SKU", "Material", "Units", "STP Status"];
    const body = rows.map((r) => [model.brand, model.name, model.po || "",
      r.sku || "", r.material || "", r.units, draft[r.rid] || "Not Sent"]);
    downloadReport(`STP_${model.brand}_${model.name}`, headers, body, fmt);
  };

  const count = (st) => rows.filter((r) => draft[r.rid] === st).length;
  const missingData = rows.filter((r) => !r.material || !r.sku);

  return (
    <div>
      <h2 style={{ color: "var(--warn)" }}>▸ Production — STP file per SKU</h2>
      <div className="card">
        <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 12, lineHeight: 1.5 }}>
          Each SKU has its own STP file, so one material can be rejected while the rest pass.
        </div>

        {missingData.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--bad)", marginBottom: 12 }}>
            {missingData.length} SKU{missingData.length > 1 ? "s" : ""} missing a material or code — fix in Planned before filing.
          </div>
        )}

        {/* set every row at once */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: "var(--dim)" }}>Set all:</span>
          {STP_STATUSES.map((st) => (
            <button key={st} className="btn" style={{ fontSize: 11, padding: "3px 8px" }}
              onClick={() => setAll(st)}>{st}</button>
          ))}
        </div>

        <div style={{ overflowX: "auto", marginBottom: 12 }}>
          <table>
            <thead><tr><th>SKU</th><th>Material</th><th>Units</th><th style={{ minWidth: 150 }}>STP status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rid} style={{ cursor: "default" }}>
                  <td className="n" style={{ fontWeight: 550, fontSize: 12 }}>{r.sku || <span style={{ color: "var(--warn)" }}>missing</span>}</td>
                  <td style={{ color: "var(--dim)", fontSize: 12 }}>{r.material || <span style={{ color: "var(--bad)" }}>missing</span>}</td>
                  <td className="n">{qty(r.units)}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <select value={draft[r.rid] || "Not Sent"} style={{ fontSize: 12 }}
                      onChange={(e) => setDraft((d) => ({ ...d, [r.rid]: e.target.value }))}>
                      {STP_STATUSES.map((st) => <option key={st}>{st}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" data-primary="1" onClick={save}>{saved ? "✓ Saved" : "Save STP status"}</button>
          <button className="btn" onClick={() => exportSTP("csv")}>↓ CSV</button>
          <button className="btn" onClick={() => exportSTP("excel")}>↓ Excel</button>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {count("Completed") > 0 && <Tag tone="ok">{count("Completed")} completed</Tag>}
            {count("Rejected")  > 0 && <Tag tone="bad">{count("Rejected")} rejected</Tag>}
            {count("Not Sent")  > 0 && <Tag>{count("Not Sent")} not sent</Tag>}
          </span>
        </div>
      </div>
    </div>
  );
}


/* ── RECEIVED STAGE: GOODS RECEIPT ───────────────────────────────
   For each cover type, tick how many arrived (or mark as not received).
   All covers must be confirmed before you can move to Live.        */

function ReceivedChecker({ model, onSave }) {
  const [rows, setRows] = useState(() =>
    allSkus(model).map((r) => ({
      rid: r.rid, sku: r.sku, material: r.material,
      planned: r.units,
      received: r.receivedQty ?? null,
      state: r.receiptState ?? null,
    }))
  );
  const [saved, setSaved] = useState(false);

  /* Typing a quantity decides the state, so the two can never disagree. */
  const setQty = (rid, qtyIn) => setRows((rs) => rs.map((row) => {
    if (row.rid !== rid) return row;
    const n = qtyIn === "" ? null : Math.max(0, +qtyIn);
    if (n === null) return { ...row, received: null, state: null };
    return { ...row, received: n,
      state: n === 0 ? "none" : n >= row.planned ? "full" : "short" };
  }));

  /* Quick buttons for the two common cases */
  const markFull = (rid) => setRows((rs) => rs.map((r) =>
    r.rid === rid ? { ...r, received: r.planned, state: "full" } : r));
  const markNone = (rid) => setRows((rs) => rs.map((r) =>
    r.rid === rid ? { ...r, received: 0, state: "none" } : r));
  const markAllFull = () => setRows((rs) => rs.map((r) => ({ ...r, received: r.planned, state: "full" })));

  const save = () => { onSave(model.id, rows); setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const pending   = rows.filter((r) => r.state == null).length;
  const short     = rows.filter((r) => r.state === "short");
  const none      = rows.filter((r) => r.state === "none");
  const totalPlan = rows.reduce((s, r) => s + r.planned, 0);
  const totalRecd = rows.reduce((s, r) => s + (r.received || 0), 0);
  const gap       = totalPlan - totalRecd;

  return (
    <div>
      <h2 style={{ color: "var(--warn)" }}>▸ Received — confirm each SKU</h2>
      <div className="card">
        <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 12, lineHeight: 1.5 }}>
          Type how many actually arrived. Short deliveries are recorded, not hidden —
          the shortfall shows up in the received report so you can chase it.
        </div>

        <button className="btn" style={{ fontSize: 11, padding: "4px 9px", marginBottom: 12 }}
          onClick={markAllFull}>Mark all received in full</button>

        <div style={{ overflowX: "auto", marginBottom: 12 }}>
          <table>
            <thead><tr>
              <th>SKU</th><th>Material</th><th>Planned</th>
              <th style={{ minWidth: 110 }}>Received</th><th>Short by</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const gapRow = r.state == null ? null : Math.max(0, r.planned - (r.received || 0));
                return (
                  <tr key={r.rid} style={{ cursor: "default" }}>
                    <td className="n" style={{ fontWeight: 550, fontSize: 12 }}>{r.sku || "—"}</td>
                    <td style={{ color: "var(--dim)", fontSize: 12 }}>{r.material || "—"}</td>
                    <td className="n">{qty(r.planned)}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <input type="number" min="0" value={r.received ?? ""} placeholder="qty"
                        style={{ fontFamily: "var(--mono)", fontSize: 12, width: 100 }}
                        onChange={(e) => setQty(r.rid, e.target.value)} />
                    </td>
                    <td className="n" style={{ color: gapRow > 0 ? "var(--bad)" : "var(--dim)" }}>
                      {gapRow == null ? "—" : gapRow > 0 ? qty(gapRow) : "0"}
                    </td>
                    <td>
                      <Tag tone={r.state === "full" ? "ok" : r.state === "short" ? "warn" : r.state === "none" ? "bad" : undefined}>
                        {receiptLabel(r)}
                      </Tag>
                    </td>
                    <td style={{ whiteSpace: "nowrap", padding: "6px 4px" }}>
                      <button className="btn" title="Received in full"
                        style={{ padding: "3px 6px", fontSize: 11 }}
                        onClick={() => markFull(r.rid)}><CheckCircle2 size={11} /></button>
                      <button className="btn" title="Nothing arrived"
                        style={{ padding: "3px 6px", fontSize: 11, marginLeft: 4, color: "var(--bad)" }}
                        onClick={() => markNone(r.rid)}><X size={11} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" data-primary="1" onClick={save}>{saved ? "✓ Saved" : "Save receipt"}</button>
          {pending > 0
            ? <Tag>{pending} still unconfirmed</Tag>
            : gap > 0
              ? <Tag tone="warn">{qty(gap)} units short overall</Tag>
              : <Tag tone="ok">All {qty(totalRecd)} units received</Tag>}
          {short.length > 0 && <Tag tone="warn">{short.length} short</Tag>}
          {none.length  > 0 && <Tag tone="bad">{none.length} not received</Tag>}
        </div>
      </div>
    </div>
  );
}


/* ── LISTING — PER SKU, PER MARKETPLACE ──────────────────────────
   A grid of SKUs down the side and marketplaces across the top.
   Click any cell to cycle its status.                             */

function ListingEditor({ model, onSave }) {
  const rows = allSkus(model);
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(rows.map((r) => [r.rid, { ...(r.listings || {}) }]))
  );
  const [saved, setSaved] = useState(false);

  const cycle = (rid, mp) => setDraft((d) => {
    const cur  = d[rid]?.[mp] || "Not listed";
    const next = LISTING_STATES[(LISTING_STATES.indexOf(cur) + 1) % LISTING_STATES.length];
    return { ...d, [rid]: { ...d[rid], [mp]: next } };
  });

  const setColumn = (mp, st) => setDraft((d) => {
    const n = { ...d };
    rows.forEach((r) => { n[r.rid] = { ...n[r.rid], [mp]: st }; });
    return n;
  });

  const setAllLive = () => setDraft(Object.fromEntries(
    rows.map((r) => [r.rid, Object.fromEntries(MARKETPLACES.map((mp) => [mp, "Live"]))])
  ));

  const save = () => { onSave(model.id, draft); setSaved(true); setTimeout(() => setSaved(false), 2000); };

  /* counts read from the draft so the summary updates as you click */
  const liveOn    = (mp) => rows.filter((r) => draft[r.rid]?.[mp] === "Live").length;
  const blockedOn = (mp) => rows.filter((r) => draft[r.rid]?.[mp] === "Blocked").length;
  const fully     = rows.filter((r) => MARKETPLACES.every((mp) => draft[r.rid]?.[mp] === "Live")).length;
  const anyBlocked = rows.filter((r) => MARKETPLACES.some((mp) => draft[r.rid]?.[mp] === "Blocked")).length;

  const exportListing = (fmt) => {
    const headers = ["Brand", "Model", "SKU", "Material", ...MARKETPLACES, "Fully listed"];
    const body = rows.map((r) => [
      model.brand, model.name, r.sku || "", r.material || "",
      ...MARKETPLACES.map((mp) => draft[r.rid]?.[mp] || "Not listed"),
      MARKETPLACES.every((mp) => draft[r.rid]?.[mp] === "Live") ? "Yes" : "No",
    ]);
    downloadReport(`Listing_${model.brand}_${model.name}`, headers, body, fmt);
  };

  if (!rows.length) return null;

  return (
    <div>
      <h2 style={{ color: "var(--warn)" }}>▸ Marketplace listing</h2>
      <div className="card">
        <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 12, lineHeight: 1.5 }}>
          Click any cell to cycle it: Not listed → In progress → Live → Blocked.
          Use a column header button to set a whole marketplace at once.
        </div>

        <button className="btn" style={{ fontSize: 11, padding: "4px 9px", marginBottom: 12 }}
          onClick={setAllLive}>Mark everything live</button>

        <div style={{ overflowX: "auto", marginBottom: 12 }}>
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>SKU</th>
                <th style={{ minWidth: 130 }}>Material</th>
                {MARKETPLACES.map((mp) => (
                  <th key={mp} style={{ textAlign: "center", minWidth: 96 }}>
                    <div>{mp}</div>
                    <button className="btn"
                      style={{ fontSize: 9, padding: "1px 5px", marginTop: 3, fontWeight: 400 }}
                      onClick={() => setColumn(mp, "Live")}>all live</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rid} style={{ cursor: "default" }}>
                  <td className="n" style={{ fontWeight: 550, fontSize: 12 }}>{r.sku || "—"}</td>
                  <td style={{ color: "var(--dim)", fontSize: 12 }}>{r.material || "—"}</td>
                  {MARKETPLACES.map((mp) => {
                    const st = draft[r.rid]?.[mp] || "Not listed";
                    return (
                      <td key={mp} style={{ textAlign: "center", padding: "6px 4px" }}>
                        <button className="btn"
                          title={`${r.sku || "SKU"} on ${mp} — click to change`}
                          style={{ fontSize: 10, padding: "3px 7px", width: "100%",
                            color: st === "Live" ? "var(--ok)" : st === "Blocked" ? "var(--bad)"
                                 : st === "In progress" ? "var(--warn)" : "var(--dim)",
                            borderColor: st === "Live" ? "var(--ok)" : st === "Blocked" ? "var(--bad)" : undefined }}
                          onClick={() => cycle(r.rid, mp)}>
                          {st === "Not listed" ? "—" : st === "In progress" ? "WIP" : st}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <button className="btn" data-primary="1" onClick={save}>{saved ? "✓ Saved" : "Save listing status"}</button>
          <button className="btn" onClick={() => exportListing("csv")}>↓ CSV</button>
          <button className="btn" onClick={() => exportListing("excel")}>↓ Excel</button>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Tag tone={fully === rows.length ? "ok" : undefined}>{fully} of {rows.length} SKUs fully listed</Tag>
          {anyBlocked > 0 && <Tag tone="bad">{anyBlocked} blocked</Tag>}
          {MARKETPLACES.map((mp) => (
            <Tag key={mp} tone={liveOn(mp) === rows.length ? "ok" : blockedOn(mp) ? "bad" : undefined}>
              {mp} {liveOn(mp)}/{rows.length}
            </Tag>
          ))}
        </div>
      </div>
    </div>
  );
}



/* ── SALES TRACKING — shown when stage === "live" ────────────────
   Log a sale by date, marketplace, units, revenue and returns.
   Entries accumulate; nothing is ever overwritten.               */

function SalesTracker({ model, onSave, canLog }) {
  const [form, setForm] = useState({
    date: iso(TODAY), marketplace: "Flipkart", units: "", revenue: "", returns: "", notes: "",
  });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const s = model.sales;

  const submit = () => {
    if (!form.units || +form.units <= 0) return;
    onSave(model.id, {
      rid: Date.now(),
      date: form.date, marketplace: form.marketplace,
      units: +form.units, revenue: +form.revenue || 0,
      returns: +form.returns || 0, notes: form.notes.trim(),
    });
    setForm((f) => ({ ...f, units: "", revenue: "", returns: "", notes: "" }));
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const exportSales = (fmt) => {
    const entries = model.salesEntries || [];
    const headers = ["Date", "Marketplace", "Units Sold", "Revenue (₹)", "Returns", "Notes"];
    const rows = entries.map((e) => [e.date, e.marketplace, e.units, e.revenue || 0, e.returns || 0, e.notes || ""]);
    downloadReport(`Sales_${model.brand}_${model.name}`, headers, rows, fmt);
  };

  return (
    <div>
      <h2 style={{ color: "var(--ok)" }}>▸ Sales tracking</h2>
      <div className="card">

        {/* KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 16 }}>
          {[
            ["Total units", qty(s.total)],
            ["Last 7 days", qty(s.d7)],
            ["Last 30 days", qty(s.d30)],
            ["Revenue", s.revenue ? "₹" + Math.round(s.revenue).toLocaleString("en-IN") : "—"],
            ["Returns", s.returns > 0 ? qty(s.returns) + " (" + s.returnRate + "%)" : "0"],
          ].map(([label, value], i) => (
            <div key={i} className="card" style={{ padding: "10px 12px", background: "var(--bg)" }}>
              <div style={{ fontSize: 11, color: "var(--dim)" }}>{label}</div>
              <div className="n" style={{ fontSize: 18, fontWeight: 620, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* by marketplace */}
        {Object.keys(s.byMarketplace).length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {SALE_MARKETPLACES.filter(mp => s.byMarketplace[mp]).map((mp) => (
              <div key={mp}>
                <Tag>{mp}</Tag>
                <span className="n" style={{ marginLeft: 6, fontSize: 13 }}>{qty(s.byMarketplace[mp])}</span>
              </div>
            ))}
          </div>
        )}

        {/* log new entry */}
        {canLog ? (
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Log a sale</div>
            <div className="two" style={{ marginBottom: 10 }}>
              <Field label="Date">
                <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
              </Field>
              <Field label="Marketplace">
                <select value={form.marketplace} onChange={(e) => set("marketplace", e.target.value)}>
                  {SALE_MARKETPLACES.map((mp) => <option key={mp}>{mp}</option>)}
                </select>
              </Field>
            </div>
            <div className="two" style={{ marginBottom: 10 }}>
              <Field label="Units sold *">
                <input type="number" min="0" value={form.units} placeholder="0"
                  style={{ fontFamily: "var(--mono)" }}
                  onChange={(e) => set("units", e.target.value)} />
              </Field>
              <Field label="Revenue (₹)">
                <input type="number" min="0" value={form.revenue} placeholder="0"
                  style={{ fontFamily: "var(--mono)" }}
                  onChange={(e) => set("revenue", e.target.value)} />
              </Field>
            </div>
            <div className="two" style={{ marginBottom: 10 }}>
              <Field label="Returns">
                <input type="number" min="0" value={form.returns} placeholder="0"
                  style={{ fontFamily: "var(--mono)" }}
                  onChange={(e) => set("returns", e.target.value)} />
              </Field>
              <Field label="Notes (optional)">
                <input value={form.notes} placeholder="Flipkart sale event, etc."
                  onChange={(e) => set("notes", e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && +form.units > 0 && submit()} />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" data-primary="1"
                style={{ opacity: +form.units > 0 ? 1 : 0.4 }}
                onClick={() => +form.units > 0 && submit()}>
                {saved ? "✓ Logged" : "Log sale"}
              </button>
              <button className="btn" onClick={() => exportSales("csv")}>↓ CSV</button>
              <button className="btn" onClick={() => exportSales("excel")}>↓ Excel</button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--dim)", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            Sales can be logged by the Sales or Admin role.
          </div>
        )}

        {/* entry history */}
        {(model.salesEntries || []).length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              History — {(model.salesEntries || []).length} entr{(model.salesEntries || []).length === 1 ? "y" : "ies"}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>Date</th><th>Marketplace</th><th>Units</th><th>Revenue</th><th>Returns</th><th>Notes</th></tr></thead>
                <tbody>
                  {[...(model.salesEntries || [])].reverse().slice(0, 20).map((e) => (
                    <tr key={e.rid} style={{ cursor: "default" }}>
                      <td className="n" style={{ fontSize: 12 }}>{showDate(e.date)}</td>
                      <td style={{ fontSize: 12 }}>{e.marketplace}</td>
                      <td className="n">{qty(e.units)}</td>
                      <td className="n" style={{ fontSize: 12 }}>{e.revenue ? "₹" + Math.round(e.revenue).toLocaleString("en-IN") : "—"}</td>
                      <td className="n" style={{ fontSize: 12, color: e.returns > 0 ? "var(--bad)" : undefined }}>{e.returns || 0}</td>
                      <td style={{ fontSize: 11, color: "var(--dim)" }}>{e.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!(model.salesEntries || []).length && s.total === 0 && (
          <div style={{ fontSize: 13, color: "var(--dim)", marginTop: 10 }}>
            No sales logged yet. Log the first entry above.
          </div>
        )}
      </div>
    </div>
  );
}


/* ── RESEARCH STAGE: EDIT PHONE DETAILS ─────────────────────────
   Inline editor in the detail panel so you can correct the brand,
   model name, launch date and segment right where you're looking. */

function ResearchEditor({ model, onSave }) {
  if (!onSave) return (
    <div>
      <h2 style={{ color: "var(--warn)" }}>▸ Research — edit phone details</h2>
      <div className="card" style={{ color: "var(--dim)", fontSize: 13 }}>
        Your role cannot edit phone details. Contact Procurement or Admin.
      </div>
    </div>
  );
  const [form, setForm] = useState({
    brand:   model.brand,
    name:    model.name,
    launch:  model.launch,
    segment: model.segment,
  });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.brand.trim() || !form.name.trim() || !form.launch) return;
    onSave(model.id, form);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <h2 style={{ color: "var(--warn)" }}>▸ Research — edit phone details</h2>
      <div className="card">
        <div className="two" style={{ marginBottom: 12 }}>
          <Field label="Brand">
            <input value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Samsung" />
          </Field>
          <Field label="Model name">
            <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Galaxy A57 5G" />
          </Field>
        </div>
        <div className="two" style={{ marginBottom: 12 }}>
          <Field label="Launch date"
            hint={form.launch ? `Research deadline: ${showDate(shift(form.launch, -STAGES[0].daysBeforeLaunch))}` : ""}>
            <input type="date" value={form.launch} onChange={(e) => set("launch", e.target.value)} />
          </Field>
          <Field label="Price segment">
            <select value={form.segment} onChange={(e) => set("segment", e.target.value)}>
              {["Budget", "Mid Range", "Premium", "Flagship"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
        <button className="btn" data-primary="1" onClick={save}
          style={{ opacity: (!form.brand.trim() || !form.name.trim() || !form.launch) ? 0.4 : 1 }}>
          {saved ? "✓ Saved" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function Detail({ model, onClose, onAdvance, onGoBack, onResearchSave, onSKUSave, onSTPUpdate, onReceiptSave, onPOSave, onListingSave, onSalesLog, canLog, role }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isLast = model.index === STAGES.length - 1;
  const isFirst = model.index === 0;

  return (
    <>
      <div className="shade" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label={`${model.brand} ${model.name}`}>
        <div className="panel-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 640 }}>{model.brand} {model.name}</div>
            <div className="sub">
              {model.segment} · launches {showDate(model.launch)} ·{" "}
              {model.daysToLaunch < 0 ? `${-model.daysToLaunch} days ago` : `in ${model.daysToLaunch} days`}
            </div>
          </div>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>

        <div className="panel-body">
          {/* covers */}
          <div>
            <h2>SKUs planned — {allSkus(model).length} SKU{allSkus(model).length !== 1 ? "s" : ""}, {qty(model.units)} units</h2>
            {allSkus(model).length ? (
              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <table>
                  <thead><tr><th>SKU</th><th>Material</th><th>Units</th></tr></thead>
                  <tbody>
                    {allSkus(model).map((r) => (
                      <tr key={r.rid} style={{ cursor: "default" }}>
                        <td className="n" style={{ fontWeight: 550, fontSize: 12 }}>
                          {r.sku || <span style={{ color: "var(--warn)" }}>no SKU</span>}
                        </td>
                        <td style={{ color: "var(--dim)", fontSize: 12 }}>
                          {r.material || <span style={{ color: "var(--bad)" }}>—</span>}
                        </td>
                        <td className="n">{qty(r.units)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div style={{ color: "var(--dim)", fontSize: 13 }}>No SKUs planned yet.</div>}
          </div>

          {/* Research stage: edit phone details */}
          {model.stage === "research" && (
            <ResearchEditor model={model} onSave={onResearchSave} />
          )}

          {/* Covers stay editable after Planned — a new colour can come up
              mid-production and you shouldn't have to move the phone back. */}
          {["planned", "ordered", "production"].includes(model.stage) && (
            <PlannedSKUEditor model={model} onSave={onSKUSave} stage={model.stage} />
          )}

          {/* Ordered stage: export SKU list for the supplier */}
          {model.stage === "ordered" && (
            <SKUExport model={model} onPOSave={onPOSave} />
          )}

          {/* Production stage: STP file + status */}
          {model.stage === "production" && (
            <ProductionSTP model={model} onSTPUpdate={onSTPUpdate} />
          )}

          {/* Received stage: goods receipt per cover type */}
          {model.stage === "received" && (
            <ReceivedChecker model={model} onSave={onReceiptSave} />
          )}

          {/* Listing can start as soon as stock is in, and stays editable once live */}
          {["received", "live"].includes(model.stage) && (
            <ListingEditor model={model} onSave={onListingSave} />
          )}

          {/* Sales tracking */}
          {model.stage === "live" && (
            <SalesTracker model={model} onSave={onSalesLog} canLog={canLog} />
          )}

          {/* the pipeline */}
          <div>
            <h2>Progress</h2>
            {model.runway.isRushed && (
              <div className="card" style={{ borderColor: "var(--warn)", marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  <strong style={{ color: "var(--warn)" }}>Short runway.</strong>{" "}
                  You found this phone {model.runway.have} days before launch. The full process
                  normally wants {model.runway.need}. Deadlines below are squeezed to what time is left.
                </div>
              </div>
            )}
            <div className="card">
              {STAGES.map((stage, i) => {
                const doneOn  = model.done[stage.key];
                const planned = plannedDate(model, stage.key);
                const delay   = delayOf(model, stage.key);
                const state   = doneOn ? (delay > 3 ? "late" : "done")
                              : i === model.index + 1 ? (delay > 3 ? "late" : "now")
                              : delay > 3 ? "late" : "todo";
                return (
                  <div className="step" key={stage.key} data-state={state}>
                    <div className="dot">
                      {doneOn ? <CheckCircle2 size={12} />
                        : state === "late" ? <AlertTriangle size={11} />
                        : <Circle size={7} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row">
                        <span className="step-name">{stage.label}</span>
                        {delay > 3 && <span style={{ marginLeft: "auto" }}><Tag tone="bad">{delay}d late</Tag></span>}
                      </div>
                      <div className="step-sub n">
                        {doneOn ? `Done ${showDate(doneOn)}` : `Due ${showDate(planned)}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="panel-foot">
          {model.index > 0 && (
            <button className="btn" onClick={() => onGoBack(model.id)}
              title={`Move back to ${STAGES[model.index - 1].label}`}>
              ← {STAGES[model.index - 1].label}
            </button>
          )}
          {!isLast && (() => {
            const st = advanceStatus(model, role);
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button className="btn" data-primary={st.ok ? "1" : undefined}
                  style={{ opacity: st.ok ? 1 : 0.4, cursor: st.ok ? undefined : "not-allowed" }}
                  onClick={() => st.ok && onAdvance(model.id)}>
                  Move to {st.next.label} →
                </button>
                {!st.ok && st.reason && (
                  <span style={{ fontSize: 11, color: "var(--bad)" }}>{st.reason}</span>
                )}
              </div>
            );
          })()}
          <button className="btn" onClick={onClose} style={{ marginLeft: "auto" }}>Close</button>
        </div>
      </aside>
    </>
  );
}


/* ── 11. ADD FORM ─────────────────────────────────────────────── */

const NEW_MODEL = {
  brand: "", name: "", segment: "Mid Range", launch: "",
  covers: [],
};

function AddForm({ onClose, onSave }) {
  const [form, setForm] = useState(NEW_MODEL);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkErr, setBulkErr] = useState("");
  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);


  const daysLeft = form.launch ? daysFromToday(form.launch) : null;

  const launchHint = !form.launch ? "All six deadlines come from this"
    : daysLeft < 0 ? "That date has already passed"
    : daysLeft < STAGES[0].daysBeforeLaunch
      ? `Only ${daysLeft} days away — the full process wants ${STAGES[0].daysBeforeLaunch}. It will be tight.`
      : `Comfortable. Research due ${showDate(shift(form.launch, -STAGES[0].daysBeforeLaunch))}.`;

  const problems = [
    !form.brand.trim() && "Enter a brand",
    !form.name.trim() && "Enter a model name",
    !form.launch && "Pick a launch date",
  ].filter(Boolean);

  const save = () => {
    if (problems.length) return;
    onSave({
      brand: form.brand.trim(),
      name: form.name.trim(),
      segment: form.segment,
      launch: form.launch,
      skus: [],   // SKUs are added in the Planned stage
      stage: "research",
      po: null,
      done: { research: iso(TODAY) },
    });
  };

  return (
    <>
      <div className="shade" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label="Add a phone">
        <div className="panel-head">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 640 }}>Add a phone</div>
            <div className="sub">Add a phone to track it through the pipeline.</div>
          </div>
          <button className="btn btn-icon" onClick={onClose} aria-label="Cancel"><X size={15} /></button>
        </div>

        <div className="panel-body">
          <div>
            <h2>The phone</h2>
            <div className="two">
              <Field label="Brand"><input value={form.brand} onChange={(e) => update({ brand: e.target.value })} placeholder="Samsung" autoFocus /></Field>
              <Field label="Model"><input value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder="Galaxy A57" /></Field>
            </div>
            <div className="two">
              <Field label="Launch date" hint={launchHint}>
                <input type="date" value={form.launch} onChange={(e) => update({ launch: e.target.value })} />
              </Field>
              <Field label="Segment">
                <select value={form.segment} onChange={(e) => update({ segment: e.target.value })}>
                  {["Budget", "Mid Range", "Premium", "Flagship"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          </div>

          <div className="card" style={{ borderColor: "var(--warn)" }}>
            <h2 style={{ color: "var(--warn)" }}>Covers are planned in the next stage</h2>
            <div style={{ fontSize: 13, color: "var(--dim)", lineHeight: 1.6 }}>
              Once you move this phone to <strong>Planned</strong>, you will choose which
              cover types to make, set units, assign SKUs and materials — all in one place.
              Keep this step simple: just confirm the phone is worth tracking.
            </div>
          </div>

          {problems.length > 0 && (
            <div className="card" style={{ borderColor: "var(--warn)" }}>
              <h2 style={{ color: "var(--warn)" }}>Before you save</h2>
              {problems.map((p) => (
                <div key={p} style={{ fontSize: 12.5, color: "var(--dim)", padding: "3px 0" }}>· {p}</div>
              ))}
            </div>
          )}
        </div>

        <div className="panel-foot">
          <button className="btn" data-primary="1" onClick={save} style={{ opacity: problems.length ? .5 : 1 }}>
            Add phone
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </aside>
    </>
  );
}


/* ── 12. THE APP ─────────────────────────────────────────────────
   All the state lives here and flows downward:
     phones   – the raw list (in a real app, from the database)
     openId   – which phone's detail panel is showing
     adding   – is the add form open
     view     – board or table                                      */


/* ── REPORT DOWNLOAD UTILITY ─────────────────────────────────────
   One function, two formats. Called by the stats cards and from
   anywhere else that needs to download tabular data.              */

function downloadReport(filename, headers, rows, fmt) {
  const isCSV = fmt === "csv";
  const lines = [headers, ...rows].map((r) =>
    isCSV
      ? r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
      : r.join("\t")
  ).join("\n");
  const mime = isCSV ? "text/csv" : "application/vnd.ms-excel";
  const ext  = isCSV ? ".csv" : ".xls";
  const a    = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + lines], { type: mime + ";charset=utf-8;" }));
  a.download = filename.replace(/\s+/g, "_") + ext;
  a.click(); URL.revokeObjectURL(a.href);
}

/* Planned report — every phone at Planned stage with cover details */
function plannedReport(models, fmt) {
  const headers = ["Brand", "Model", "Segment", "Launch Date", "SKU", "Material", "Units Planned"];
  const rows = [];
  models.filter((m) => m.stage === "planned").forEach((m) =>
    allSkus(m).forEach((r) =>
      rows.push([m.brand, m.name, m.segment, m.launch, r.sku || "", r.material || "", r.units])
    )
  );
  downloadReport("Planned_Models_Report", headers, rows, fmt);
}

/* Ordered report — every phone at Ordered with full SKU list */
function orderedReport(models, fmt) {
  const headers = ["Brand", "Model", "Segment", "Launch Date", "PO Number", "SKU", "Material", "Units"];
  const rows = [];
  models.filter((m) => m.stage === "ordered").forEach((m) =>
    allSkus(m).forEach((r) =>
      rows.push([m.brand, m.name, m.segment, m.launch, m.po || "", r.sku || "", r.material || "", r.units])
    )
  );
  downloadReport("Ordered_Models_Report", headers, rows, fmt);
}

/* Production STP summary — every phone in Production with STP status */
function productionReport(models, fmt) {
  const headers = [
    "Brand", "Model", "Segment", "Launch Date", "PO Number",
    "Cover Type", "Material", "SKU", "Units",
    "STP Required", "STP Status"
  ];
  const rows = [];
  models.filter((m) => m.stage === "production").forEach((m) =>
    allSkus(m).forEach((r) => {
      const stpRequired = (!r.material || !r.sku) ? "YES — missing data" : "YES";
      rows.push([
        m.brand, m.name, m.segment, m.launch, m.po || "",
        r.sku || "MISSING", r.material || "MISSING", r.units,
        stpRequired, r.stpStatus || "Not Sent"
      ]);
    })
  );
  downloadReport("Production_STP_Summary", headers, rows, fmt);
}


/* ── KPI CARD ─────────────────────────────────────────────────── */
function KPI({ label, value, sub, tone, onCSV, onXLS }) {
  return (
    <div className="kpi" data-tone={tone}>
      {(onCSV || onXLS) && (
        <div className="kpi-dl">
          {onCSV && <button className="btn" onClick={onCSV} title="Download CSV">CSV</button>}
          {onXLS && <button className="btn" onClick={onXLS} title="Download Excel">XLS</button>}
        </div>
      )}
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}


/* ── DASHBOARD ─────────────────────────────────────────────────── */
function Dashboard({ models, onOpen, onAdd }) {
  const byStage   = (k) => models.filter((m) => m.stage === k);
  const late      = models.filter((m) => m.isLate);
  const live      = byStage("live");
  const research  = byStage("research");
  const planned   = byStage("planned");
  const ordered   = byStage("ordered");
  const prod      = byStage("production");
  const received  = byStage("received");

  const totalUnits    = models.reduce((s, m) => s + m.units, 0);
  const liveUnits     = live.reduce((s, m) => s + m.units, 0);
  const prodUnits     = prod.reduce((s, m) => s + m.units, 0);
  const stpNotSent    = prod.filter((m) => allSkus(m).some((r) => !r.stpStatus || r.stpStatus === "Not Sent")).length;
  const stpDone       = prod.filter((m) => allSkus(m).length && allSkus(m).every((r) => r.stpStatus === "Completed")).length;
  const noCovers      = planned.filter((m) => allSkus(m).length === 0).length;
  const missingSkus   = planned.filter((m) => allSkus(m).some((r) => !r.sku?.trim())).length;
  const unconfRec     = received.filter((m) => allSkus(m).some((r) => !isConfirmed(r))).length;
  const listable      = models.filter((m) => ["received","live"].includes(m.stage) && allSkus(m).length);
  const fullyListed   = listable.filter((m) => allSkus(m).every(isFullyListed)).length;
  const listBlocked   = listable.filter((m) => allSkus(m).some((r) => blockedCount(r) > 0)).length;
  const launching14   = models.filter((m) => m.stage !== "live" && m.daysToLaunch >= 0 && m.daysToLaunch <= 14);

  /* funnel max for % bar width */
  const funnelMax = Math.max(1, models.length);

  const problems = models.flatMap(problemsOf);

  return (
    <div>
      {/* ── empty state ── */}
      {models.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px", marginBottom: 20 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📱</div>
          <div style={{ fontSize: 17, fontWeight: 640, marginBottom: 8 }}>No phones tracked yet</div>
          <div style={{ fontSize: 13, color: "var(--dim)", marginBottom: 20, lineHeight: 1.6, maxWidth: 360, margin: "0 auto 20px" }}>
            Click <strong>Add phone</strong> to start tracking your first new model.
            Every phone moves through Research → Planned → Ordered → Production → Received → Live.
          </div>
          <button className="btn" data-primary="1" onClick={onAdd}>
            <Plus size={14} />Add your first phone
          </button>
        </div>
      )}

      {/* ── 10 KPI cards ── */}
      {models.length > 0 && <div style={{ marginBottom: 6 }}>
        <h2>Key numbers</h2>
      </div>}
      {models.length > 0 && <div className="kpi-grid">
        <KPI label="Phones tracked"   value={models.length}   sub="across all stages" />
        <KPI label="Research"         value={research.length} sub={research.length ? research.map(m=>m.name).join(", ").slice(0,40) : "None yet"} />
        <KPI label="Planned"          value={planned.length}
          tone={noCovers > 0 ? "warn" : planned.length > 0 ? "ok" : undefined}
          sub={noCovers > 0 ? `${noCovers} need covers added` : missingSkus > 0 ? `${missingSkus} missing SKU` : planned.length > 0 ? "All have SKUs" : "None yet"}
          onCSV={planned.length ? () => plannedReport(models, "csv") : undefined}
          onXLS={planned.length ? () => plannedReport(models, "excel") : undefined} />
        <KPI label="Ordered"          value={ordered.length}
          tone={ordered.length > 0 ? "accent" : undefined}
          sub={ordered.length ? `${ordered.reduce((s,m)=>s+allSkus(m).length,0)} SKUs on order` : "None yet"}
          onCSV={ordered.length ? () => orderedReport(models, "csv") : undefined}
          onXLS={ordered.length ? () => orderedReport(models, "excel") : undefined} />
        <KPI label="In production"    value={prod.length}
          tone={stpNotSent > 0 ? "warn" : prod.length > 0 ? "ok" : undefined}
          sub={prod.length ? (stpNotSent > 0 ? `${stpNotSent} STP not sent` : `${stpDone}/${prod.length} STP done`) : "None yet"}
          onCSV={prod.length ? () => productionReport(models, "csv") : undefined}
          onXLS={prod.length ? () => productionReport(models, "excel") : undefined} />
        <KPI label="Received"         value={received.length}
          tone={unconfRec > 0 ? "warn" : received.length > 0 ? "ok" : undefined}
          sub={received.length ? (unconfRec > 0 ? `${unconfRec} unconfirmed` : "All confirmed") : "None yet"} />
        <KPI label="Live & selling"   value={live.length}  tone={live.length > 0 ? "ok" : undefined}
          sub={live.length ? `${qty(liveUnits)} units in market` : "Nothing live yet"} />
        <KPI label="Units sold"
             value={qty(models.filter(m=>m.stage==="live").reduce((s,m)=>s+m.sales.total,0))}
             sub={(() => {
               const rev = models.filter(m=>m.stage==="live").reduce((s,m)=>s+m.sales.revenue,0);
               return rev > 0 ? "₹"+Math.round(rev).toLocaleString("en-IN")+" revenue" : "Live phones only";
             })()}
             tone={models.some(m=>m.stage==="live"&&m.sales.total>0) ? "ok" : undefined} />
        <KPI label="Fully listed"      value={fullyListed}
             tone={listable.length && fullyListed === listable.length ? "ok" : listBlocked ? "bad" : undefined}
             sub={listable.length
               ? `of ${listable.length} ready${listBlocked ? ` · ${listBlocked} blocked` : ""}`
               : "None ready yet"} />
        <KPI label="Running late"     value={late.length}  tone={late.length > 0 ? "bad" : "ok"}
          sub={late.length > 0 ? `${late.map(m=>m.name).join(", ").slice(0,40)}` : "All on time"} />
        <KPI label="Launching ≤ 14d"  value={launching14.length}
          tone={launching14.length > 0 ? "warn" : undefined}
          sub={launching14.length ? launching14.map(m=>`${m.name} in ${m.daysToLaunch}d`).join(", ").slice(0,50) : "None urgent"} />
        <KPI label="Units in pipeline" value={qty(totalUnits)} tone="accent"
          sub={liveUnits ? `${qty(liveUnits)} live · ${qty(totalUnits - liveUnits)} in pipeline` : "No live yet"} />
      </div>}

      {/* ── pipeline funnel ── */}
      {models.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
        <div className="card">
          <h2>Pipeline funnel</h2>
          <div className="funnel">
            {STAGES.map((st) => {
              const n = byStage(st.key).length;
              return (
                <div className="funnel-row" key={st.key}>
                  <span style={{ color: "var(--dim)", fontSize: 12 }}>{st.label}</span>
                  <div style={{ background: "var(--line)", borderRadius: 4, height: 18, overflow: "hidden" }}>
                    <div className="funnel-bar" style={{ width: n ? (n / funnelMax) * 100 + "%" : "0%" }} />
                  </div>
                  <span className="funnel-n">{n}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── segment breakdown ── */}
        <div className="card">
          <h2>By segment</h2>
          <div className="funnel">
            {["Budget", "Mid Range", "Premium", "Flagship"].map((seg) => {
              const n = models.filter((m) => m.segment === seg).length;
              return (
                <div className="funnel-row" key={seg}>
                  <span style={{ color: "var(--dim)", fontSize: 12 }}>{seg}</span>
                  <div style={{ background: "var(--line)", borderRadius: 4, height: 18, overflow: "hidden" }}>
                    <div className="funnel-bar" style={{ width: n ? (n / funnelMax) * 100 + "%" : "0%", background: "var(--ok)" }} />
                  </div>
                  <span className="funnel-n">{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>}

      {/* ── alerts ── */}
      {models.length > 0 && problems.length > 0 && (
        <div className="card">
          <h2>Needs attention — {problems.length} item{problems.length !== 1 ? "s" : ""}</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {problems.map((p, i) => (
              <div key={i} className="row" style={{ cursor: "pointer", padding: "6px 0",
                borderBottom: i < problems.length - 1 ? "1px solid var(--line)" : "none" }}
                onClick={() => onOpen(p.model.id)}>
                <AlertTriangle size={14}
                  style={{ color: p.type === "bad" ? "var(--bad)" : "var(--warn)", flex: "0 0 14px" }} />
                <span style={{ fontWeight: 570, fontSize: 13 }}>{p.model.brand} {p.model.name}</span>
                <Tag tone={p.type}>{STAGES[p.model.index].label}</Tag>
                <span style={{ color: "var(--dim)", fontSize: 13 }}>— {p.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {models.length > 0 && problems.length === 0 && (
        <div className="card" style={{ borderColor: "color-mix(in srgb, var(--ok) 40%, var(--line))" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
            <CheckCircle2 size={16} style={{ color: "var(--ok)" }} />
            <span>Everything is on track. No alerts to show.</span>
          </div>
        </div>
      )}
    </div>
  );
}



/* ── PURCHASE ORDERS ─────────────────────────────────────────────
   One PO usually covers several phone models at once. This view
   lets you tick the models going onto a PO, assign the number to
   all of them, and export a single combined SKU sheet for the
   supplier. Existing POs are grouped so you can see what's on each.
   ─────────────────────────────────────────────────────────────── */

function POManager({ models, onAssign, onOpen, canEdit }) {
  const [picked, setPicked]   = useState({});     // { modelId: true }
  const [poNum, setPoNum]     = useState("");
  const [expanded, setExpanded] = useState({});   // { poNumber: true }

  /* Models that can go on a PO: at Ordered, or at Planned with all SKUs coded */
  const eligible = models.filter((m) =>
    m.stage === "ordered" || (m.stage === "planned" && !gateBlock(m)));

  const unassigned = eligible.filter((m) => !m.po);
  const chosen     = eligible.filter((m) => picked[m.id]);
  const chosenSkus = chosen.flatMap(allSkus);
  const chosenUnits = chosenSkus.reduce((t, r) => t + (r.units || 0), 0);

  const toggle = (id) => setPicked((p) => ({ ...p, [id]: !p[id] }));
  const pickAll = () => setPicked(Object.fromEntries(unassigned.map((m) => [m.id, true])));
  const clearAll = () => setPicked({});

  const assign = () => {
    if (!poNum.trim() || !chosen.length) return;
    onAssign(chosen.map((m) => m.id), poNum.trim());
    setPicked({}); setPoNum("");
  };

  /* Group every model that already has a PO */
  const groups = {};
  models.filter((m) => m.po).forEach((m) => { (groups[m.po] ||= []).push(m); });
  const poNumbers = Object.keys(groups).sort();

  /* Export one PO as a combined SKU sheet */
  const exportPO = (po, list, fmt) => {
    const headers = ["PO Number", "Brand", "Model", "Launch Date", "SKU", "Material", "Units"];
    const rows = list.flatMap((m) =>
      allSkus(m).map((r) => [po, m.brand, m.name, m.launch, r.sku || "", r.material || "", r.units]));
    downloadReport("PO_" + po.replace(/[^\w-]/g, "_"), headers, rows, fmt);
  };

  /* Export the draft selection before it's even assigned */
  const exportDraft = (fmt) => {
    const headers = ["PO Number", "Brand", "Model", "Launch Date", "SKU", "Material", "Units"];
    const rows = chosen.flatMap((m) =>
      allSkus(m).map((r) => [poNum || "DRAFT", m.brand, m.name, m.launch, r.sku || "", r.material || "", r.units]));
    downloadReport("PO_draft", headers, rows, fmt);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* ── build a new PO ── */}
      {canEdit && (
        <div>
          <h2>Create a purchase order</h2>
          <div className="card">
            {unassigned.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--dim)" }}>
                Every eligible model already has a PO number. Models appear here once they
                reach Ordered, or at Planned with every SKU coded.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 12, lineHeight: 1.5 }}>
                  Tick the models going on this PO, type the number your supplier expects,
                  and assign it to all of them at once.
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <button className="btn" style={{ fontSize: 11, padding: "4px 9px" }} onClick={pickAll}>
                    Select all {unassigned.length}
                  </button>
                  {chosen.length > 0 && (
                    <button className="btn" style={{ fontSize: 11, padding: "4px 9px" }} onClick={clearAll}>
                      Clear selection
                    </button>
                  )}
                </div>

                <div style={{ overflowX: "auto", marginBottom: 14, maxHeight: 320, overflowY: "auto" }}>
                  <table>
                    <thead><tr>
                      <th style={{ width: 34 }}></th>
                      <th>Model</th><th>Stage</th><th>Launch</th><th>SKUs</th><th>Units</th>
                    </tr></thead>
                    <tbody>
                      {unassigned.sort(byUrgency).map((m) => (
                        <tr key={m.id} style={{ cursor: "pointer" }} onClick={() => toggle(m.id)}>
                          <td style={{ textAlign: "center" }}>
                            {picked[m.id]
                              ? <CheckCircle2 size={15} style={{ color: "var(--ok)" }} />
                              : <Circle size={15} style={{ color: "var(--dim)" }} />}
                          </td>
                          <td>
                            <div style={{ fontWeight: 570 }}>{m.brand} {m.name}</div>
                            <div style={{ fontSize: 11, color: "var(--dim)" }}>{m.segment}</div>
                          </td>
                          <td style={{ fontSize: 12 }}>{STAGES[m.index].label}</td>
                          <td className="n" style={{ fontSize: 12 }}>
                            {showDate(m.launch)}
                            {m.isLate && <div style={{ fontSize: 10, color: "var(--bad)" }}>{m.worstDelay}d late</div>}
                          </td>
                          <td className="n">{allSkus(m).length}</td>
                          <td className="n">{qty(m.units)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* running total + assign */}
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap",
                  borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <Field label="PO number"
                      hint={chosen.length
                        ? `${chosen.length} model${chosen.length > 1 ? "s" : ""} · ${chosenSkus.length} SKUs · ${qty(chosenUnits)} units`
                        : "Select at least one model above"}>
                      <input value={poNum} placeholder="PO-2026-001"
                        style={{ fontFamily: "var(--mono)" }}
                        onChange={(e) => setPoNum(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && assign()} />
                    </Field>
                  </div>
                  <button className="btn" data-primary="1"
                    style={{ opacity: poNum.trim() && chosen.length ? 1 : 0.4 }}
                    onClick={assign}>
                    Assign to {chosen.length || 0} model{chosen.length === 1 ? "" : "s"}
                  </button>
                  {chosen.length > 0 && (
                    <>
                      <button className="btn" onClick={() => exportDraft("csv")}>↓ CSV</button>
                      <button className="btn" onClick={() => exportDraft("excel")}>↓ Excel</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── existing POs ── */}
      <div>
        <h2>Purchase orders — {poNumbers.length}</h2>
        {poNumbers.length === 0 ? (
          <div className="card" style={{ fontSize: 13, color: "var(--dim)" }}>
            No purchase orders yet.
          </div>
        ) : poNumbers.map((po) => {
          const list  = groups[po];
          const skus  = list.flatMap(allSkus);
          const units = skus.reduce((t, r) => t + (r.units || 0), 0);
          const open  = expanded[po];
          return (
            <div className="card" key={po} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                cursor: "pointer" }}
                onClick={() => setExpanded((e) => ({ ...e, [po]: !e[po] }))}>
                <span style={{ fontSize: 12, color: "var(--dim)" }}>{open ? "▾" : "▸"}</span>
                <span className="n" style={{ fontWeight: 640, fontSize: 14 }}>{po}</span>
                <Tag>{list.length} model{list.length > 1 ? "s" : ""}</Tag>
                <Tag>{skus.length} SKUs</Tag>
                <Tag tone="ok">{qty(units)} units</Tag>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button className="btn" style={{ fontSize: 11, padding: "3px 8px" }}
                    onClick={(e) => { e.stopPropagation(); exportPO(po, list, "csv"); }}>↓ CSV</button>
                  <button className="btn" style={{ fontSize: 11, padding: "3px 8px" }}
                    onClick={(e) => { e.stopPropagation(); exportPO(po, list, "excel"); }}>↓ Excel</button>
                </span>
              </div>

              {open && (
                <div style={{ marginTop: 12, overflowX: "auto" }}>
                  <table>
                    <thead><tr><th>Model</th><th>Stage</th><th>SKU</th><th>Material</th><th>Units</th></tr></thead>
                    <tbody>
                      {list.flatMap((m) =>
                        allSkus(m).map((r, i) => (
                          <tr key={r.rid} onClick={() => onOpen(m.id)}>
                            <td style={{ fontWeight: i === 0 ? 570 : 400,
                              color: i === 0 ? undefined : "var(--dim)" }}>
                              {i === 0 ? `${m.brand} ${m.name}` : ""}
                            </td>
                            <td style={{ fontSize: 12, color: "var(--dim)" }}>
                              {i === 0 ? STAGES[m.index].label : ""}
                            </td>
                            <td className="n" style={{ fontSize: 12 }}>{r.sku || "—"}</td>
                            <td style={{ fontSize: 12, color: "var(--dim)" }}>{r.material || "—"}</td>
                            <td className="n">{qty(r.units)}</td>
                          </tr>
                        )))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ── REPORTS ────────────────────────────────────────────────────── */

/* Six reports. Each has a name, column headers, and a row builder. */
function buildReportRows(reportKey, models) {
  switch (reportKey) {
    case "all": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "Stage", "PO Number", "SKUs", "Total Units", "Late?", "Days to Launch"],
      rows: models.map((m) => [m.brand, m.name, m.segment, m.launch, STAGES[m.index].label,
        m.po || "", allSkus(m).length, m.units, m.isLate ? `Yes (+${m.worstDelay}d)` : "No",
        m.daysToLaunch < 0 ? `${-m.daysToLaunch}d ago` : `in ${m.daysToLaunch}d`]),
    };
    case "planned": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "SKU", "Material", "Units Planned", "SKU Status"],
      rows: models.filter((m) => m.stage === "planned").flatMap((m) =>
        allSkus(m).length ? allSkus(m).map((r) => [m.brand, m.name, m.segment, m.launch,
          r.sku || "", r.material || "", r.units, r.sku ? "✓ OK" : "⚠ Missing"])
        : [[m.brand, m.name, m.segment, m.launch, "—", "—", "—", "—", "No covers yet"]]),
    };
    case "ordered": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "PO Number", "SKU", "Material", "Units"],
      rows: models.filter((m) => m.stage === "ordered").flatMap((m) =>
        allSkus(m).map((r) => [m.brand, m.name, m.segment, m.launch, m.po || "",
          r.sku || "", r.material || "", r.units])),
    };
    case "production": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "PO Number", "SKU", "Material", "Units", "STP Required", "STP Status"],
      rows: models.filter((m) => m.stage === "production").flatMap((m) =>
        allSkus(m).map((r) => [m.brand, m.name, m.segment, m.launch, m.po || "",
          r.sku || "MISSING", r.material || "MISSING", r.units,
          (!r.material || !r.sku) ? "YES — fix data" : "YES", r.stpStatus || "Not Sent"])),
    };
    case "received": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "PO Number", "SKU", "Material", "Planned Qty", "Received Qty", "Short By", "Status"],
      rows: models.filter((m) => m.stage === "received").flatMap((m) =>
        allSkus(m).map((r) => [m.brand, m.name, m.segment, m.launch, m.po || "",
          r.sku || "", r.material || "", r.units, r.receivedQty ?? "—",
          isConfirmed(r) ? shortfallOf(r) : "—", receiptLabel(r)])),
    };
    case "listing":
      return {
        headers: ["Brand", "Model", "Stage", "SKU", "Material", ...MARKETPLACES, "Fully listed"],
        rows: models.filter((m) => ["received", "live"].includes(m.stage)).flatMap((m) =>
          allSkus(m).map((r) => [m.brand, m.name, STAGES[m.index].label, r.sku || "", r.material || "",
            ...MARKETPLACES.map((mp) => r.listings?.[mp] || "Not listed"),
            isFullyListed(r) ? "Yes" : "No"])),
      };

    case "sales":
      return {
        headers: ["Brand","Model","Date","Marketplace","Units Sold","Revenue (₹)","Returns","Notes"],
        rows: models.filter(m=>m.stage==="live").flatMap((m) =>
          (m.salesEntries||[]).map((e) => [
            m.brand, m.name, e.date, e.marketplace,
            e.units, e.revenue||0, e.returns||0, e.notes||""
          ])),
      };

    case "late": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "Stage", "Days Late", "Days to Launch"],
      rows: models.filter((m) => m.isLate).map((m) => [m.brand, m.name, m.segment, m.launch,
        STAGES[m.index].label, m.worstDelay,
        m.daysToLaunch < 0 ? `${-m.daysToLaunch}d ago` : `in ${m.daysToLaunch}d`]),
    };
    default: return { headers: [], rows: [] };
  }
}

const REPORT_DEFS = [
  { key: "all",        label: "All Phones" },
  { key: "planned",    label: "Planned" },
  { key: "ordered",    label: "Ordered" },
  { key: "production", label: "Production / STP" },
  { key: "received",   label: "Received" },
  { key: "listing",    label: "Listing" },
  { key: "late",       label: "Late Models" },
  { key: "sales",      label: "Sales" },
];

function Reports({ models }) {
  const [active, setActive] = useState("all");
  const { headers, rows } = useMemo(() => buildReportRows(active, models), [active, models]);

  const download = (fmt) => {
    const def = REPORT_DEFS.find((d) => d.key === active);
    downloadReport(def.label.replace(/\s+/g, "_"), headers, rows, fmt);
  };

  return (
    <div>
      <div className="report-tabs">
        {REPORT_DEFS.map((d) => {
          const count = active === d.key ? null : buildReportRows(d.key, models).rows.length;
          return (
            <button key={d.key} className="report-tab" data-on={active === d.key ? "1" : "0"}
              onClick={() => setActive(d.key)}>
              {d.label}{count != null ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {/* report header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)",
          display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{REPORT_DEFS.find(d => d.key === active)?.label}</div>
            <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 2 }}>{rows.length} row{rows.length !== 1 ? "s" : ""}</div>
          </div>
          <div className="report-dl">
            <button className="btn" data-primary="1" onClick={() => download("csv")}
              style={{ fontSize: 12 }}>↓ Download CSV</button>
            <button className="btn" onClick={() => download("excel")}
              style={{ fontSize: 12 }}>↓ Download Excel (.xls)</button>
          </div>
        </div>

        {/* preview table */}
        {rows.length > 0 ? (
          <div className="report-preview">
            <table>
              <thead>
                <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ cursor: "default" }}>
                    {row.map((cell, j) => (
                      <td key={j} className={typeof cell === "number" ? "n" : ""}
                        style={{ fontSize: 12, whiteSpace: "nowrap" }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 32, textAlign: "center", color: "var(--dim)", fontSize: 13 }}>
            No data for this report yet.
          </div>
        )}
      </div>
    </div>
  );
}



/* ── USER MANAGER — Admin only ───────────────────────────────────
   Create, rename, change role and reset PIN for any user.
   Shown in a modal when Admin clicks "Manage Users".             */

function UserManager({ users, onSave, onClose }) {
  const [list, setList] = useState(users.map(u => ({ ...u })));
  const [editing, setEditing] = useState(null);   // user id being edited
  const [form, setForm]       = useState({});
  const [newPin, setNewPin]   = useState("");
  const [msg, setMsg]         = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const startEdit = (u) => { setEditing(u.id); setForm({ name: u.name.split(" (")[0], role: u.role }); setNewPin(""); setMsg(""); };
  const cancelEdit = () => { setEditing(null); setNewPin(""); setMsg(""); };

  const saveUser = (id) => {
    if (!form.name?.trim()) return;
    setList(l => l.map(u => u.id !== id ? u : {
      ...u,
      name: form.name.trim() + " (" + ROLES.find(r => r.key === form.role)?.label + ")",
      role: form.role,
      ...(newPin.length >= 4 ? { pin: hashPin(newPin) } : {}),
    }));
    setMsg("Saved"); setTimeout(() => setMsg(""), 1500);
    setEditing(null); setNewPin("");
  };

  const addUser = () => {
    const id = "u" + Date.now();
    const u = { id, name: "New User (Procurement)", role: "procurement", pin: hashPin("0000"), avatar: "N" };
    setList(l => [...l, u]);
    startEdit(u);
  };

  const removeUser = (id) => {
    if (list.length <= 1) return;
    setList(l => l.filter(u => u.id !== id));
    if (editing === id) cancelEdit();
  };

  return (
    <>
      <div className="shade" style={{ zIndex: 60 }} onClick={onClose} />
      <div style={{ position: "fixed", zIndex: 61, top: "50%", left: "50%",
        transform: "translate(-50%, -50%)", background: "var(--card)",
        border: "1px solid var(--line)", borderRadius: 14, padding: 24,
        width: "min(520px, 94vw)", maxHeight: "85vh", overflowY: "auto",
        display: "flex", flexDirection: "column", gap: 16 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 650 }}>User accounts</div>
          <button className="btn" style={{ padding: "4px 8px" }} onClick={addUser}>
            <Plus size={13} />New user
          </button>
          <button className="btn btn-icon" onClick={onClose}><X size={14} /></button>
        </div>

        {list.map((u) => {
          const r = ROLES.find(x => x.key === u.role);
          const isEditing = editing === u.id;
          return (
            <div key={u.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {!isEditing ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: r?.color || "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                    {u.avatar}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name.split(" (")[0]}</div>
                    <div style={{ fontSize: 11, color: "var(--dim)" }}>{r?.label}</div>
                  </div>
                  <button className="btn" style={{ fontSize: 11, padding: "4px 8px" }}
                    onClick={() => startEdit(u)}>Edit</button>
                  {list.length > 1 && (
                    <button className="btn" style={{ fontSize: 11, padding: "4px 8px", color: "var(--bad)" }}
                      onClick={() => removeUser(u.id)}>Remove</button>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>Editing account</div>
                  <div className="two">
                    <Field label="Display name">
                      <input value={form.name || ""} placeholder="Name"
                        onChange={(e) => set("name", e.target.value)} />
                    </Field>
                    <Field label="Role">
                      <select value={form.role} onChange={(e) => set("role", e.target.value)}>
                        {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="New PIN (leave blank to keep current — min 4 digits)"
                    hint={newPin.length >= 4 ? "✓ PIN will be updated" : ""}>
                    <input type="password" value={newPin} placeholder="New PIN"
                      maxLength={6} style={{ fontFamily: "var(--mono)", letterSpacing: 3 }}
                      onChange={(e) => setNewPin(e.target.value.replace(/\D/g,""))} />
                  </Field>
                  <div style={{ fontSize: 11, color: "var(--dim)" }}>
                    Avatar letter is the first letter of the name.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" data-primary="1" onClick={() => saveUser(u.id)}
                      style={{ opacity: form.name?.trim() ? 1 : 0.4 }}>
                      {msg || "Save"}
                    </button>
                    <button className="btn" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <button className="btn" data-primary="1" onClick={() => { onSave(list); onClose(); }}>
          Save all and close
        </button>
      </div>
    </>
  );
}



/* ── DB SETUP SCREEN — Admin only ───────────────────────────────
   Shown when the app is not yet connected to a Supabase project.
   Admin pastes the URL and anon key from the Supabase dashboard. */

function DBSetupScreen({ onDone, onSkip }) {
  const [url, setUrl]     = useState(dbGetConfig()?.url || "");
  const [key, setKey]     = useState(dbGetConfig()?.key || "");
  const [status, setStatus] = useState("idle");   // idle | testing | ok | error
  const [errMsg, setErrMsg] = useState("");

  const test = async () => {
    if (!url.trim() || !key.trim()) return;
    setStatus("testing"); setErrMsg("");
    dbSaveConfig(url, key);
    const { ok, error } = await dbPing();
    if (ok) { setStatus("ok"); }
    else { setStatus("error"); setErrMsg(error || "Could not reach Supabase. Check URL and key."); dbClearConfig(); }
  };

  const save = () => { dbSaveConfig(url, key); onDone(); };

  return (
    <div className="app" data-theme="dark" style={{ minHeight: "100vh", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <style>{CSS}</style>
      <div style={{ width: "min(520px, 94vw)", display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ textAlign: "center" }}>
          <Package size={28} style={{ color: "var(--accent)", marginBottom: 8 }} />
          <h1 style={{ margin: "0 0 6px", fontSize: 22 }}>Connect to Supabase</h1>
          <div className="sub" style={{ lineHeight: 1.6 }}>
            Paste your project URL and anon key from<br />
            <strong>Supabase → Project Settings → API</strong>
          </div>
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Project URL" hint="Looks like: https://xxxx.supabase.co">
            <input value={url} placeholder="https://your-project.supabase.co"
              style={{ fontFamily: "var(--mono)", fontSize: 12 }}
              onChange={(e) => { setUrl(e.target.value); setStatus("idle"); }} />
          </Field>
          <Field label="Anon / Public key" hint="Starts with eyJ...">
            <input type="password" value={key} placeholder="eyJhbGci..."
              style={{ fontFamily: "var(--mono)", fontSize: 12 }}
              onChange={(e) => { setKey(e.target.value); setStatus("idle"); }} />
          </Field>

          {status === "ok" && (
            <div style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>
              ✓ Connected successfully
            </div>
          )}
          {status === "error" && (
            <div style={{ fontSize: 12, color: "var(--bad)" }}>{errMsg}</div>
          )}
          {status === "testing" && (
            <div style={{ fontSize: 12, color: "var(--dim)" }}>Testing connection…</div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={test}
              style={{ opacity: url.trim() && key.trim() ? 1 : 0.4 }}>
              Test connection
            </button>
            {status === "ok" && (
              <button className="btn" data-primary="1" onClick={save}>
                Save and continue →
              </button>
            )}
          </div>
        </div>

        <div className="card" style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.7 }}>
          <strong style={{ color: "var(--text)" }}>Setup steps:</strong><br />
          1. Create a free Supabase project at <strong>supabase.com</strong><br />
          2. Run <strong>schema.sql</strong> in the SQL Editor<br />
          3. Go to <strong>Settings → API</strong> and copy the Project URL and anon key<br />
          4. Paste both above and click Test connection<br />
          <br />
          <button className="btn" style={{ fontSize: 11 }} onClick={onSkip}>
            Skip — use local memory only (data won't be saved)
          </button>
        </div>
      </div>
    </div>
  );
}


/* ── LOGIN SCREEN ────────────────────────────────────────────────
   Shown when no session is active. Pick a user, enter PIN.
   Admin can also reach User Management from the nav bar.          */

function LoginScreen({ users, onLogin, theme, onTheme }) {
  const [selected, setSelected] = useState(null);
  const [pin, setPin]           = useState("");
  const [error, setError]       = useState("");
  const [showPin, setShowPin]   = useState(false);

  const attempt = () => {
    if (!selected) return;
    if (hashPin(pin) === selected.pin) {
      setError(""); onLogin(selected);
    } else {
      setError("Wrong PIN. Try again.");
      setPin("");
    }
  };

  const roleInfo = selected ? ROLES.find(r => r.key === selected.role) : null;

  return (
    <div className="app" data-theme={theme} style={{ minHeight: "100vh",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <style>{CSS}</style>
      <div style={{ width: "min(420px, 94vw)", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* header */}
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <Package size={28} style={{ color: "var(--accent)", marginBottom: 8 }} />
          <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>Procurement Tracker</h1>
          <div className="sub">Select your account to continue</div>
        </div>

        {/* user grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {users.map((u) => {
            const r = ROLES.find(x => x.key === u.role);
            const active = selected?.id === u.id;
            return (
              <button key={u.id} className="btn card"
                style={{ flexDirection: "column", gap: 8, padding: "14px 12px", textAlign: "center",
                  border: active ? "2px solid var(--accent)" : "1px solid var(--line)",
                  background: active ? "var(--card)" : undefined }}
                onClick={() => { setSelected(u); setPin(""); setError(""); }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: r?.color || "var(--accent)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 17, fontWeight: 700, color: "#fff", margin: "0 auto" }}>
                  {u.avatar}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name.split(" (")[0]}</div>
                  <div style={{ fontSize: 11, color: "var(--dim)" }}>{r?.label}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* PIN entry */}
        {selected && (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Sign in as <span style={{ color: "var(--accent)" }}>{selected.name.split(" (")[0]}</span>
              <span style={{ fontSize: 11, color: "var(--dim)", marginLeft: 8, fontWeight: 400 }}>
                {roleInfo?.label}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, position: "relative" }}>
                <input
                  type={showPin ? "text" : "password"}
                  value={pin}
                  placeholder="Enter PIN"
                  autoFocus
                  style={{ fontFamily: "var(--mono)", fontSize: 15, letterSpacing: 4, width: "100%" }}
                  onChange={(e) => { setPin(e.target.value.replace(/\D/g,"")); setError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && attempt()}
                  maxLength={6}
                />
              </div>
              <button className="btn" title={showPin ? "Hide" : "Show"}
                style={{ padding: "0 12px" }}
                onClick={() => setShowPin(v => !v)}>
                {showPin ? "🙈" : "👁"}
              </button>
            </div>
            {error && <div style={{ fontSize: 12, color: "var(--bad)" }}>{error}</div>}
            <button className="btn" data-primary="1" onClick={attempt}
              style={{ opacity: pin.length >= 4 ? 1 : 0.4 }}>
              Sign in
            </button>
          </div>
        )}

        {/* theme toggle at bottom */}
        <div style={{ textAlign: "center" }}>
          <button className="btn btn-icon" onClick={onTheme} aria-label="Switch theme"
            style={{ margin: "0 auto" }}>
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}


export default function App() {
  /* ── DB config state ── */
  const [dbReady, setDbReady]   = useState(() => !!dbGetConfig());
  const [dbOnline, setDbOnline] = useState(false);
  const [dbError, setDbError]   = useState("");
  const [showDbSetup, setShowDbSetup] = useState(false);

  /* ── session state ── */
  const [users, setUsers]     = useState(DEFAULT_USERS);
  const [session, setSession] = useState(() => loadSession());
  const [manageUsers, setManageUsers] = useState(false);

  const role = session?.role ?? "none";
  const currentUser = session;

  /* ── app state ── */
  const [phones, setPhones] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId]   = useState(null);
  const [adding, setAdding]   = useState(false);
  const [view, setView]       = useState("dashboard");
  const [theme, setTheme]     = useState("dark");
  const [toast, setToast]     = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [compact, setCompact] = useState(false);

  /* ── load data from Supabase on mount & after login ── */
  const loadFromDB = async () => {
    if (!dbGetConfig()) return;
    setLoading(true);
    const [up, ph] = await Promise.all([dbLoadUsers(), dbLoadPhones()]);
    if (up.error || ph.error) {
      setDbOnline(false); setDbError(up.error || ph.error);
    } else {
      setDbOnline(true); setDbError("");
      if (up.data?.length) {
        setUsers(up.data);
        /* Re-validate a restored session against the live user list —
           the account may have been renamed, re-roled or deleted while
           this browser was closed.                                    */
        setSession((cur) => {
          if (!cur) return cur;
          const fresh = up.data.find((u) => u.id === cur.id);
          if (!fresh) { clearSession(); return null; }      // account removed
          saveSession(fresh);
          return fresh;                                     // pick up role/name changes
        });
      }
      if (ph.data)         setPhones(ph.data);
    }
    setLoading(false);
  };

  useEffect(() => { loadFromDB(); }, []);   // on mount

  /* ── write-through helper: update local state + persist ── */
  const persist = async (updatedPhone) => {
    if (dbOnline) {
      const { error } = await dbUpsertPhone(updatedPhone);
      if (error) say("⚠ DB save failed: " + error);
    }
  };

  const login = (user) => {
    saveSession(user);
    setSession(user);
  };
  const logout = () => {
    clearSession();
    setSession(null); setOpenId(null); setAdding(false);
  };

  const say = (text) => { setToast(text); setTimeout(() => setToast((t) => (t === text ? null : t)), 2500); };

  /* derive everything, every render — never stored, never stale */
  const models = useMemo(() => phones.map(derive), [phones]);

  /* filtered + role-aware view of the phone list */
  const visible = useMemo(
    () => models.filter((mm) => passesFilters(mm, filters, role)),
    [models, filters, role]
  );
  const open = openId ? models.find((m) => m.id === openId) : null;

  /* move a phone to a stage and record the date it happened */
  const moveTo = (id, stageKey) => setPhones((list) => {
    const next = list.map((p) => {
      if (p.id !== id) return p;
      const done = { ...p.done };
      STAGES.slice(0, stageIndex(stageKey) + 1).forEach((s) => { done[s.key] ||= iso(TODAY); });
      return { ...p, stage: stageKey, done };
    });
    const updated = next.find(p => p.id === id);
    if (updated) persist(updated);
    return next;
  });

  const advance = (id) => {
    const m = models.find((x) => x.id === id);
    const next = STAGES[m.index + 1];
    if (next) { moveTo(id, next.key); say(`${m.name} moved to ${next.label}`); }
  };

  const goBack = (id) => {
    const m = models.find((x) => x.id === id);
    const prev = STAGES[m.index - 1];
    if (!prev) return;
    /* moving back: strip the current stage's done date so the timeline is honest */
    setPhones((list) => {
      const next = list.map((p) => {
        if (p.id !== id) return p;
        const done = { ...p.done };
        delete done[m.stage];
        return { ...p, stage: prev.key, done };
      });
      const updated = next.find(p => p.id === id);
      if (updated) persist(updated);
      return next;
    });
    say(`${m.name} moved back to ${prev.label}`);
  };

  /* save edited phone details from ResearchEditor */
  const saveResearch = (id, edits) => {
    setPhones((list) => {
      const next = list.map((p) => p.id !== id ? p : { ...p, ...edits });
      const u = next.find(p => p.id === id); if (u) persist(u);
      return next;
    });
    say("Phone details updated");
  };

  /* save covers array from PlannedSKUEditor */
  const saveSKU = (id, skus) => {
    setPhones((list) => {
      const next = list.map((p) => p.id !== id ? p : { ...p, skus });
      const u = next.find(p => p.id === id); if (u) persist(u);
      return next;
    });
    say("SKUs saved");
  };

  /* update STP file status from ProductionSTP */
  /* STP status is set per SKU — rows is a map of rid -> status */
  const updateSTP = (id, statusByRid) => {
    setPhones((list) => {
      const next = list.map((p) => p.id !== id ? p : {
        ...p, skus: p.skus.map((r) => statusByRid[r.rid] ? { ...r, stpStatus: statusByRid[r.rid] } : r),
      });
      const u = next.find(p => p.id === id); if (u) persist(u);
      return next;
    });
    say("STP status saved");
  };

  /* listingsByRid = { rid: { Flipkart: "Live", ... } } */
  const saveListings = (id, listingsByRid) => {
    setPhones((list) => {
      const next = list.map((p) => p.id !== id ? p : {
        ...p, skus: p.skus.map((r) => listingsByRid[r.rid]
          ? { ...r, listings: { ...r.listings, ...listingsByRid[r.rid] } } : r),
      });
      const u = next.find(p => p.id === id); if (u) persist(u);
      return next;
    });
    say("Listing status saved");
  };

  /* PO number is typed by the buyer, never invented by the app */
  /* Assign one PO number to several models at once */
  const assignPO = (ids, po) => {
    setPhones((list) => {
      const next = list.map((p) => ids.includes(p.id) ? { ...p, po: po.trim() } : p);
      next.filter((p) => ids.includes(p.id)).forEach(persist);
      return next;
    });
    say(`${po} assigned to ${ids.length} model${ids.length === 1 ? "" : "s"}`);
  };

  const savePO = (id, po) => {
    setPhones((list) => {
      const next = list.map((p) => p.id !== id ? p : { ...p, po: po.trim() });
      const u = next.find(p => p.id === id); if (u) persist(u);
      return next;
    });
    say(po.trim() ? "PO number saved" : "PO number cleared");
  };

  /* save goods receipt rows from ReceivedChecker */
  const saveReceipt = (id, receiptRows) => {
    setPhones((list) => {
      const next = list.map((p) => {
        if (p.id !== id) return p;
        return { ...p, skus: p.skus.map((row) => {
          const r = receiptRows.find((rr) => rr.rid === row.rid);
          return r ? { ...row, receivedQty: r.received, receiptState: r.state } : row;
        }) };
      });
      const u = next.find(p => p.id === id); if (u) persist(u);
      return next;
    });
    say("Receipt saved");
  };

  const logSale = (id, entry) => {
    setPhones((list) => {
      const next = list.map((p) => p.id !== id ? p : {
        ...p, salesEntries: [...(p.salesEntries || []), entry],
      });
      const u = next.find(p => p.id === id); if (u) persist(u);
      return next;
    });
    say("Sale logged");
  };

  const resetAll = async () => {
    if (dbOnline) await dbDeleteAllPhones();
    setPhones([]);
    setOpenId(null);
    setAdding(false);
    setConfirmReset(false);
    say("All phones deleted");
  };

  const addPhone = (data) => {
    const id = Math.max(0, ...phones.map((p) => p.id)) + 1;
    const newPhone = { ...data, id };
    setPhones((list) => [...list, newPhone]);
    if (dbOnline) dbUpsertPhone(newPhone).then(({ error }) => {
      if (error) say("⚠ DB save failed: " + error);
    });
    setAdding(false);
    setOpenId(id);
    say(`${data.brand} ${data.name} added and tracking`);
  };

  /* ── DB setup flow: Admin must configure Supabase first ── */
  if (showDbSetup && CAN.reset(role)) return (
    <DBSetupScreen
      onDone={() => { setShowDbSetup(false); setDbReady(true); loadFromDB(); }}
      onSkip={() => setShowDbSetup(false)}
    />
  );

  /* ── show login screen when no session ── */
  if (!session) return (
    <LoginScreen
      users={users}
      onLogin={login}
      theme={theme}
      onTheme={() => setTheme(t => t === "dark" ? "light" : "dark")}
    />
  );

  return (
    <div className="app" data-theme={theme}>
      <style>{CSS}</style>
      <div className="wrap">

        <div className="head">
          <Package size={22} style={{ color: "var(--accent)" }} />
          <div>
            <h1>New Model Procurement Tracker</h1>
            <div className="sub">Track new phones from the day you spot them until covers are selling.</div>
          </div>
          <div className="row" style={{ marginLeft: "auto", flexWrap: "wrap" }}>
            <button className="btn" data-on={view === "dashboard" ? "1" : "0"} onClick={() => setView("dashboard")}>
              <BarChart2 size={14} />Dashboard
            </button>
            <button className="btn" data-on={view === "board" ? "1" : "0"} onClick={() => setView("board")}>
              <LayoutGrid size={14} />Board
            </button>
            <button className="btn" data-on={view === "table" ? "1" : "0"} onClick={() => setView("table")}>
              <List size={14} />List
            </button>
            <button className="btn" data-on={view === "orders" ? "1" : "0"} onClick={() => setView("orders")}>
              <Package size={14} />Orders
            </button>
            <button className="btn" data-on={view === "reports" ? "1" : "0"} onClick={() => setView("reports")}>
              <FileText size={14} />Reports
            </button>
            {/* DB status indicator */}
            <div title={dbOnline ? "Database connected" : dbError || "No database configured"}
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11,
                color: dbOnline ? "var(--ok)" : "var(--warn)" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%",
                background: dbOnline ? "var(--ok)" : "var(--warn)" }} />
              {dbOnline ? "DB live" : "Local only"}
              {CAN.reset(role) && (
                <button className="btn" style={{ fontSize: 10, padding: "2px 6px" }}
                  onClick={() => setShowDbSetup(true)} title="Configure database">
                  ⚙
                </button>
              )}
            </div>

            {/* Logged-in user badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 30, height: 30, borderRadius: "50%",
                background: ROLES.find(r => r.key === role)?.color || "var(--accent)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0
              }}>
                {currentUser?.avatar}
              </div>
              <div style={{ lineHeight: 1.2 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{currentUser?.name?.split(" (")[0]}</div>
                <div style={{ fontSize: 10, color: "var(--dim)" }}>{ROLES.find(r => r.key === role)?.label}</div>
              </div>
              {CAN.manageUsers(role) && (
                <button className="btn" style={{ fontSize: 11, padding: "4px 8px" }}
                  onClick={() => setManageUsers(true)}>
                  Users
                </button>
              )}
              <button className="btn" style={{ fontSize: 11, padding: "4px 8px" }}
                onClick={logout} title="Sign out">
                Sign out
              </button>
            </div>
            <button className="btn btn-icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                    aria-label="Switch theme">
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            {CAN.reset(role) && (
              <button className="btn" style={{ color: "var(--bad)", borderColor: "var(--bad)" }}
                onClick={() => setConfirmReset(true)} title="Delete all phones">
                Reset
              </button>
            )}
            {CAN.addPhone(role) ? (
              <button className="btn" data-primary="1" onClick={() => setAdding(true)}>
                <Plus size={14} />Add phone
              </button>
            ) : (
              <button className="btn" style={{ opacity: 0.35, cursor: "not-allowed" }}
                title={`${ROLES.find(r=>r.key===role)?.label} cannot add phones`}>
                <Plus size={14} />Add phone
              </button>
            )}
          </div>
        </div>

        {/* Search + filters — shown on Board and List only */}
        {["board","table"].includes(view) && models.length > 0 && (
          <FilterBar
            filters={filters} setFilters={setFilters}
            models={models} role={role}
            compact={compact} setCompact={setCompact}
            showDensity={view === "board"}
          />
        )}

        {view === "dashboard" && <Dashboard models={models} onOpen={setOpenId} onAdd={() => setAdding(true)} />}
        {view === "board"     && <Board models={visible} allModels={models} onOpen={setOpenId} onMove={moveTo}
                                  onAdd={() => setAdding(true)} onAdvance={advance} role={role}
                                  compact={compact} filters={filters} />}
        {view === "table"     && <Table models={visible} allModels={models} onOpen={setOpenId}
                                  onAdvance={advance} role={role} filters={filters} />}
        {view === "orders"    && <POManager models={models} onAssign={assignPO}
                                  onOpen={setOpenId} canEdit={CAN.savePO(role)} />}
        {view === "reports"   && <Reports models={models} />}
      </div>

      {open   && <Detail model={open} onClose={() => setOpenId(null)} onAdvance={advance} onGoBack={goBack} onResearchSave={CAN.editResearch(role) ? saveResearch : null} onSKUSave={CAN.editSKUs(role) ? saveSKU : null} onSTPUpdate={CAN.updateSTP(role) ? updateSTP : null} onReceiptSave={CAN.saveReceipt(role) ? saveReceipt : null} onPOSave={CAN.savePO(role) ? savePO : null} onListingSave={CAN.saveListing(role) ? saveListings : null} onSalesLog={logSale} canLog={CAN.logSales(role)} role={role} />}
      {adding && <AddForm onClose={() => setAdding(false)} onSave={addPhone} />}
      {confirmReset && (
        <>
          <div className="shade" style={{ zIndex: 50 }} onClick={() => setConfirmReset(false)} />
          <div style={{
            position: "fixed", zIndex: 51, top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            background: "var(--card)", border: "1px solid var(--bad)",
            borderRadius: 14, padding: 28, width: "min(380px, 90vw)",
            display: "flex", flexDirection: "column", gap: 14
          }}>
            <div style={{ fontSize: 16, fontWeight: 640 }}>Delete all phones?</div>
            <div style={{ fontSize: 13, color: "var(--dim)", lineHeight: 1.6 }}>
              This will permanently delete every phone and all their data.
              The list will be empty. There is no undo.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="btn" data-primary="1"
                style={{ background: "var(--bad)", borderColor: "var(--bad)" }}
                onClick={resetAll}>
                Yes, delete all
              </button>
            </div>
          </div>
        </>
      )}
      {loading && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
          zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ padding: "24px 36px", fontSize: 14 }}>
            Loading from database…
          </div>
        </div>
      )}
      {manageUsers && CAN.manageUsers(role) && (
        <UserManager
          users={users}
          onSave={async (updated) => {
            setUsers(updated);
            const me = updated.find(u => u.id === session?.id);
            if (me) { setSession(me); saveSession(me); }
            if (dbOnline) {
              await Promise.all(updated.map(dbUpsertUser));
            }
            say("Users saved");
          }}
          onClose={() => setManageUsers(false)}
        />
      )}
      {toast  && <div className="toast">{toast}</div>}
    </div>
  );
}