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
  materialColumns, materialHeader,
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

console.log("roles.js OK");
