/* Self-check for src/roles.js and src/rules.js —
   `node src/roles.selfcheck.mjs`. No test runner, no dependency: it throws on
   the first failure and prints "roles.js OK" when every case passes. */

import assert from "node:assert/strict";
import {
  PERM_KEYS, DEFAULT_PERMS, DEFAULT_CAN, LOCKED_TO_ADMIN,
  buildCan, rolesFromRows, rolesToRows,
} from "./roles.js";
import {
  exportCell, safeUrl, adminIdsOf, isLastAdmin, wouldStrandAdmins,
  materialColumns, materialHeader, projectRef, isConfigOverride,
  isChildModel, childrenOf, isMasterModel, masterLinkProblem, eligibleMasters,
  childSkuMappingProblems, nextStageKey, prevStageKey, isReadyToRelease,
} from "./rules.js";

const STAGE_KEYS = ["research", "planned", "ordered", "production", "received", "live", "unprocured"];

/* ── the shipped defaults ── */
assert.equal(DEFAULT_CAN.addPhone("customer_care"), true, "Customer Care must be able to file a new model");
assert.equal(DEFAULT_CAN.saveListing("customer_care"), false, "Customer Care is read-only beyond adding");
assert.equal(DEFAULT_CAN.archive("customer_care"), false);
assert.equal(DEFAULT_CAN.manageUsers("customer_care"), false);
assert.equal(DEFAULT_CAN.logSales("sales"), true, "the Sales role kept its own permission");
assert.equal(DEFAULT_CAN.logSales("customer_care"), false, "Customer Care is not Sales");
PERM_KEYS.forEach((k) => assert.equal(DEFAULT_CAN[k]("admin"), true, `admin should hold ${k}`));
assert.equal(DEFAULT_CAN.addPhone("none"), false, "a signed-out visitor holds nothing");

/* ── rows -> app shape ── */
const rows = [
  { role: "customer_care", label: "Customer Care", color: "var(--role6)", sort: 5,
    can: { addPhone: true }, advance_to: [] },
  { role: "admin", label: "Admin", color: "var(--bad)", sort: 0,
    can: { addPhone: true, manageUsers: true, reset: true }, advance_to: ["research"] },
];
const live = rolesFromRows(rows, STAGE_KEYS);
assert.equal(live.roles[0].key, "admin", "rows are ordered by sort, not by arrival");
assert.deepEqual(live.advance.admin, STAGE_KEYS, "admin always gets every stage back");
assert.deepEqual(live.advance.customer_care, [], "Customer Care may not move work along");
assert.equal(buildCan(live.byPerm).addPhone("customer_care"), true);
assert.equal(buildCan(live.byPerm).savePO("customer_care"), false);

/* ── the lockout guards ── */
const stripped = rolesFromRows(
  [{ role: "admin", sort: 0, can: {}, advance_to: [] }], STAGE_KEYS);
LOCKED_TO_ADMIN.forEach((k) =>
  assert.equal(buildCan(stripped.byPerm)[k]("admin"), true,
    `admin keeps ${k} even when the row says otherwise`));
assert.equal(rolesFromRows([{ role: "sales", can: {} }], STAGE_KEYS), null,
  "rows with no admin are rejected so the caller falls back to the defaults");
assert.equal(rolesFromRows([], STAGE_KEYS), null);
assert.equal(rolesFromRows(null, STAGE_KEYS), null, "a missing table is not a crash");

/* ── malformed rows are survivable ── */
const messy = rolesFromRows(
  [{ role: "admin", can: {}, advance_to: "not-an-array" }, null, { label: "no role key" }],
  STAGE_KEYS);
assert.deepEqual(messy.roles.map((r) => r.key), ["admin"], "junk rows are dropped, not rendered");

/* ── round trip: app shape -> rows -> app shape ── */
const roles = [
  { key: "admin", label: "Admin", color: "var(--bad)" },
  { key: "catalog", label: "Catalog", color: "var(--ok)" },
];
const advance = { admin: STAGE_KEYS, catalog: ["production", "received", "live"] };
const back = rolesFromRows(rolesToRows(roles, DEFAULT_PERMS, advance), STAGE_KEYS);
assert.deepEqual(back.roles.map((r) => r.key), ["admin", "catalog"]);
assert.deepEqual(back.advance.catalog, ["production", "received", "live"]);
assert.equal(buildCan(back.byPerm).saveReceipt("catalog"), true);
assert.equal(buildCan(back.byPerm).savePO("catalog"), false);

/* ══ src/rules.js — the Phase 1 audit fixes ══════════════════════════════ */

/* ── AUD-006: spreadsheet formula injection ── */
assert.equal(exportCell("Clear Case"), "Clear Case", "ordinary text is untouched");
assert.equal(exportCell("=HYPERLINK(\"http://evil\",\"Invoice\")"),
  "'=HYPERLINK(\"http://evil\",\"Invoice\")", "a formula is defused, not dropped");
assert.equal(exportCell("+41 22 000"), "'+41 22 000", "a leading + is a formula to Excel");
assert.equal(exportCell("@SUM(A1:A9)"), "'@SUM(A1:A9)");
assert.equal(exportCell("-cmd|' /c calc'!A1"), "'-cmd|' /c calc'!A1",
  "the DDE payload opens with a minus and is not a number");
assert.equal(exportCell("\tLeading tab"), "'\tLeading tab", "a leading tab is a control character");
assert.equal(exportCell("\u0000null byte"), "'\u0000null byte");
assert.equal(exportCell("-5"), "-5", "a negative number must still sum in the sheet");
assert.equal(exportCell("+3.25"), "+3.25", "so must a signed decimal");
assert.equal(exportCell("-0"), "-0");
assert.equal(exportCell(0), "0", "a number arrives as a number, not a string");
assert.equal(exportCell(null), "", "null and undefined are empty cells, never \"null\"");
assert.equal(exportCell(undefined), "");
assert.equal(exportCell(""), "");
assert.equal(exportCell("a=b"), "a=b", "only the FIRST character matters");

/* ── AUD-006: attachment URL schemes ── */
const PAGE = "https://example.test/app/";
assert.equal(safeUrl("https://drive.example/f/1", PAGE), "https://drive.example/f/1");
assert.equal(safeUrl("http://intranet/po.pdf", PAGE), "http://intranet/po.pdf");
assert.equal(safeUrl("javascript:alert(1)", PAGE), null, "script URLs are not file links");
assert.equal(safeUrl("JaVaScRiPt:alert(1)", PAGE), null, "and the scheme is case-insensitive");
assert.equal(safeUrl("data:text/html,<script>x</script>", PAGE), null);
assert.equal(safeUrl("vbscript:msgbox", PAGE), null);
assert.equal(safeUrl("file:///C:/secrets.txt", PAGE), null);
assert.equal(safeUrl("", PAGE), null, "an empty value is not a link");
assert.equal(safeUrl(null, PAGE), null);
assert.equal(safeUrl("   ", PAGE), null);
assert.equal(safeUrl("notes.pdf", PAGE), "https://example.test/app/notes.pdf",
  "a relative link resolves against the page and stays http(s)");

/* ── AUD-011: the last administrator ── */
const TEAM = [
  { id: "u1", role: "admin" },
  { id: "u2", role: "procurement" },
  { id: "u3", role: "catalog" },
];
const TWO_ADMINS = [...TEAM, { id: "u4", role: "admin" }];

assert.deepEqual(adminIdsOf(TEAM), ["u1"]);
assert.deepEqual(adminIdsOf([]), []);
assert.deepEqual(adminIdsOf(null), [], "a list that has not loaded yet is not a crash");

assert.equal(isLastAdmin(TEAM, "u1"), true, "u1 is the only admin");
assert.equal(isLastAdmin(TEAM, "u2"), false, "a non-admin is never the last admin");
assert.equal(isLastAdmin(TWO_ADMINS, "u1"), false, "with a second admin, u1 is expendable");
assert.equal(isLastAdmin([], "u1"), false);

assert.equal(wouldStrandAdmins(TEAM, "u1", "procurement"), true,
  "demoting the only admin must be refused");
assert.equal(wouldStrandAdmins(TEAM, "u1", "admin"), false,
  "renaming the only admin, keeping the role, is fine");
assert.equal(wouldStrandAdmins(TWO_ADMINS, "u1", "sales"), false,
  "demoting one of two admins is fine");
assert.equal(wouldStrandAdmins(TEAM, "u2", "admin"), false,
  "promoting somebody never strands anyone");
assert.equal(wouldStrandAdmins(TEAM, "u2", "sales"), false,
  "and neither does re-roling a non-admin");
/* The old guard was `list.length <= 1`. This is the case it waved through. */
assert.equal(wouldStrandAdmins(TEAM, "u1", "sales"), true,
  "three users, one admin: the old user-count guard allowed this");

/* ── AUD-013: which materials the STP matrix shows ── */
const KNOWN = ["TPU+PC", "Silicone Cover", "TPU+PC+MSF", "Silicone MagSafe"];
assert.deepEqual(materialColumns(["TPU+PC", "TPU+PC"], KNOWN), KNOWN,
  "the known four always show, in their own order, even when unused");
assert.deepEqual(materialColumns(["Leather Flip", "TPU+PC"], KNOWN),
  [...KNOWN, "Leather Flip"], "an off-list material gets a column of its own");
assert.deepEqual(materialColumns(["Zebra", "Aramid"], KNOWN),
  [...KNOWN, "Aramid", "Zebra"], "extras are sorted, so the column set is stable");
assert.deepEqual(materialColumns(["Aramid", "Aramid"], KNOWN),
  [...KNOWN, "Aramid"], "and de-duplicated");
assert.deepEqual(materialColumns([""], KNOWN), [...KNOWN, ""],
  "a SKU with no material is a real column: it still needs deciding");
assert.deepEqual(materialColumns([], KNOWN), KNOWN);
assert.deepEqual(materialColumns(null, KNOWN), KNOWN, "no SKUs in view is not a crash");
assert.equal(materialHeader(""), "(no material)");
assert.equal(materialHeader("TPU+PC"), "TPU+PC");

/* ── which Supabase project this browser is pointed at ── */
assert.equal(projectRef("https://abcdefgh.supabase.co"), "abcdefgh");
assert.equal(projectRef("https://abcdefgh.supabase.co/"), "abcdefgh");
assert.equal(projectRef("https://abcdefgh.supabase.co/rest/v1/phones"), "abcdefgh",
  "a URL carrying a path still names its project");
assert.equal(projectRef("http://localhost:54321"), "localhost",
  "a local Supabase stack has no project ref, but must not crash");
assert.equal(projectRef(""), "", "and neither an empty value");
assert.equal(projectRef(null), "");
assert.equal(projectRef("not a url"), "", "nor junk");

const ENV = { url: "https://live.supabase.co", key: "live-key" };
assert.equal(isConfigOverride({ url: "https://test.supabase.co", key: "test-key" }, ENV), true,
  "a different project is an override");
assert.equal(isConfigOverride({ url: ENV.url, key: ENV.key }, ENV), false,
  "the same project and key is not");
assert.equal(isConfigOverride({ url: ENV.url, key: "rotated-key" }, ENV), true,
  "same project, different key: still an override");
assert.equal(isConfigOverride(null, ENV), false, "nothing saved is not an override");
assert.equal(isConfigOverride({}, ENV), false);
assert.equal(isConfigOverride({ url: "https://test.supabase.co" }, ENV), false,
  "half a config cannot connect, so it is not an override");
assert.equal(isConfigOverride({ key: "test-key" }, ENV), false);
/* With no build-time config, anything saved IS the connection — and the
   header must not then cry "override" at the only config there is... but it
   must still report one, because there is nothing to fall back to. The caller
   gates on dbHasEnvConfig() for the "back to built-in" button; this stays
   truthful about the comparison. */
assert.equal(isConfigOverride({ url: "https://test.supabase.co", key: "k" }, { url: "", key: "" }), true);

/* ── master / child models ──
   Vivo V70 and V70FE are the same handset: one case fits both, so V70 is
   ordered and V70FE rides on its stock. */
const V70   = { id: 1, brand: "Vivo", name: "V70",    masterId: null };
const V70FE = { id: 2, brand: "Vivo", name: "V70FE",  masterId: 1 };
const V70PRO= { id: 3, brand: "Vivo", name: "V70 Pro", masterId: 1 };
const R13C  = { id: 4, brand: "Redmi", name: "13C",   masterId: null };
const FLEET = [V70, V70FE, V70PRO, R13C];

assert.equal(isChildModel(V70FE), true);
assert.equal(isChildModel(V70), false, "a master is not a child");
assert.equal(isChildModel(R13C), false, "nor is an unlinked model");
assert.equal(isChildModel({ id: 9 }), false, "a model with no masterId key at all");
assert.equal(isChildModel(null), false);

assert.deepEqual(childrenOf(1, FLEET).map((m) => m.name), ["V70FE", "V70 Pro"],
  "three handsets sharing one case all point at the one master");
assert.deepEqual(childrenOf(4, FLEET), [], "a model with no children");
assert.deepEqual(childrenOf(1, null), [], "no fleet loaded yet is not a crash");

assert.equal(isMasterModel(V70, FLEET), true);
assert.equal(isMasterModel(R13C, FLEET), false);
assert.equal(isMasterModel(V70FE, FLEET), false, "a child has no children of its own");
assert.equal(isMasterModel(null, FLEET), false);

/* the structural rules */
assert.equal(masterLinkProblem(R13C, V70, FLEET), null,
  "an unlinked model may take an unlinked master");
assert.equal(masterLinkProblem(V70, V70, FLEET), "A model cannot be its own master");
assert.match(masterLinkProblem(R13C, V70FE, FLEET), /itself a child/,
  "no chains: a child cannot be somebody's master");
assert.match(masterLinkProblem(V70, R13C, FLEET), /already has children/,
  "a master cannot become a child while it has children");
assert.equal(masterLinkProblem(R13C, null, FLEET), "No master chosen");
assert.equal(masterLinkProblem(null, V70, FLEET), "No model");
/* Re-pointing an existing child at a different master is allowed: the only
   objection would be the chain rule, and V70 is not a child. */
assert.equal(masterLinkProblem(V70FE, R13C, FLEET), null);

assert.deepEqual(eligibleMasters(R13C, FLEET).map((m) => m.name), ["V70"],
  "V70FE and V70 Pro are children, R13C is itself — only V70 is offerable");
assert.deepEqual(eligibleMasters(V70, FLEET), [],
  "a model with children has nothing it may be a child of");

/* child SKU -> master SKU mapping, the Planned gate's subject */
const MASTER_RIDS = ["a", "b"];
assert.deepEqual(childSkuMappingProblems([{ rid: "x", masterRid: "a" }], MASTER_RIDS), [],
  "a mapped child SKU is fine");
assert.deepEqual(
  childSkuMappingProblems([{ rid: "x", masterRid: "a" }, { rid: "y", masterRid: "b" }], MASTER_RIDS),
  [], "several, each mapped");
assert.equal(childSkuMappingProblems([{ rid: "x" }], MASTER_RIDS).length, 1,
  "an unmapped child SKU is a problem");
assert.match(childSkuMappingProblems([{ rid: "x" }], MASTER_RIDS)[0].reason, /not mapped/);
assert.match(childSkuMappingProblems([{ rid: "x", masterRid: "zz" }], MASTER_RIDS)[0].reason,
  /no longer has/, "a dangling mapping is caught, not silently treated as mapped");
assert.equal(childSkuMappingProblems([{ rid: "x", masterRid: null }], MASTER_RIDS).length, 1,
  "an explicit null is still unmapped");
assert.deepEqual(childSkuMappingProblems([], MASTER_RIDS), [],
  "no child SKUs is not a mapping problem — the empty-list check belongs to the gate");
assert.deepEqual(childSkuMappingProblems(null, MASTER_RIDS), []);
assert.equal(childSkuMappingProblems([{ rid: "x", masterRid: "a" }], []).length, 1,
  "a master with no SKUs at all cannot satisfy any mapping");

/* ── which stage a model may move to next ──
   The bug this guards: advance() knew a child skips Ordered and Production,
   moveStatus did not, and its "forward moves must be a single step" rule then
   refused the jump. A linked child had no legal forward move at all and sat
   at Planned, invisible, never reaching the listing queue. */
const ORDER = ["research", "planned", "ordered", "production", "received", "live"];
const SKIP  = { from: "planned", to: "received" };

/* an ordinary model walks the pipeline one stage at a time */
assert.equal(nextStageKey("research", false, ORDER, SKIP), "planned");
assert.equal(nextStageKey("planned", false, ORDER, SKIP), "ordered");
assert.equal(nextStageKey("ordered", false, ORDER, SKIP), "production");
assert.equal(nextStageKey("production", false, ORDER, SKIP), "received");
assert.equal(nextStageKey("received", false, ORDER, SKIP), "live");
assert.equal(nextStageKey("live", false, ORDER, SKIP), null, "nothing after Live");

/* a child skips Ordered and Production — the master is ordered, once */
assert.equal(nextStageKey("planned", true, ORDER, SKIP), "received",
  "THE bug: a child at Planned goes straight to Received");
assert.equal(nextStageKey("research", true, ORDER, SKIP), "planned",
  "the skip starts at Planned, not before it");
assert.equal(nextStageKey("received", true, ORDER, SKIP), "live",
  "after the skip a child behaves normally — listing is its own job");
assert.equal(nextStageKey("live", true, ORDER, SKIP), null);

/* and back again, mirrored, so stepping back does not land in Production */
assert.equal(prevStageKey("received", true, ORDER, SKIP), "planned",
  "a child steps back to Planned, not into a Production it never passed");
assert.equal(prevStageKey("received", false, ORDER, SKIP), "production");
assert.equal(prevStageKey("planned", false, ORDER, SKIP), "research");
assert.equal(prevStageKey("planned", true, ORDER, SKIP), "research");
assert.equal(prevStageKey("research", false, ORDER, SKIP), null, "nothing before Research");
assert.equal(prevStageKey("live", true, ORDER, SKIP), "received");

/* junk and edges */
assert.equal(nextStageKey("unprocured", false, ORDER, SKIP), null,
  "a terminal stage is not in the pipeline");
assert.equal(nextStageKey("nonsense", true, ORDER, SKIP), null);
assert.equal(nextStageKey("planned", true, ORDER, null), "ordered",
  "no skip configured means no skip");
assert.equal(nextStageKey("planned", true, [], SKIP), null);
assert.equal(nextStageKey("planned", true, null, SKIP), null);
assert.equal(nextStageKey("planned", true, ORDER, { from: "planned", to: "nowhere" }), null,
  "a skip naming a stage that does not exist is refused, not guessed");

/* The two must agree, or a model can be advanced into a stage it cannot
   leave — walk the whole pipeline both ways for both kinds of model. */
[false, true].forEach((kid) => {
  let k = "research";
  const seen = [k];
  while (nextStageKey(k, kid, ORDER, SKIP)) { k = nextStageKey(k, kid, ORDER, SKIP); seen.push(k); }
  assert.equal(k, "live", `a ${kid ? "child" : "model"} can always reach Live`);
  while (prevStageKey(k, kid, ORDER, SKIP)) { k = prevStageKey(k, kid, ORDER, SKIP); }
  assert.equal(k, "research", `a ${kid ? "child" : "model"} can always walk back to Research`);
  assert.deepEqual(seen, kid
    ? ["research", "planned", "received", "live"]
    : ORDER, "the route a model takes through the pipeline");
});

/* ── which children follow the master when its stock lands ──
   A child is not separate work. When V70's stock arrives, a ready V70FE goes
   with it; an unmapped one does not, because it would be offering stock it
   has no claim on. */
const MRIDS = ["a", "b"];
const ready = { masterId: 1, stage: "planned", skus: [{ rid: "x", masterRid: "a" }] };

assert.equal(isReadyToRelease(ready, MRIDS), true);
assert.equal(isReadyToRelease({ ...ready, skus: [{ rid: "x" }] }, MRIDS), false,
  "an unmapped SKU holds the whole child back");
assert.equal(isReadyToRelease({ ...ready, skus: [
  { rid: "x", masterRid: "a" }, { rid: "y" }] }, MRIDS), false,
  "one unmapped SKU among several is still not ready");
assert.equal(isReadyToRelease({ ...ready, skus: [{ rid: "x", masterRid: "zz" }] }, MRIDS), false,
  "a mapping into a SKU the master no longer has is not ready");
assert.equal(isReadyToRelease({ ...ready, skus: [] }, MRIDS), false,
  "a child with no SKUs has nothing to list");
assert.equal(isReadyToRelease({ ...ready, stage: "received" }, MRIDS), false,
  "already released — moving it again would re-stamp its timeline");
assert.equal(isReadyToRelease({ ...ready, stage: "live" }, MRIDS), false);
assert.equal(isReadyToRelease({ ...ready, stage: "unprocured" }, MRIDS), false,
  "a model taken out of procurement is not dragged back in by its master");
assert.equal(isReadyToRelease({ ...ready, masterId: null }, MRIDS), false,
  "a model with no master is nobody's child");
assert.equal(isReadyToRelease(null, MRIDS), false);
assert.equal(isReadyToRelease(ready, []), false,
  "a master with no SKUs cannot release anything");

console.log("roles.js OK");
