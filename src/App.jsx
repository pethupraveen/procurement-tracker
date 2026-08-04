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

const cover = (type, skus = []) => ({ type, skus: skus.length ? skus : [skuRow()] });

/* Flatten every SKU across every cover type — used by tables, exports
   and reports so they all read from one place.                       */
const allSkus = (model) =>
  (model.covers || []).flatMap((c) => c.skus.map((r) => ({ ...r, type: c.type })));

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
  };
}

/* problems worth showing at the top of the screen */
function problemsOf(model) {
  const list = [];
  if (model.isLate)
    list.push({ model, text: `${model.worstDelay} days behind schedule` });
  if (model.stage !== "live" && model.daysToLaunch >= 0 && model.daysToLaunch <= 14)
    list.push({ model, text: `Launches in ${model.daysToLaunch} days, still at ${STAGES[model.index].label}` });
  return list;
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
/* ── 8. BOARD VIEW ───────────────────────────────────────────────
   One column per stage. Drag a card to move the model forward.     */

function Board({ models, onOpen, onMove, onAdd }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);

  const drop = (stageKey) => {
    if (dragging && dragging.stage !== stageKey) onMove(dragging.id, stageKey);
    setDragging(null); setOver(null);
  };

  if (models.length === 0) return (
    <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
      <div style={{ fontSize: 16, fontWeight: 640, marginBottom: 8 }}>Board is empty</div>
      <div style={{ fontSize: 13, color: "var(--dim)", marginBottom: 20 }}>Add a phone to see it appear here.</div>
      <button className="btn" data-primary="1" onClick={onAdd}><Plus size={14} />Add phone</button>
    </div>
  );

  return (
    <div className="board">
      {STAGES.map((stage) => {
        const inThisStage = models.filter((m) => m.stage === stage.key);
        return (
          <div className="col" key={stage.key}>
            <div className="col-head">
              <span className="col-name">{stage.label}</span>
              <span className="col-count">{inThisStage.length}</span>
            </div>
            <div className="col-hint">{stage.hint}</div>
            <div
              className="col-body"
              data-over={over === stage.key ? "1" : "0"}
              onDragOver={(e) => { e.preventDefault(); setOver(stage.key); }}
              onDragLeave={() => setOver((o) => (o === stage.key ? null : o))}
              onDrop={() => drop(stage.key)}
            >
              {inThisStage.map((m) => (
                <div
                  className="card pcard" key={m.id} draggable
                  onDragStart={() => setDragging(m)}
                  onDragEnd={() => { setDragging(null); setOver(null); }}
                  onClick={() => onOpen(m.id)}
                >
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: "var(--dim)" }}>{m.brand}</div>
                      <div style={{ fontSize: 13, fontWeight: 570, lineHeight: 1.2 }}>{m.name}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 9 }}><Meter value={m.progress} tone={m.isLate ? "bad" : m.stage === "live" ? "ok" : undefined} /></div>
                  <div className="row" style={{ marginTop: 7, fontSize: 11 }}>
                    <span className="n" style={{ color: "var(--dim)" }}>{showDate(m.launch)}</span>
                    {m.isLate && <span style={{ marginLeft: "auto", color: "var(--bad)" }}>{m.worstDelay}d late</span>}
                  </div>
                </div>
              ))}
              {!inThisStage.length && <div className="empty">Drop here</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}


/* ── 9. TABLE VIEW ─────────────────────────────────────────────── */

function Table({ models, onOpen }) {
  const sorted = [...models].sort((a, b) => new Date(a.launch) - new Date(b.launch));
  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Phone</th><th>Segment</th><th>Launch</th><th>Stage</th><th>Units</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <tr key={m.id} onClick={() => onOpen(m.id)} tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onOpen(m.id)}>
              <td>
                <div style={{ fontWeight: 570 }}>{m.brand} {m.name}</div>
                <div className="n" style={{ fontSize: 11, color: "var(--dim)" }}>{m.po || "no PO yet"}</div>
              </td>
              <td style={{ color: "var(--dim)", fontSize: 12 }}>{m.segment}</td>
              <td className="n" style={{ fontSize: 12 }}>{showDate(m.launch)}</td>
              <td style={{ fontSize: 12 }}>{STAGES[m.index].label}</td>
              <td className="n" style={{ fontSize: 12 }}>{qty(m.units)}</td>
              <td>{m.isLate ? <Tag tone="bad">{m.worstDelay}d late</Tag> : <Tag tone="ok">on time</Tag>}</td>
            </tr>
          ))}
          {!sorted.length && (
            <tr><td colSpan={8} style={{ textAlign: "center", padding: 36, color: "var(--dim)" }}>
              No phones yet. Add the first one.
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
  /* draft = the covers array being edited. Saved on demand. */
  const [draft, setDraft] = useState(
    () => model.covers.length
      ? model.covers.map((c) => ({ type: c.type, skus: c.skus.map((r) => ({ ...r })) }))
      : []
  );
  const [bulkFor, setBulkFor] = useState(null);   // which cover type is pasting
  const [bulkText, setBulkText] = useState("");
  const [bulkErr, setBulkErr] = useState("");
  const [saved, setSaved] = useState(false);

  const has = (type) => draft.some((c) => c.type === type);

  const toggleType = (type) => setDraft((d) =>
    has(type) ? d.filter((c) => c.type !== type)
              : [...d, { type, skus: [skuRow()] }]
  );

  const addRow = (type) => setDraft((d) =>
    d.map((c) => c.type === type ? { ...c, skus: [...c.skus, skuRow()] } : c)
  );

  const removeRow = (type, rid) => setDraft((d) =>
    d.map((c) => c.type === type
      ? { ...c, skus: c.skus.length > 1 ? c.skus.filter((r) => r.rid !== rid) : c.skus }
      : c)
  );

  const editRow = (type, rid, patch) => setDraft((d) =>
    d.map((c) => c.type === type
      ? { ...c, skus: c.skus.map((r) => r.rid === rid ? { ...r, ...patch } : r) }
      : c)
  );

  /* Bulk paste: one line per SKU — "SKU, Material, Units" */
  const applyBulk = (type, raw) => {
    const lines = raw.trim().split(/\r?\n/).filter((l) => l.trim());
    const parsed = [];
    const bad = [];
    lines.forEach((line, i) => {
      /* skip a header row if the user pasted one straight from Excel */
      if (i === 0 && /^\s*sku\s*[,\t]/i.test(line)) return;
      const parts = line.split(/[,\t]/).map((x) => x.trim());
      const sku = parts[0];
      if (!sku) { bad.push(i + 1); return; }
      const material = parts[1] || "";
      /* Join everything after the material before parsing digits — a pasted
         "5,000" arrives split across two parts and must not become 5.     */
      const n = parseInt(parts.slice(2).join("").replace(/[^\d]/g, ""), 10);
      parsed.push(skuRow(sku, material, Number.isFinite(n) ? n : 0));
    });
    if (!parsed.length) {
      setBulkErr("No valid rows found. Each line needs at least a SKU.");
      return;
    }
    /* replace this cover type's SKU list with the pasted one */
    setDraft((d) => d.map((c) => c.type === type ? { ...c, skus: parsed } : c));
    setBulkErr(bad.length ? `Added ${parsed.length}. Skipped ${bad.length} blank line(s).` : "");
    setBulkText("");
    setBulkFor(null);
  };

  const save = () => {
    /* drop completely blank rows, keep everything else exactly as typed */
    const cleaned = draft.map((c) => ({
      type: c.type,
      skus: c.skus.filter((r) => r.sku.trim() || r.material.trim() || r.units > 0),
    })).filter((c) => c.skus.length);
    onSave(model.id, cleaned);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const rows        = draft.flatMap((c) => c.skus);
  const missingSku  = rows.filter((r) => !r.sku.trim()).length;
  const totalUnits  = rows.reduce((s, r) => s + (r.units || 0), 0);

  return (
    <div>
      <h2 style={{ color: "var(--warn)" }}>
        {stage === "planned" ? "▸ Planned — cover types & SKUs" : "▸ Covers & SKUs (editable)"}
      </h2>
      <div className="card">
        <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 12, lineHeight: 1.5 }}>
          Pick the cover types you want, then add one row per SKU underneath.
          Each SKU has its own material and units — so one cover type can hold many colours.
          {stage === "planned"
            ? <strong> Every SKU needs a code before you can move to Ordered.</strong>
            : <strong> Adding a SKU here changes what you ordered — re-send the PO and STP file.</strong>}
        </div>

        {/* cover type selector */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 18 }}>
          {COVER_TYPES.map((type) => (
            <button key={type} className="btn" data-on={has(type) ? "1" : "0"}
              onClick={() => toggleType(type)}>
              {has(type) ? <CheckCircle2 size={12} /> : <Circle size={12} />}{type}
            </button>
          ))}
        </div>

        {/* one block per selected cover type */}
        {draft.map((c) => {
          const typeUnits = c.skus.reduce((s, r) => s + (r.units || 0), 0);
          return (
            <div key={c.type} style={{ marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{c.type}</span>
                <Tag>{c.skus.length} SKU{c.skus.length !== 1 ? "s" : ""}</Tag>
                <Tag tone={typeUnits > 0 ? "ok" : undefined}>{qty(typeUnits)} units</Tag>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button className="btn" style={{ fontSize: 11, padding: "4px 9px" }}
                    onClick={() => { setBulkFor(bulkFor === c.type ? null : c.type); setBulkText(""); setBulkErr(""); }}>
                    {bulkFor === c.type ? "▲ Close paste" : "▼ Bulk paste"}
                  </button>
                  <button className="btn" style={{ fontSize: 11, padding: "4px 9px" }}
                    onClick={() => addRow(c.type)}>
                    <Plus size={11} />Add SKU
                  </button>
                </span>
              </div>

              {/* bulk paste box for this cover type */}
              {bulkFor === c.type && (
                <div style={{ marginBottom: 12, padding: 12, borderRadius: 9, border: "1px solid var(--accent)" }}>
                  <div style={{ fontSize: 11, color: "var(--dim)", marginBottom: 6, lineHeight: 1.5 }}>
                    One line per SKU. Columns: <code>SKU, Material, Units</code><br />
                    Paste straight from Excel — tabs work too, and a header row is skipped automatically.
                  </div>
                  <textarea rows={5} value={bulkText}
                    style={{ fontFamily: "var(--mono)", fontSize: 12, resize: "vertical" }}
                    placeholder={"SIL-SAM-A57-BLK, Liquid Silicone, 5000\nSIL-SAM-A57-BLU, Liquid Silicone, 4000\nSIL-SAM-A57-RED, Liquid Silicone, 3000"}
                    onChange={(e) => setBulkText(e.target.value)} />
                  {bulkErr && <div style={{ color: "var(--warn)", fontSize: 11, marginTop: 5 }}>{bulkErr}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="btn" data-primary="1" style={{ fontSize: 12 }}
                      onClick={() => applyBulk(c.type, bulkText)}>
                      Replace {c.type} SKUs
                    </button>
                    <button className="btn" style={{ fontSize: 12 }}
                      onClick={() => { setBulkFor(null); setBulkText(""); setBulkErr(""); }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* SKU rows */}
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 170 }}>SKU *</th>
                      <th style={{ minWidth: 150 }}>Material</th>
                      <th style={{ minWidth: 90 }}>Units</th>
                      <th style={{ width: 34 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.skus.map((r) => (
                      <tr key={r.rid} style={{ cursor: "default" }}>
                        <td style={{ padding: "6px 8px" }}>
                          <input value={r.sku} placeholder="SIL-SAM-A57-BLK"
                            style={{ fontFamily: "var(--mono)", fontSize: 12,
                              borderColor: !r.sku.trim() ? "var(--bad)" : undefined }}
                            onChange={(e) => editRow(c.type, r.rid, { sku: e.target.value })} />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <select value={r.material} style={{ fontSize: 12 }}
                            onChange={(e) => editRow(c.type, r.rid, { material: e.target.value })}>
                            <option value="">— select —</option>
                            {MATERIALS.map((m) => <option key={m}>{m}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <input type="number" min="0" value={r.units || ""}
                            style={{ fontFamily: "var(--mono)", fontSize: 12 }}
                            onChange={(e) => editRow(c.type, r.rid, { units: +e.target.value })} />
                        </td>
                        <td style={{ padding: "6px 4px", textAlign: "center" }}>
                          {c.skus.length > 1 && (
                            <button className="btn" title="Remove this SKU"
                              style={{ padding: "4px 6px", color: "var(--bad)", borderColor: "transparent" }}
                              onClick={() => removeRow(c.type, r.rid)}>
                              <X size={12} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {draft.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--dim)", padding: "14px 0" }}>
            Select at least one cover type above to start adding SKUs.
          </div>
        )}

        {/* summary + save */}
        {draft.length > 0 && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn" data-primary="1" onClick={save}>
              {saved ? "✓ Saved" : "Save covers & SKUs"}
            </button>
            <span style={{ fontSize: 12, color: "var(--dim)" }}>
              {draft.length} cover type{draft.length !== 1 ? "s" : ""} ·
              {" "}{rows.length} SKU{rows.length !== 1 ? "s" : ""} ·
              {" "}{qty(totalUnits)} units
            </span>
            {missingSku > 0 && (
              <Tag tone="bad">{missingSku} SKU{missingSku !== 1 ? "s" : ""} still blank</Tag>
            )}
          </div>
        )}
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
    const headers = ["Cover Type", "Material", "SKU", "Units Planned"];
    const rows = allSkus(model).map((r) => [r.type, r.material || "", r.sku || "", r.units]);
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
            <thead><tr><th>Cover Type</th><th>Material</th><th>SKU</th><th>Units</th></tr></thead>
            <tbody>
              {allSkus(model).map((r) => (
                <tr key={r.rid} style={{ cursor: "default" }}>
                  <td style={{ fontWeight: 550 }}>{r.type}</td>
                  <td style={{ color: "var(--dim)", fontSize: 12 }}>{r.material || "—"}</td>
                  <td className="n" style={{ fontSize: 12 }}>{r.sku || <span style={{ color: "var(--warn)" }}>missing</span>}</td>
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
    const headers = ["Brand", "Model", "PO", "Cover Type", "SKU", "Material", "Units", "STP Status"];
    const body = rows.map((r) => [model.brand, model.name, model.po || "", r.type,
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
            <thead><tr><th>Cover type</th><th>SKU</th><th>Material</th><th>Units</th><th style={{ minWidth: 150 }}>STP status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rid} style={{ cursor: "default" }}>
                  <td style={{ fontWeight: 550 }}>{r.type}</td>
                  <td className="n" style={{ fontSize: 12 }}>{r.sku || <span style={{ color: "var(--warn)" }}>missing</span>}</td>
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
      rid: r.rid, type: r.type, sku: r.sku, material: r.material,
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
              <th>Cover type</th><th>SKU</th><th>Planned</th>
              <th style={{ minWidth: 110 }}>Received</th><th>Short by</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const gapRow = r.state == null ? null : Math.max(0, r.planned - (r.received || 0));
                return (
                  <tr key={r.rid} style={{ cursor: "default" }}>
                    <td style={{ fontWeight: 550 }}>{r.type}</td>
                    <td className="n" style={{ fontSize: 12 }}>{r.sku || "—"}</td>
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
    const headers = ["Brand", "Model", "Cover Type", "SKU", ...MARKETPLACES, "Fully listed"];
    const body = rows.map((r) => [
      model.brand, model.name, r.type, r.sku || "",
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
                <th style={{ minWidth: 130 }}>Cover type</th>
                <th style={{ minWidth: 140 }}>SKU</th>
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
                  <td style={{ fontWeight: 550 }}>{r.type}</td>
                  <td className="n" style={{ fontSize: 12 }}>{r.sku || "—"}</td>
                  {MARKETPLACES.map((mp) => {
                    const st = draft[r.rid]?.[mp] || "Not listed";
                    return (
                      <td key={mp} style={{ textAlign: "center", padding: "6px 4px" }}>
                        <button className="btn"
                          title={`${r.sku || r.type} on ${mp} — click to change`}
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


/* ── RESEARCH STAGE: EDIT PHONE DETAILS ─────────────────────────
   Inline editor in the detail panel so you can correct the brand,
   model name, launch date and segment right where you're looking. */

function ResearchEditor({ model, onSave }) {
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

function Detail({ model, onClose, onAdvance, onGoBack, onResearchSave, onSKUSave, onSTPUpdate, onReceiptSave, onPOSave, onListingSave }) {
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
            <h2>Covers planned — {model.covers.length} type{model.covers.length !== 1 ? "s" : ""}, {allSkus(model).length} SKU{allSkus(model).length !== 1 ? "s" : ""}, {qty(model.units)} units</h2>
            {model.covers.length ? (
              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Cover type</th><th>SKU</th><th>Material</th><th>Units</th></tr></thead>
                  <tbody>
                    {model.covers.flatMap((c) =>
                      c.skus.map((r, i) => (
                        <tr key={r.rid} style={{ cursor: "default" }}>
                          {/* only label the first row of each group, so the eye groups them */}
                          <td style={{ fontWeight: i === 0 ? 550 : 400, color: i === 0 ? undefined : "var(--dim)" }}>
                            {i === 0 ? c.type : ""}
                          </td>
                          <td className="n" style={{ fontSize: 12 }}>
                            {r.sku || <span style={{ color: "var(--warn)" }}>no SKU</span>}
                          </td>
                          <td style={{ color: "var(--dim)", fontSize: 12 }}>
                            {r.material || <span style={{ color: "var(--bad)" }}>—</span>}
                          </td>
                          <td className="n">{qty(r.units)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : <div style={{ color: "var(--dim)", fontSize: 13 }}>No covers planned yet.</div>}
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
            const next = STAGES[model.index + 1];
            /* Gate: Planned → Ordered — every cover must have a SKU */
            if (model.stage === "planned") {
              const missingSkus = allSkus(model).filter((r) => !r.sku?.trim());
              const noCovers    = allSkus(model).length === 0;
              const blocked     = noCovers || missingSkus.length > 0;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button className="btn" data-primary="1"
                    style={{ opacity: blocked ? 0.4 : 1, cursor: blocked ? "not-allowed" : undefined }}
                    onClick={() => !blocked && onAdvance(model.id)}>
                    Move to {next.label} →
                  </button>
                  {noCovers && <span style={{ fontSize: 11, color: "var(--bad)" }}>Add covers in Planned stage first</span>}
                  {!noCovers && missingSkus.length > 0 && (
                    <span style={{ fontSize: 11, color: "var(--bad)" }}>
                      {missingSkus.length} SKU{missingSkus.length > 1 ? "s" : ""} still blank in: {[...new Set(missingSkus.map(r => r.type))].join(", ")}
                    </span>
                  )}
                </div>
              );
            }
            /* Gate: Received → Live — every cover must be confirmed */
            if (model.stage === "received") {
              const unconfirmed = allSkus(model).filter((r) => !isConfirmed(r));
              const blocked     = unconfirmed.length > 0;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button className="btn" data-primary="1"
                    style={{ opacity: blocked ? 0.4 : 1, cursor: blocked ? "not-allowed" : undefined }}
                    onClick={() => !blocked && onAdvance(model.id)}>
                    Move to {next.label} →
                  </button>
                  {blocked && (
                    <span style={{ fontSize: 11, color: "var(--bad)" }}>
                      Confirm all covers received or not before going live
                    </span>
                  )}
                </div>
              );
            }
            return (
              <button className="btn" data-primary="1" onClick={() => onAdvance(model.id)}>
                Move to {next.label} →
              </button>
            );
          })()}
          <button className="btn" onClick={onClose} style={{ marginLeft: "auto" }}>Close</button>
        </div>
      </aside>
    </>
  );
}


/* ── 11. ADD FORM ─────────────────────────────────────────────── */

const COVER_TYPES = ["TPU Cover", "Transparent Cover", "Silicone Cover", "Magsafe Cover",
                     "Leather Cover", "Rugged Cover", "Kickstand Cover"];
const NEW_MODEL = {
  brand: "", name: "", segment: "Mid Range", launch: "",
  covers: [],
};

const MATERIALS = ["Soft TPU", "Hard PC", "TPU + PC Hybrid", "Liquid Silicone",
                    "PU Leather", "PC + Magnet Array", "Tempered Glass", "Rugged Composite"];

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
      covers: [],   // covers are added in Planned stage
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
  const headers = ["Brand", "Model", "Segment", "Launch Date", "Cover Type", "Material", "SKU", "Units Planned"];
  const rows = [];
  models.filter((m) => m.stage === "planned").forEach((m) =>
    allSkus(m).forEach((r) =>
      rows.push([m.brand, m.name, m.segment, m.launch, r.type, r.material || "", r.sku || "", r.units])
    )
  );
  downloadReport("Planned_Models_Report", headers, rows, fmt);
}

/* Ordered report — every phone at Ordered with full SKU list */
function orderedReport(models, fmt) {
  const headers = ["Brand", "Model", "Segment", "Launch Date", "PO Number", "Cover Type", "Material", "SKU", "Units"];
  const rows = [];
  models.filter((m) => m.stage === "ordered").forEach((m) =>
    allSkus(m).forEach((r) =>
      rows.push([m.brand, m.name, m.segment, m.launch, m.po || "", r.type, r.material || "", r.sku || "", r.units])
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
        r.type, r.material || "MISSING", r.sku || "MISSING", r.units,
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

  const problems = models.flatMap((m) => {
    const ps = [];
    if (m.isLate) ps.push({ model: m, type: "bad",  text: `+${m.worstDelay}d behind schedule` });
    if (m.stage !== "live" && m.daysToLaunch >= 0 && m.daysToLaunch <= 14)
      ps.push({ model: m, type: "warn", text: `Launches in ${m.daysToLaunch} day${m.daysToLaunch === 1 ? "" : "s"}` });
    if (m.stage === "planned" && allSkus(m).length === 0)
      ps.push({ model: m, type: "warn", text: "No covers planned yet" });
    if (m.stage === "live" && allSkus(m).some((r) => !isFullyListed(r)))
      ps.push({ model: m, type: "warn",
        text: `Live but not listed everywhere — ${allSkus(m).filter((r) => !isFullyListed(r)).length} SKU(s) incomplete` });
    if (allSkus(m).some((r) => blockedCount(r) > 0))
      ps.push({ model: m, type: "bad", text: "Listing blocked on a marketplace" });
    if (m.stage === "ordered" && !m.po)
      ps.push({ model: m, type: "warn", text: "No PO number recorded" });
    if (m.stage === "production" && allSkus(m).some((r) => r.stpStatus === "Rejected"))
      ps.push({ model: m, type: "bad", text: "STP file rejected on one or more SKUs" });
    if (allSkus(m).some((r) => r.receiptState === "short"))
      ps.push({ model: m, type: "warn", text: `Short delivery — ${qty(allSkus(m).reduce((s, r) => s + shortfallOf(r), 0))} units missing` });
    if (allSkus(m).some((r) => r.receiptState === "none"))
      ps.push({ model: m, type: "bad", text: "One or more SKUs never arrived" });
    if (m.stage === "planned" && allSkus(m).some((r) => !r.sku?.trim()))
      ps.push({ model: m, type: "warn", text: "SKU still blank — can't move to Ordered" });
    if (m.stage === "production" && allSkus(m).some((r) => !r.stpStatus || r.stpStatus === "Not Sent"))
      ps.push({ model: m, type: "warn", text: "STP file not sent yet" });
    return ps;
  });

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


/* ── REPORTS ────────────────────────────────────────────────────── */

/* Six reports. Each has a name, column headers, and a row builder. */
function buildReportRows(reportKey, models) {
  switch (reportKey) {
    case "all": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "Stage", "PO Number", "Cover Types", "SKUs", "Total Units", "Late?", "Days to Launch"],
      rows: models.map((m) => [m.brand, m.name, m.segment, m.launch, STAGES[m.index].label,
        m.po || "", m.covers.length, allSkus(m).length, m.units, m.isLate ? `Yes (+${m.worstDelay}d)` : "No",
        m.daysToLaunch < 0 ? `${-m.daysToLaunch}d ago` : `in ${m.daysToLaunch}d`]),
    };
    case "planned": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "Cover Type", "Material", "SKU", "Units Planned", "SKU Status"],
      rows: models.filter((m) => m.stage === "planned").flatMap((m) =>
        allSkus(m).length ? allSkus(m).map((r) => [m.brand, m.name, m.segment, m.launch,
          r.type, r.material || "", r.sku || "", r.units, r.sku ? "✓ OK" : "⚠ Missing"])
        : [[m.brand, m.name, m.segment, m.launch, "—", "—", "—", "—", "No covers yet"]]),
    };
    case "ordered": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "PO Number", "Cover Type", "Material", "SKU", "Units"],
      rows: models.filter((m) => m.stage === "ordered").flatMap((m) =>
        allSkus(m).map((r) => [m.brand, m.name, m.segment, m.launch, m.po || "",
          r.type, r.material || "", r.sku || "", r.units])),
    };
    case "production": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "PO Number", "Cover Type", "Material", "SKU", "Units", "STP Required", "STP Status"],
      rows: models.filter((m) => m.stage === "production").flatMap((m) =>
        allSkus(m).map((r) => [m.brand, m.name, m.segment, m.launch, m.po || "",
          r.type, r.material || "MISSING", r.sku || "MISSING", r.units,
          (!r.material || !r.sku) ? "YES — fix data" : "YES", r.stpStatus || "Not Sent"])),
    };
    case "received": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "PO Number", "Cover Type", "SKU", "Material", "Planned Qty", "Received Qty", "Short By", "Status"],
      rows: models.filter((m) => m.stage === "received").flatMap((m) =>
        allSkus(m).map((r) => [m.brand, m.name, m.segment, m.launch, m.po || "",
          r.type, r.sku || "", r.material || "", r.units, r.receivedQty ?? "—",
          isConfirmed(r) ? shortfallOf(r) : "—", receiptLabel(r)])),
    };
    case "listing":
      return {
        headers: ["Brand", "Model", "Stage", "Cover Type", "SKU", ...MARKETPLACES, "Fully listed"],
        rows: models.filter((m) => ["received", "live"].includes(m.stage)).flatMap((m) =>
          allSkus(m).map((r) => [m.brand, m.name, STAGES[m.index].label, r.type, r.sku || "",
            ...MARKETPLACES.map((mp) => r.listings?.[mp] || "Not listed"),
            isFullyListed(r) ? "Yes" : "No"])),
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

export default function App() {
  const [phones, setPhones] = useState(EMPTY);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState("dashboard");
  const [theme, setTheme] = useState("dark");
  const [toast, setToast] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const say = (text) => { setToast(text); setTimeout(() => setToast((t) => (t === text ? null : t)), 2500); };

  /* derive everything, every render — never stored, never stale */
  const models = useMemo(() => phones.map(derive), [phones]);
  const open = openId ? models.find((m) => m.id === openId) : null;

  /* move a phone to a stage and record the date it happened */
  const moveTo = (id, stageKey) => setPhones((list) => list.map((p) => {
    if (p.id !== id) return p;
    const done = { ...p.done };
    /* mark every stage up to the new one as done */
    STAGES.slice(0, stageIndex(stageKey) + 1).forEach((s) => { done[s.key] ||= iso(TODAY); });
    return { ...p, stage: stageKey, done };
  }));

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
    setPhones((list) => list.map((p) => {
      if (p.id !== id) return p;
      const done = { ...p.done };
      delete done[m.stage];
      return { ...p, stage: prev.key, done };
    }));
    say(`${m.name} moved back to ${prev.label}`);
  };

  /* save edited phone details from ResearchEditor */
  const saveResearch = (id, edits) => {
    setPhones((list) => list.map((p) => p.id !== id ? p : { ...p, ...edits }));
    say("Phone details updated");
  };

  /* save covers array from PlannedSKUEditor */
  const saveSKU = (id, covers) => {
    setPhones((list) => list.map((p) => p.id !== id ? p : { ...p, covers }));
    say("Covers saved");
  };

  /* update STP file status from ProductionSTP */
  /* STP status is set per SKU — rows is a map of rid -> status */
  const updateSTP = (id, statusByRid) => {
    setPhones((list) => list.map((p) => p.id !== id ? p : {
      ...p,
      covers: p.covers.map((c) => ({
        ...c,
        skus: c.skus.map((r) => statusByRid[r.rid] ? { ...r, stpStatus: statusByRid[r.rid] } : r),
      })),
    }));
    say("STP status saved");
  };

  /* listingsByRid = { rid: { Flipkart: "Live", ... } } */
  const saveListings = (id, listingsByRid) => {
    setPhones((list) => list.map((p) => p.id !== id ? p : {
      ...p,
      covers: p.covers.map((c) => ({
        ...c,
        skus: c.skus.map((r) => listingsByRid[r.rid]
          ? { ...r, listings: { ...r.listings, ...listingsByRid[r.rid] } } : r),
      })),
    }));
    say("Listing status saved");
  };

  /* PO number is typed by the buyer, never invented by the app */
  const savePO = (id, po) => {
    setPhones((list) => list.map((p) => p.id !== id ? p : { ...p, po: po.trim() }));
    say(po.trim() ? "PO number saved" : "PO number cleared");
  };

  /* save goods receipt rows from ReceivedChecker */
  const saveReceipt = (id, receiptRows) => {
    setPhones((list) => list.map((p) => {
      if (p.id !== id) return p;
      const updated = p.covers.map((c) => ({
        ...c,
        skus: c.skus.map((row) => {
          const r = receiptRows.find((rr) => rr.rid === row.rid);
          return r ? { ...row, receivedQty: r.received, receiptState: r.state } : row;
        }),
      }));
      return { ...p, covers: updated };
    }));
    say("Receipt saved");
  };

  const resetAll = () => {
    setPhones([]);
    setOpenId(null);
    setAdding(false);
    setConfirmReset(false);
    say("All phones deleted");
  };

  const addPhone = (data) => {
    const id = Math.max(0, ...phones.map((p) => p.id)) + 1;
    setPhones((list) => [...list, { ...data, id }]);
    setAdding(false);
    setOpenId(id);
    say(`${data.brand} ${data.name} added and tracking`);
  };

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
            <button className="btn" data-on={view === "reports" ? "1" : "0"} onClick={() => setView("reports")}>
              <FileText size={14} />Reports
            </button>
            <button className="btn btn-icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                    aria-label="Switch theme">
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button className="btn" style={{ color: "var(--bad)", borderColor: "var(--bad)" }}
              onClick={() => setConfirmReset(true)} title="Delete all phones and start fresh">
              Reset
            </button>
            <button className="btn" data-primary="1" onClick={() => setAdding(true)}>
              <Plus size={14} />Add phone
            </button>
          </div>
        </div>

        {view === "dashboard" && <Dashboard models={models} onOpen={setOpenId} onAdd={() => setAdding(true)} />}
        {view === "board"     && <Board models={models} onOpen={setOpenId} onMove={moveTo} onAdd={() => setAdding(true)} />}
        {view === "table"     && <Table models={models} onOpen={setOpenId} />}
        {view === "reports"   && <Reports models={models} />}
      </div>

      {open   && <Detail model={open} onClose={() => setOpenId(null)} onAdvance={advance} onGoBack={goBack} onResearchSave={saveResearch} onSKUSave={saveSKU} onSTPUpdate={updateSTP} onReceiptSave={saveReceipt} onPOSave={savePO} onListingSave={saveListings} />}
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
      {toast  && <div className="toast">{toast}</div>}
    </div>
  );
}
