/* Self-check for the master/child stage rules in src/App.jsx —
   `npm run check:stages`. No test runner: it prints a transcript of two
   models walking the pipeline, then PASS/FAIL per rule, and exits non-zero
   on the first failure. Companion to src/roles.selfcheck.mjs, which covers
   the pure helpers in rules.js.

   Why it bundles instead of importing: App.jsx is JSX and pulls in React,
   so Node cannot load it directly. esbuild (already here, under vite) turns
   it into plain ESM. Nothing in App.jsx runs at module load, so importing
   the bundle is side-effect free — `import.meta.env` is stubbed because the
   Supabase config reads it at the top level of the module.

   What it is actually for: the pipeline is the one place where two kinds of
   model walk different routes, and three separate functions have to agree
   about it — advanceStatus for the button, moveStatus for the rule, and
   releaseChildrenOf for the children that ride along. They disagreed once
   already (a child had no legal forward move and sat at Planned invisibly),
   and nothing would have caught it. */

import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root   = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.join(root, "node_modules", ".cache", "stages.selfcheck.mjs");

await build({
  entryPoints: [path.join(root, "src", "App.jsx")],
  outfile: bundle,
  bundle: true, format: "esm", platform: "browser", logLevel: "warning",
  /* App.jsx reads both at module scope; neither exists in Node. */
  define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
});

const {
  STAGES, MARKETPLACES, derive, nextStageOf, prevStageOf,
  releasesChildren, releaseChildrenOf, gateBlock, advanceStatus, moveStatus,
/* a Windows path is not a URL — import() needs file:///C:/... */
} = await import(pathToFileURL(bundle).href);

const LIVE = Object.fromEntries(MARKETPLACES.map((m) => [m, "Live"]));
const user = { id: 99, name: "self-check", role: "admin" };

/* Vivo V70 takes the same case as V70FE, so V70 is bought and V70FE is
   listed from its stock. The master's SKU is ordered, made and received for
   real; the child's SKU is a code and a mapping, with no quantity. */
const freshFleet = () => [
  { id: 1, brand: "Vivo", name: "V70", stage: "research", done: {}, po: "",
    skus: [{ rid: "a", sku: "CASE-V70-TPU", material: "TPU", units: 500,
             stpRequired: true, stpStatus: "Approved",
             receivedQty: 500, receiptState: "full", listings: { ...LIVE } }] },
  { id: 2, brand: "Vivo", name: "V70FE", stage: "research", done: {}, masterId: 1,
    skus: [{ rid: "x", sku: "CASE-V70FE-TPU", material: "TPU", masterRid: "a",
             listings: { ...LIVE } }] },
];

let fleet = freshFleet();
const D   = (id) => derive(fleet.find((p) => p.id === id), fleet);
const set = (id, patch) => { fleet = fleet.map((p) => p.id === id ? { ...p, ...patch } : p); };

const log = [];
let failed = 0;
function check(what, ok) {
  if (!ok) failed++;
  log.push(`  ${ok ? "PASS" : "FAIL"}  ${what}`);
}

/* One forward move, by the same three steps the board takes: ask what is
   next, check the rule agrees, apply it, then release any children if the
   stock has landed. The throw below is the point of driving it this way —
   advanceStatus offering a move that moveStatus refuses is the exact bug
   class this file exists to catch. */
function advance(id) {
  const m = D(id), st = advanceStatus(m, "admin");
  const tag = `${m.brand} ${m.name} @ ${m.stage}`;
  if (!st.ok) { log.push(`  held     ${tag}: ${st.reason}`); return false; }
  const rule = moveStatus(m, "admin", st.next.key);
  assert.ok(rule.ok,
    `advanceStatus offered ${tag} -> ${st.next.key} but moveStatus refused it: "${rule.reason}"`);
  set(id, { stage: st.next.key, done: { ...m.done, [st.next.key]: "2026-01-01" } });
  log.push(`  moved    ${tag} -> ${st.next.key}`);
  if (releasesChildren(st.next.key)) {
    const r = releaseChildrenOf(fleet, id, user);
    fleet = r.list;
    r.moved.forEach((c) => log.push(`  released ${c.brand} ${c.name} -> ${c.stage} (rode on the master)`));
  }
  return true;
}

/* ── RUN A — the master leads, the child is already mapped ──────── */
log.push("RUN A — master walks the pipeline, child already mapped:");
advance(1);                                   // research -> planned
advance(2);                                   // research -> planned

check("child at Planned is held while the master has no stock",
  !advanceStatus(D(2), "admin").ok);
check("child's one forward move from Planned is Received, not Ordered",
  nextStageOf(D(2))?.key === "received");
check("master's next move from Planned is still Ordered",
  nextStageOf(D(1))?.key === "ordered");

set(1, { po: "PO-7781" });                    // the Ordered gate wants a PO
advance(1);                                   // planned -> ordered
check("child does not ride on the master's Ordered move", D(2).stage === "planned");
advance(1);                                   // ordered -> production
check("child does not ride on Production either", D(2).stage === "planned");
advance(1);                                   // production -> received — releases

const kid = D(2);
check("child is released when the master's stock lands", kid.stage === "received");
check("child carries the master's Ordered date, so it is not scored late",
  kid.done.ordered === D(1).done.ordered);
check("child carries the master's Production date",
  kid.done.production === D(1).done.production);
check("child reports no planned units", kid.units === 0);
check("master still reports its own units", D(1).units === 500);
check("child can never be dropped on Ordered",
  !moveStatus(kid, "admin", "ordered").ok);
check("child can never be dropped on Production",
  !moveStatus(kid, "admin", "production").ok);
check("child steps back to Planned, not into a Production it never passed",
  prevStageOf(kid)?.key === "planned");
check("child's Received gate skips receipt confirmation", gateBlock(kid) === null);

advance(1); advance(2);                       // both -> live
check("master reaches Live", D(1).stage === "live");
check("child reaches Live on its own listing", D(2).stage === "live");
check("nothing after Live for either", !nextStageOf(D(1)) && !nextStageOf(D(2)));

/* ── RUN B — the late mapping ────────────────────────────────────
   Mapping a child the day after the stock lands is the normal way round,
   not an edge case: there is no master transition left for it to ride on,
   so the release has to happen on the child's own save. */
log.push("\nRUN B — child mapped the day AFTER the master's stock landed:");
fleet = freshFleet();
set(2, { skus: [{ rid: "x", sku: "CASE-V70FE-TPU", listings: { ...LIVE } }] });   // unmapped
advance(1); advance(2); set(1, { po: "PO-7781" });
advance(1); advance(1); advance(1);           // master through to Received

check("an unmapped child is left behind at Planned", D(2).stage === "planned");
check("and its card says why",
  /not mapped/.test(advanceStatus(D(2), "admin").reason || ""));

/* Catalog maps it. App.jsx's SKU save runs exactly this. */
set(2, { skus: [{ rid: "x", sku: "CASE-V70FE-TPU", masterRid: "a", listings: { ...LIVE } }] });
const master = fleet.find((p) => p.id === 1);
if (releasesChildren(master.stage)) fleet = releaseChildrenOf(fleet, 1, user).list;
check("mapping it later releases it on its own save", D(2).stage === "received");

/* A dangling mapping must not release — it would list stock it has no claim
   on, which is worse than the child being late to appear. */
fleet = freshFleet();
set(2, { skus: [{ rid: "x", sku: "CASE-V70FE-TPU", masterRid: "gone", listings: { ...LIVE } }] });
advance(1); advance(2); set(1, { po: "PO-7781" });
advance(1); advance(1); advance(1);
check("a child mapped to a SKU the master no longer has is not released",
  D(2).stage === "planned");

/* ── RUN C — the stage vocabulary the rules above assume ───────── */
const keys = STAGES.filter((s) => !s.terminal).map((s) => s.key);
assert.deepEqual(keys, ["research", "planned", "ordered", "production", "received", "live"],
  "the pipeline changed shape — the routes asserted above are stale, not wrong");

console.log(log.join("\n"));
if (failed) {
  console.error(`\n${failed} stage check${failed === 1 ? "" : "s"} FAILED`);
  process.exit(1);
}
console.log("\nstages.js OK — master and child both walk the full pipeline");
