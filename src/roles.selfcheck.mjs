/* Self-check for src/roles.js — `node src/roles.selfcheck.mjs`.
   No test runner, no dependency: it throws on the first failure and
   prints "roles.js OK" when every case passes. */

import assert from "node:assert/strict";
import {
  PERM_KEYS, DEFAULT_PERMS, DEFAULT_CAN, LOCKED_TO_ADMIN,
  buildCan, rolesFromRows, rolesToRows,
} from "./roles.js";

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

console.log("roles.js OK");
