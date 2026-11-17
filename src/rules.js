/* ── PURE RULES ───────────────────────────────────────────────────
   The rules added by the Phase 1 audit remediation that are worth
   asserting, kept out of App.jsx so they can be exercised without
   React — same arrangement as roles.js, and the same self-check
   runs them (src/roles.selfcheck.mjs).

   Everything here is plain value in, plain value out.            */

/* ── AUD-006: spreadsheet formula injection ──────────────────────
   A spreadsheet runs a cell that opens with = + - @ or a control
   character as a formula, so a SKU typed as `=HYPERLINK(...)` or
   `=cmd|...` executes in whoever opens the export — including the MD
   and the factory, who receive the STP report by email.

   Prefixing an apostrophe is what Excel and Sheets both read as
   "this is text". Plain numbers are left alone so numeric columns
   still sum, which is why this tests the whole value rather than
   only its first character.                                      */
const FORMULA_LEAD = /^[=+\-@\t\r\u0000-\u001f]/;

export function exportCell(value) {
  const text = String(value ?? "");
  if (!FORMULA_LEAD.test(text)) return text;
  if (text.trim() !== "" && Number.isFinite(Number(text))) return text;   // -5, +3.2
  return "'" + text;
}

/* ── AUD-006: attachment URLs ────────────────────────────────────
   An attachment is rendered as a live link, so a stored
   `javascript:`, `data:` or `vbscript:` URL would run in the next
   reader's session. Only http(s) is a file link.

   `base` is passed in rather than read from `window` so this can be
   asserted outside a browser. Returns the resolved absolute URL, or
   null when the value is not a safe link.                        */
export function safeUrl(value, base) {
  const text = String(value ?? "").trim();
  /* `new URL("", base)` resolves to the base itself, so an empty or blank
     value would otherwise come back as a link to the app's own page. */
  if (!text) return null;
  try {
    const u = new URL(text, base);
    return (u.protocol === "http:" || u.protocol === "https:") ? u.href : null;
  } catch { return null; }
}

/* ── AUD-011: the last administrator ─────────────────────────────
   The only guard used to be "more than one user exists", which
   counts users, not admins. Demoting the last admin — or removing it
   while any other account existed — left nobody able to open the
   user dialog or the role matrix, because manageUsers and reset are
   locked to admin (LOCKED_TO_ADMIN in roles.js). There was no way
   back in through the application at all.                        */
export const adminIdsOf = (users) =>
  (users || []).filter((u) => u?.role === "admin").map((u) => u.id);

export const isLastAdmin = (users, id) => {
  const admins = adminIdsOf(users);
  return admins.length === 1 && admins[0] === id;
};

/* True when this edit would leave the account list with no admin. */
export const wouldStrandAdmins = (users, id, nextRole) =>
  nextRole !== "admin" && isLastAdmin(users, id);

/* ── AUD-013: which materials the STP matrix shows ───────────────
   The columns used to be the four materials hardcoded in the bundle,
   so a SKU whose material came from a bulk paste or a typo had no
   cell to decide it in — while the Reports tab and the emailed
   report both grouped by the material actually stored. The factory
   and the MD received a row nobody on screen could act on.

   `present` is every material string found on the SKUs in view, ""
   included: a SKU with no material is a real group that still needs
   deciding. Known materials keep their familiar order; anything else
   follows, sorted, so the column set is stable between renders.  */
export function materialColumns(present, known) {
  const extra = [...new Set(present || [])].filter((n) => !(known || []).includes(n)).sort();
  return [...(known || []), ...extra];
}

export const materialHeader = (mat) => mat || "(no material)";
