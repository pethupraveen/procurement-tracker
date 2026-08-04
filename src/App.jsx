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
     helpers -> stages -> scoring -> data -> derive -> UI
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

const D = (n) => shift(iso(TODAY), n);   // n days from today

/* helper so the seed data below stays readable */
const cover = (type, units, sku, material) => ({ type, units, sku: sku || '', material: material || '' });

const SEED = [
  {
    id: 1, brand: "Redmi", name: "Note 15 Pro 5G", segment: "Mid Range",
    launch: D(-12), stage: "live", po: "PO-101",
    done: { research: D(-112), planned: D(-96), ordered: D(-87), production: D(-71), received: D(-36), live: D(-12) },
    covers: [cover("TPU Cover", 30000, "TPU-RDM-N15-BLK", "Soft TPU"), cover("Transparent Cover", 34000, "TRN-RDM-N15-CLR", "Hard PC")],
  },
  {
    id: 2, brand: "Samsung", name: "Galaxy S26 Ultra", segment: "Flagship",
    launch: D(-40), stage: "live", po: "PO-102",
    done: { research: D(-140), planned: D(-124), ordered: D(-115), production: D(-98), received: D(-63), live: D(-38) },
    covers: [cover("Magsafe Cover", 9000, "MAG-SAM-S26-BLK", "PC + Magnet Array"), cover("Leather Cover", 4000, "LTH-SAM-S26-BRN", "PU Leather")],
  },
  {
    id: 3, brand: "Oppo", name: "Reno 15 5G", segment: "Premium",
    launch: D(30), stage: "received", po: "PO-103",
    /* stock arrived a week early — delay comes out negative, which is fine */
    done: { research: D(-70), planned: D(-55), ordered: D(-44), production: D(-29), received: D(-2) },
    covers: [{ ...cover("Magsafe Cover", 7000, "MAG-OPP-R15-BLK", "PC + Magnet Array"), receivedQty: 6800, receivedOk: true },
          { ...cover("Transparent Cover", 11000, "TRN-OPP-R15-CLR", "Hard PC"), receivedQty: null, receivedOk: null }],
  },
  {
    id: 4, brand: "Realme", name: "15 Pro 5G", segment: "Mid Range",
    launch: D(26), stage: "production", po: "PO-104",
    /* PROBLEM CASE: production finished 12 days after it was due */
    done: { research: D(-74), planned: D(-58), ordered: D(-46), production: D(-22) },
    stpStatus: "Submitted",
    covers: [cover("TPU Cover", 18000, "TPU-REA-15P-BLK", "Soft TPU"), cover("Kickstand Cover", 8000, "KCK-REA-15P-BLK", "TPU + PC Hybrid")],
  },
  {
    id: 5, brand: "OnePlus", name: "Nord 6", segment: "Mid Range",
    launch: D(50), stage: "ordered", po: "PO-105",
    /* PROBLEM CASE: PO is placed but production was due 10 days ago and
       hasn't started — caught because the NEXT stage is already overdue */
    done: { research: D(-50), planned: D(-33), ordered: D(-20) },
    covers: [cover("Magsafe Cover", 9000, "MAG-ONE-N6-BLK", "PC + Magnet Array"), cover("Silicone Cover", 11000, "SIL-ONE-N6-WHT", "Liquid Silicone")],
  },
  {
    id: 6, brand: "Poco", name: "X8 Pro 5G", segment: "Mid Range",
    launch: D(85), stage: "planned", po: null,
    done: { research: D(-15), planned: D(-1) },
    covers: [cover("TPU Cover", 26000, "TPU-POC-X8-BLK", "Soft TPU"), cover("Rugged Cover", 12000, "RGD-POC-X8-GRY", "Rugged Composite")],
  },
  {
    id: 7, brand: "Nothing", name: "Phone (4a)", segment: "Mid Range",
    launch: D(95), stage: "research", po: null,
    done: { research: D(-3) },
    covers: [],
  },
  {
    id: 8, brand: "Tecno", name: "Camon 40 Pro", segment: "Budget",
    launch: D(90), stage: "research", po: null,
    done: { research: D(-8) },
    covers: [],
  },
];


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
    units: model.covers.reduce((sum, c) => sum + c.units, 0),
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

function Board({ models, onOpen, onMove }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);

  const drop = (stageKey) => {
    if (dragging && dragging.stage !== stageKey) onMove(dragging.id, stageKey);
    setDragging(null); setOver(null);
  };

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



/* ── PLANNED STAGE: SKU + MATERIAL EDITOR ────────────────────────
   Shown inside the detail panel only when the model is at Planned.
   Lets the buyer lock in SKUs and materials before the PO is sent. */

function PlannedSKUEditor({ model, onSave }) {
  /* start from existing covers so edits survive re-opens */
  const [selected, setSelected] = useState(
    () => new Set(model.covers.map((c) => c.type))
  );
  const [edits, setEdits] = useState(() => {
    const m = {};
    model.covers.forEach((c) => { m[c.type] = { units: c.units || 10000, sku: c.sku || "", material: c.material || "" }; });
    return m;
  });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkErr, setBulkErr] = useState("");
  const [saved, setSaved] = useState(false);

  const toggle = (type) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(type)) { n.delete(type); }
      else { n.add(type); setEdits((e) => ({ ...e, [type]: e[type] || { units: 10000, sku: "", material: "" } })); }
      return n;
    });
  };
  const edit = (type, patch) => setEdits((e) => ({ ...e, [type]: { ...e[type], ...patch } }));

  const applyBulk = (raw) => {
    const rows = raw.trim().split(/\n/).map((r) => r.split(",").map((x) => x.trim()));
    const map = {};
    rows.forEach(([type, sku]) => { if (type && sku) map[type] = sku; });
    if (!Object.keys(map).length) { setBulkErr("No valid rows. Format: Cover Type, SKU"); return; }
    setEdits((e) => {
      const n = { ...e };
      Object.entries(map).forEach(([t, sku]) => { if (n[t]) n[t] = { ...n[t], sku }; });
      return n;
    });
    setBulkErr(""); setBulkOpen(false); setBulkText("");
  };

  const save = () => {
    const covers = [...selected].map((type) => cover(type, edits[type]?.units || 0, edits[type]?.sku || "", edits[type]?.material || ""));
    onSave(model.id, covers);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const allHaveSKU = [...selected].every((t) => edits[t]?.sku?.trim());

  return (
    <div>
      <h2 style={{ color: "var(--warn)" }}>▸ Planned — choose covers, set SKU &amp; material</h2>
      <div className="card">
        <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 10 }}>
          Select cover types below, then fill in units, SKU and material. <strong>Every cover needs a SKU before you can move to Ordered.</strong>
        </div>

        {/* cover type selector */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
          {COVER_TYPES.map((type) => (
            <button key={type} className="btn" data-on={selected.has(type) ? "1" : "0"} onClick={() => toggle(type)}>
              {selected.has(type) ? <CheckCircle2 size={12} /> : <Circle size={12} />}{type}
            </button>
          ))}
        </div>

        {/* per-cover detail rows */}
        {[...selected].map((type) => {
          const e = edits[type] || {};
          const skuMissing = !e.sku?.trim();
          return (
            <div key={type} style={{ paddingBottom: 14, marginBottom: 14, borderBottom: "1px solid var(--line)" }}>
              <div style={{ fontWeight: 570, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                {type}
                {skuMissing && <span style={{ fontSize: 11, color: "var(--bad)" }}>⚠ SKU required</span>}
              </div>
              <div className="two" style={{ marginBottom: 8 }}>
                <Field label="Units planned">
                  <input type="number" min="0" value={e.units || ""}
                    onChange={(ev) => edit(type, { units: +ev.target.value })} />
                </Field>
                <Field label="SKU *">
                  <input value={e.sku || ""} placeholder="e.g. TPU-OPP-R15-BLK"
                    style={{ borderColor: skuMissing ? "var(--bad)" : undefined }}
                    onChange={(ev) => edit(type, { sku: ev.target.value })} />
                </Field>
              </div>
              <Field label="Material">
                <select value={e.material || ""}
                  onChange={(ev) => edit(type, { material: ev.target.value })}>
                  <option value="">— select —</option>
                  {MATERIALS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
            </div>
          );
        })}

        {selected.size === 0 && (
          <div style={{ fontSize: 13, color: "var(--dim)", padding: "10px 0" }}>Select at least one cover type above.</div>
        )}

        {/* bulk SKU */}
        {selected.size > 0 && (
          <>
            <button className="btn" style={{ fontSize: 12, marginBottom: 10 }} onClick={() => setBulkOpen((b) => !b)}>
              {bulkOpen ? "▲ Hide bulk SKU" : "▼ Bulk SKU paste"}
            </button>
            {bulkOpen && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "var(--dim)", marginBottom: 6 }}>
                  One line per cover: <code>Cover Type, SKU</code>
                </div>
                <textarea className="f" rows={4} value={bulkText}
                  style={{ fontFamily: "var(--mono)", fontSize: 12, resize: "vertical" }}
                  placeholder={"TPU Cover, TPU-OPP-R15-BLK\nMagsafe Cover, MAG-OPP-R15-CLR"}
                  onChange={(e) => setBulkText(e.target.value)} />
                {bulkErr && <div style={{ color: "var(--bad)", fontSize: 11, marginTop: 4 }}>{bulkErr}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn" data-primary="1" onClick={() => applyBulk(bulkText)}>Apply</button>
                  <button className="btn" onClick={() => { setBulkOpen(false); setBulkText(""); setBulkErr(""); }}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}

        {!allHaveSKU && selected.size > 0 && (
          <div style={{ fontSize: 12, color: "var(--bad)", marginBottom: 8 }}>
            All covers need a SKU before you can move to Ordered.
          </div>
        )}

        <button className="btn" data-primary="1" onClick={save} style={{ opacity: selected.size === 0 ? 0.4 : 1 }}>
          {saved ? "✓ Saved" : "Save covers"}
        </button>
      </div>
    </div>
  );
}


/* ── ORDERED STAGE: EXPORT PLANNED SKUs ──────────────────────────
   Download a CSV/Excel of all SKUs so supplier can confirm.       */

function SKUExport({ model }) {
  const exportFile = (fmt) => {
    const headers = ["Cover Type", "Material", "SKU", "Units Planned"];
    const rows = model.covers.map((c) => [c.type, c.material || "", c.sku || "", c.units]);
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
  const missing = model.covers.filter((c) => !c.sku);
  return (
    <div>
      <h2>▸ Ordered — SKU export for supplier</h2>
      <div className="card">
        {missing.length > 0 && (
          <div style={{ color: "var(--warn)", fontSize: 12, marginBottom: 10 }}>
            {missing.length} cover{missing.length > 1 ? "s" : ""} still missing SKU — go back to Planned to fix.
          </div>
        )}
        <div style={{ overflowX: "auto", marginBottom: 12 }}>
          <table>
            <thead><tr><th>Cover Type</th><th>Material</th><th>SKU</th><th>Units</th></tr></thead>
            <tbody>
              {model.covers.map((c) => (
                <tr key={c.type} style={{ cursor: "default" }}>
                  <td style={{ fontWeight: 550 }}>{c.type}</td>
                  <td style={{ color: "var(--dim)", fontSize: 12 }}>{c.material || "—"}</td>
                  <td className="n" style={{ fontSize: 12 }}>{c.sku || <span style={{ color: "var(--warn)" }}>missing</span>}</td>
                  <td className="n">{qty(c.units)}</td>
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


/* ── PRODUCTION STAGE: STP FILE ──────────────────────────────────
   Export a materials summary to send as an STP file request.
   After sending, track the STP file status.                       */

const STP_STATUSES = ["Not Sent", "Submitted", "Acknowledged", "In Progress", "Completed", "Rejected"];

function ProductionSTP({ model, onSTPUpdate }) {
  const [status, setStatus] = useState(model.stpStatus || "Not Sent");
  const [saved, setSaved] = useState(false);

  const exportSTP = (fmt) => {
    const headers = ["Brand", "Model", "Cover Type", "Material", "SKU", "Units", "PO Number"];
    const rows = model.covers.map((c) => [model.brand, model.name, c.type, c.material || "", c.sku || "", c.units, model.po || ""]);
    const isCSV = fmt === "csv";
    const sep = isCSV ? "," : "	";
    const ext  = isCSV ? ".csv" : ".xls";
    const mime = isCSV ? "text/csv" : "application/vnd.ms-excel";
    const lines = [headers, ...rows].map((r) =>
      isCSV ? r.map((v) => `"${String(v).replace(/"/g,'""')}"`).join(",") : r.join("\t")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines], { type: mime + ";charset=utf-8;" }));
    a.download = `STP_${model.brand}_${model.name.replace(/\s+/g,"_")}${ext}`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const save = () => { onSTPUpdate(model.id, status); setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const toneOf = (s) => s === "Completed" ? "ok" : s === "Rejected" ? "bad" : s === "Not Sent" ? "mute" : "warn";

  return (
    <div>
      <h2 style={{ color: "var(--warn)" }}>▸ Production — STP file</h2>
      <div className="card">
        {/* summary table */}
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Materials ordered — {model.covers.length} cover type{model.covers.length !== 1 ? "s" : ""}</div>
        <div style={{ overflowX: "auto", marginBottom: 14 }}>
          <table>
            <thead><tr><th>Cover Type</th><th>Material</th><th>SKU</th><th>Units</th></tr></thead>
            <tbody>
              {model.covers.map((c) => (
                <tr key={c.type} style={{ cursor: "default" }}>
                  <td style={{ fontWeight: 550 }}>{c.type}</td>
                  <td style={{ color: "var(--dim)", fontSize: 12 }}>{c.material || <span style={{ color: "var(--bad)" }}>missing</span>}</td>
                  <td className="n" style={{ fontSize: 12 }}>{c.sku || "—"}</td>
                  <td className="n">{qty(c.units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* export */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button className="btn" data-primary="1" onClick={() => exportSTP("csv")}>↓ Export STP (CSV)</button>
          <button className="btn" onClick={() => exportSTP("excel")}>↓ Export STP (Excel)</button>
        </div>

        {/* status tracker */}
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>STP file status</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 12 }}>
            {STP_STATUSES.map((st) => (
              <button key={st} className="btn" data-on={status === st ? "1" : "0"}
                style={{ fontSize: 12 }} onClick={() => setStatus(st)}>
                {st}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="tag" data-tone={toneOf(status)}>{status}</span>
            <button className="btn" data-primary="1" style={{ fontSize: 12 }} onClick={save}>
              {saved ? "✓ Saved" : "Save status"}
            </button>
          </div>
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
    model.covers.map((c) => ({
      type: c.type, sku: c.sku, planned: c.units,
      received: c.receivedQty ?? null,
      ok: c.receivedOk ?? null,
    }))
  );
  const [saved, setSaved] = useState(false);

  const update = (type, patch) =>
    setRows((r) => r.map((row) => row.type === type ? { ...row, ...patch } : row));

  const save = () => { onSave(model.id, rows); setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const allConfirmed = rows.every((r) => r.ok !== null);
  const allOk        = rows.every((r) => r.ok === true);

  return (
    <div>
      <h2 style={{ color: "var(--warn)" }}>▸ Received — confirm each cover</h2>
      <div className="card">
        <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 14 }}>
          Tick <strong>Received</strong> or <strong>Not received</strong> for every cover type.
          Once all are confirmed you can move to Live.
        </div>

        {rows.map((row) => (
          <div key={row.type} style={{ display: "flex", gap: 12, alignItems: "center",
            padding: "11px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 570 }}>{row.type}</div>
              <div className="n" style={{ fontSize: 11, color: "var(--dim)" }}>
                SKU: {row.sku || "—"} · Planned: {qty(row.planned)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" min="0" max={row.planned * 2} value={row.received ?? ""}
                placeholder="qty received"
                style={{ width: 110, fontFamily: "var(--mono)" }}
                onChange={(e) => update(row.type, { received: +e.target.value })} />
              <button className="btn" data-on={row.ok === true ? "1" : "0"}
                style={{ fontSize: 12, color: row.ok === true ? "var(--ok)" : undefined }}
                onClick={() => update(row.type, { ok: true })}>
                <CheckCircle2 size={13} /> Received
              </button>
              <button className="btn"
                style={{ fontSize: 12, color: row.ok === false ? "var(--bad)" : undefined,
                  borderColor: row.ok === false ? "var(--bad)" : undefined }}
                onClick={() => update(row.type, { ok: false })}>
                ✕ Not received
              </button>
            </div>
          </div>
        ))}

        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {allConfirmed
            ? allOk
              ? <span className="tag" data-tone="ok">All covers received ✓</span>
              : <span className="tag" data-tone="warn">Some covers not received — flag before going live</span>
            : <span className="tag" data-tone="mute">{rows.filter(r => r.ok === null).length} cover{rows.filter(r => r.ok === null).length !== 1 ? "s" : ""} still unconfirmed</span>}
          <button className="btn" data-primary="1" onClick={save}>{saved ? "✓ Saved" : "Save receipt"}</button>
        </div>
      </div>
    </div>
  );
}


/* ── 10. DETAIL PANEL ────────────────────────────────────────────
   One scrolling panel. Covers, timeline. No tabs.                  */


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

function Detail({ model, onClose, onAdvance, onGoBack, onResearchSave, onSKUSave, onSTPUpdate, onReceiptSave }) {
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
            <h2>Covers planned — {model.covers.length} type{model.covers.length !== 1 ? "s" : ""}, {qty(model.covers.reduce((s,c)=>s+c.units,0))} total units</h2>
            {model.covers.length ? (
              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Type</th><th>Material</th><th>SKU</th><th>Units</th></tr></thead>
                  <tbody>
                    {model.covers.map((c) => (
                      <tr key={c.type} style={{ cursor: "default" }}>
                        <td style={{ fontWeight: 550 }}>{c.type}</td>
                        <td style={{ color: "var(--dim)", fontSize: 12 }}>{c.material || <span style={{color:"var(--bad)"}}>—</span>}</td>
                        <td className="n" style={{ fontSize: 12 }}>{c.sku || <span style={{ color: "var(--warn)" }}>no SKU</span>}</td>
                        <td className="n">{qty(c.units)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div style={{ color: "var(--dim)", fontSize: 13 }}>No covers planned yet.</div>}
          </div>

          {/* Research stage: edit phone details */}
          {model.stage === "research" && (
            <ResearchEditor model={model} onSave={onResearchSave} />
          )}

          {/* Planned stage: choose covers, set SKU + material */}
          {model.stage === "planned" && (
            <PlannedSKUEditor model={model} onSave={onSKUSave} />
          )}

          {/* Ordered stage: export SKU list for the supplier */}
          {model.stage === "ordered" && (
            <SKUExport model={model} />
          )}

          {/* Production stage: STP file + status */}
          {model.stage === "production" && (
            <ProductionSTP model={model} onSTPUpdate={onSTPUpdate} />
          )}

          {/* Received stage: goods receipt per cover type */}
          {model.stage === "received" && (
            <ReceivedChecker model={model} onSave={onReceiptSave} />
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
              const missingSkus = model.covers.filter((c) => !c.sku?.trim());
              const noCovers    = model.covers.length === 0;
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
                      {missingSkus.length} cover{missingSkus.length > 1 ? "s" : ""} missing SKU: {missingSkus.map(c => c.type).join(", ")}
                    </span>
                  )}
                </div>
              );
            }
            /* Gate: Received → Live — every cover must be confirmed */
            if (model.stage === "received") {
              const unconfirmed = model.covers.filter((c) => c.receivedOk === null || c.receivedOk === undefined);
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

  /* bulk SKU paste: "TYPE,SKU\nTYPE,SKU" */
  const applyBulkSKU = (raw) => {
    const rows = raw.trim().split(/\n/).map(r => r.split(",").map(x => x.trim()));
    const map = {};
    rows.forEach(([type, sku]) => { if (type && sku) map[type] = sku; });
    if (!Object.keys(map).length) { setBulkErr("No valid rows found. Use one line per cover: Type, SKU"); return; }
    setForm((f) => ({ ...f, covers: f.covers.map((c) => map[c.type] ? { ...c, sku: map[c.type] } : c) }));
    setBulkErr("");
    setBulkOpen(false);
  };
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
    m.covers.forEach((c) =>
      rows.push([m.brand, m.name, m.segment, m.launch, c.type, c.material || "", c.sku || "", c.units])
    )
  );
  downloadReport("Planned_Models_Report", headers, rows, fmt);
}

/* Ordered report — every phone at Ordered with full SKU list */
function orderedReport(models, fmt) {
  const headers = ["Brand", "Model", "Segment", "Launch Date", "PO Number", "Cover Type", "Material", "SKU", "Units"];
  const rows = [];
  models.filter((m) => m.stage === "ordered").forEach((m) =>
    m.covers.forEach((c) =>
      rows.push([m.brand, m.name, m.segment, m.launch, m.po || "", c.type, c.material || "", c.sku || "", c.units])
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
    m.covers.forEach((c) => {
      const stpRequired = (!c.material || !c.sku) ? "YES — missing data" : "YES";
      rows.push([
        m.brand, m.name, m.segment, m.launch, m.po || "",
        c.type, c.material || "MISSING", c.sku || "MISSING", c.units,
        stpRequired, m.stpStatus || "Not Sent"
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
function Dashboard({ models, onOpen }) {
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
  const stpNotSent    = prod.filter((m) => !m.stpStatus || m.stpStatus === "Not Sent").length;
  const stpDone       = prod.filter((m) => m.stpStatus === "Completed").length;
  const noCovers      = planned.filter((m) => m.covers.length === 0).length;
  const missingSkus   = planned.filter((m) => m.covers.some((c) => !c.sku?.trim())).length;
  const unconfRec     = received.filter((m) => m.covers.some((c) => c.receivedOk === null || c.receivedOk === undefined)).length;
  const launching14   = models.filter((m) => m.stage !== "live" && m.daysToLaunch >= 0 && m.daysToLaunch <= 14);

  /* funnel max for % bar width */
  const funnelMax = Math.max(1, models.length);

  const problems = models.flatMap((m) => {
    const ps = [];
    if (m.isLate) ps.push({ model: m, type: "bad",  text: `+${m.worstDelay}d behind schedule` });
    if (m.stage !== "live" && m.daysToLaunch >= 0 && m.daysToLaunch <= 14)
      ps.push({ model: m, type: "warn", text: `Launches in ${m.daysToLaunch} day${m.daysToLaunch === 1 ? "" : "s"}` });
    if (m.stage === "planned" && m.covers.length === 0)
      ps.push({ model: m, type: "warn", text: "No covers planned yet" });
    if (m.stage === "planned" && m.covers.some((c) => !c.sku?.trim()))
      ps.push({ model: m, type: "warn", text: "Cover missing SKU — can't move to Ordered" });
    if (m.stage === "production" && (!m.stpStatus || m.stpStatus === "Not Sent"))
      ps.push({ model: m, type: "warn", text: "STP file not sent yet" });
    return ps;
  });

  return (
    <div>
      {/* ── 10 KPI cards ── */}
      <div style={{ marginBottom: 6 }}>
        <h2>Key numbers</h2>
      </div>
      <div className="kpi-grid">
        <KPI label="Phones tracked"   value={models.length}   sub="across all stages" />
        <KPI label="Research"         value={research.length} sub={research.length ? research.map(m=>m.name).join(", ").slice(0,40) : "None yet"} />
        <KPI label="Planned"          value={planned.length}
          tone={noCovers > 0 ? "warn" : planned.length > 0 ? "ok" : undefined}
          sub={noCovers > 0 ? `${noCovers} need covers added` : missingSkus > 0 ? `${missingSkus} missing SKU` : planned.length > 0 ? "All have SKUs" : "None yet"}
          onCSV={planned.length ? () => plannedReport(models, "csv") : undefined}
          onXLS={planned.length ? () => plannedReport(models, "excel") : undefined} />
        <KPI label="Ordered"          value={ordered.length}
          tone={ordered.length > 0 ? "accent" : undefined}
          sub={ordered.length ? `${ordered.reduce((s,m)=>s+m.covers.length,0)} cover types` : "None yet"}
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
        <KPI label="Running late"     value={late.length}  tone={late.length > 0 ? "bad" : "ok"}
          sub={late.length > 0 ? `${late.map(m=>m.name).join(", ").slice(0,40)}` : "All on time"} />
        <KPI label="Launching ≤ 14d"  value={launching14.length}
          tone={launching14.length > 0 ? "warn" : undefined}
          sub={launching14.length ? launching14.map(m=>`${m.name} in ${m.daysToLaunch}d`).join(", ").slice(0,50) : "None urgent"} />
        <KPI label="Units in pipeline" value={qty(totalUnits)} tone="accent"
          sub={liveUnits ? `${qty(liveUnits)} live · ${qty(totalUnits - liveUnits)} in pipeline` : "No live yet"} />
      </div>

      {/* ── pipeline funnel ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
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
      </div>

      {/* ── alerts ── */}
      {problems.length > 0 && (
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
      {problems.length === 0 && (
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
      headers: ["Brand", "Model", "Segment", "Launch Date", "Stage", "PO Number", "Cover Types", "Total Units", "Late?", "Days to Launch"],
      rows: models.map((m) => [m.brand, m.name, m.segment, m.launch, STAGES[m.index].label,
        m.po || "", m.covers.length, m.units, m.isLate ? `Yes (+${m.worstDelay}d)` : "No",
        m.daysToLaunch < 0 ? `${-m.daysToLaunch}d ago` : `in ${m.daysToLaunch}d`]),
    };
    case "planned": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "Cover Type", "Material", "SKU", "Units Planned", "SKU Status"],
      rows: models.filter((m) => m.stage === "planned").flatMap((m) =>
        m.covers.length ? m.covers.map((c) => [m.brand, m.name, m.segment, m.launch,
          c.type, c.material || "", c.sku || "", c.units, c.sku ? "✓ OK" : "⚠ Missing"])
        : [[m.brand, m.name, m.segment, m.launch, "—", "—", "—", "—", "No covers yet"]]),
    };
    case "ordered": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "PO Number", "Cover Type", "Material", "SKU", "Units"],
      rows: models.filter((m) => m.stage === "ordered").flatMap((m) =>
        m.covers.map((c) => [m.brand, m.name, m.segment, m.launch, m.po || "",
          c.type, c.material || "", c.sku || "", c.units])),
    };
    case "production": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "PO Number", "Cover Type", "Material", "SKU", "Units", "STP Required", "STP Status"],
      rows: models.filter((m) => m.stage === "production").flatMap((m) =>
        m.covers.map((c) => [m.brand, m.name, m.segment, m.launch, m.po || "",
          c.type, c.material || "MISSING", c.sku || "MISSING", c.units,
          (!c.material || !c.sku) ? "YES — fix data" : "YES", m.stpStatus || "Not Sent"])),
    };
    case "received": return {
      headers: ["Brand", "Model", "Segment", "Launch Date", "PO Number", "Cover Type", "SKU", "Planned Qty", "Received Qty", "Status"],
      rows: models.filter((m) => m.stage === "received").flatMap((m) =>
        m.covers.map((c) => [m.brand, m.name, m.segment, m.launch, m.po || "",
          c.type, c.sku || "", c.units, c.receivedQty ?? "—",
          c.receivedOk === true ? "Received" : c.receivedOk === false ? "Not received" : "Pending"])),
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
  const [phones, setPhones] = useState(SEED);
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
    return { ...p, stage: stageKey, done, po: p.po || (stageIndex(stageKey) >= stageIndex("ordered") ? "PO-" + String(100 + p.id) : null) };
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
  const updateSTP = (id, stpStatus) => {
    setPhones((list) => list.map((p) => p.id !== id ? p : { ...p, stpStatus }));
    say("STP status updated: " + stpStatus);
  };

  /* save goods receipt rows from ReceivedChecker */
  const saveReceipt = (id, receiptRows) => {
    setPhones((list) => list.map((p) => {
      if (p.id !== id) return p;
      const updated = p.covers.map((c) => {
        const r = receiptRows.find((rr) => rr.type === c.type);
        return r ? { ...c, receivedQty: r.received, receivedOk: r.ok } : c;
      });
      return { ...p, covers: updated };
    }));
    say("Receipt saved");
  };

  const resetAll = () => {
    /* spread into a new array — React compares references, so passing the
       same SEED constant a second time looks like "no change" and skips
       the re-render. A fresh copy always triggers the update.           */
    setPhones(SEED.map((p) => ({ ...p, covers: p.covers.map((c) => ({ ...c })) })));
    setOpenId(null);
    setAdding(false);
    setConfirmReset(false);
    say("All data reset to demo state");
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
              onClick={() => setConfirmReset(true)} title="Reset all data to demo state">
              Reset
            </button>
            <button className="btn" data-primary="1" onClick={() => setAdding(true)}>
              <Plus size={14} />Add phone
            </button>
          </div>
        </div>

        {view === "dashboard" && <Dashboard models={models} onOpen={setOpenId} />}
        {view === "board"     && <Board models={models} onOpen={setOpenId} onMove={moveTo} />}
        {view === "table"     && <Table models={models} onOpen={setOpenId} />}
        {view === "reports"   && <Reports models={models} />}
      </div>

      {open   && <Detail model={open} onClose={() => setOpenId(null)} onAdvance={advance} onGoBack={goBack} onResearchSave={saveResearch} onSKUSave={saveSKU} onSTPUpdate={updateSTP} onReceiptSave={saveReceipt} />}
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
            <div style={{ fontSize: 16, fontWeight: 640 }}>Reset all data?</div>
            <div style={{ fontSize: 13, color: "var(--dim)", lineHeight: 1.6 }}>
              This will delete every phone you've added and every edit you've made,
              and restore the 8 demo phones. There is no undo.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="btn" data-primary="1"
                style={{ background: "var(--bad)", borderColor: "var(--bad)" }}
                onClick={resetAll}>
                Yes, reset everything
              </button>
            </div>
          </div>
        </>
      )}
      {toast  && <div className="toast">{toast}</div>}
    </div>
  );
}
