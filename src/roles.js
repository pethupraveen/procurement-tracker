/* ── ROLE PERMISSIONS ────────────────────────────────────────────
   The pure half of the permission system: what the keys are, what the
   defaults are, and how to convert between the role_permissions rows
   and the shape the app reads.

   Kept out of App.jsx so it can be exercised without React — see
   roles.selfcheck.mjs next to this file. Everything here is a plain
   value in, plain value out; the mutable module tables (ROLES,
   ROLE_CAN_ADVANCE_TO) and the React wiring stay in App.jsx.      */

/* Permission keys, in the order the Admin matrix lists them. */
export const PERM_KEYS = [
  "addPhone", "archive", "editResearch", "editSKUs", "savePO", "updateSTP",
  "setStpRequired", "saveReceipt", "saveListing", "logSales", "manageUsers", "reset",
];

/* Short labels for the Admin matrix header. */
export const PERM_LABELS = {
  addPhone: "Add phone", archive: "Archive", editResearch: "Edit research",
  editSKUs: "Edit SKUs", savePO: "Save PO", updateSTP: "STP status",
  setStpRequired: "STP required", saveReceipt: "Goods receipt",
  saveListing: "Listings", logSales: "Log sales",
  manageUsers: "Manage users", reset: "DB / reset",
};

/* Which roles hold each permission out of the box. The role_permissions table
   overrides this once it loads; this stays as the offline fallback, so the app
   still works against a database that has not run schema-roles.sql.

   Catalog may create the initial phone record through either the manual form or
   the CSV importer; downstream procurement steps keep their own permissions.
   updateSTP and setStpRequired are deliberately two jobs, not one: Warehouse
   chases the file with the factory, Catalog decides whether one is owed at all.
   Customer Care only files new models — everything else is read-only.       */
export const DEFAULT_PERMS = {
  addPhone:       ["admin", "procurement", "catalog", "customer_care"],
  archive:        ["admin", "procurement"],
  editResearch:   ["admin", "procurement"],
  editSKUs:       ["admin", "procurement"],
  savePO:         ["admin", "procurement"],
  updateSTP:      ["admin", "warehouse"],
  setStpRequired: ["admin", "catalog"],
  saveReceipt:    ["admin", "catalog"],
  saveListing:    ["admin", "catalog"],
  logSales:       ["admin", "sales"],
  manageUsers:    ["admin"],
  reset:          ["admin"],
};

/* Admin must never be able to lock itself out, however the matrix is edited. */
export const LOCKED_TO_ADMIN = ["manageUsers", "reset"];

/* { addPhone: (role) => bool, ... } — the shape all 20 call sites expect. */
export const buildCan = (byPerm) => Object.fromEntries(
  PERM_KEYS.map((k) => [k, (r) => (byPerm[k] || []).includes(r)])
);

export const DEFAULT_CAN = buildCan(DEFAULT_PERMS);

/* role_permissions rows -> the three tables the app reads. Admin is forced to
   keep every stage and the two lockout-prone permissions whatever the rows say,
   so a bad edit (or a hand-written row) can never shut everyone out of the
   Admin screen. Rows without an admin role at all are rejected outright —
   the caller then falls back to DEFAULT_PERMS rather than trust them. */
export function rolesFromRows(rows, stageKeys) {
  const byPerm = Object.fromEntries(PERM_KEYS.map((k) => [k, []]));
  const advance = {};
  const roles = [];
  [...(rows || [])].sort((a, b) => (a?.sort || 0) - (b?.sort || 0)).forEach((row) => {
    if (!row?.role) return;
    roles.push({ key: row.role, label: row.label || row.role, color: row.color || "var(--dim)" });
    advance[row.role] = Array.isArray(row.advance_to) ? row.advance_to : [];
    PERM_KEYS.forEach((k) => { if (row.can?.[k]) byPerm[k].push(row.role); });
  });
  if (!roles.some((r) => r.key === "admin")) return null;
  advance.admin = [...stageKeys];
  LOCKED_TO_ADMIN.forEach((k) => { if (!byPerm[k].includes("admin")) byPerm[k].push("admin"); });
  return { byPerm, advance, roles };
}

/* The app shape -> role_permissions rows, for seeding and for matrix saves. */
export const rolesToRows = (roles, byPerm, advance) => roles.map((r, i) => ({
  role: r.key, label: r.label, color: r.color, sort: i,
  can: Object.fromEntries(PERM_KEYS.map((k) => [k, (byPerm[k] || []).includes(r.key)])),
  advance_to: advance[r.key] || [],
}));
