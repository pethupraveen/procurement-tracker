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

/* ── Which Supabase project is this browser pointed at? ──────────
   The app takes its connection from the build (VITE_SUPABASE_URL /
   VITE_SUPABASE_ANON_KEY) unless a config saved in this browser
   overrides it, and the saved one always wins. That override is how
   one machine is pointed at a test project while everything else
   uses the shipped one — and the mistake it exists to prevent is
   running a destructive test against live data without noticing,
   so the app has to be able to say which is in force.           */

/* The project ref: the subdomain of a Supabase URL. Enough to tell
   two projects apart on screen, and it is not a credential. */
export function projectRef(url) {
  try { return new URL(String(url ?? "")).hostname.split(".")[0]; }
  catch { return ""; }
}

/* Is `saved` pointing somewhere other than `env`? A saved config
   missing either half is not a usable override, so it is not one. */
export function isConfigOverride(saved, env) {
  if (!saved?.url || !saved?.key) return false;
  return saved.url !== env?.url || saved.key !== env?.key;
}

/* ── MASTER / CHILD MODELS ───────────────────────────────────────
   Two phones can be the same handset under different names — Vivo
   V70 and V70FE take an identical case. Ordering a case for each
   would buy the same stock twice, so one model is the MASTER and
   the other is its CHILD:

     • the master is ordered, produced and received, once;
     • the child is never ordered and never receives goods;
     • both must be listed and tracked on every marketplace,
       because each needs its own listing;
     • the child's stock is the master's stock.

   The link is `masterId` on the child, holding the master's id.
   One level only: a child can never itself be a master. That keeps
   every rule here a single lookup instead of a graph walk, and
   there is no real case for a chain — if three handsets share a
   case, all three children point at one master.          */

export const isChildModel = (model) => model?.masterId != null;

export const childrenOf = (id, all) =>
  (all || []).filter((m) => m?.masterId != null && m.masterId === id);

export const isMasterModel = (model, all) =>
  !!model && childrenOf(model.id, all).length > 0;

/* Why `candidate` cannot be the master of `model`, or null if it can.
   Structural rules only — whether a candidate is archived or out of
   procurement is the picker's business, since those depend on stage
   vocabulary this module deliberately does not know. */
export function masterLinkProblem(model, candidate, all) {
  if (!model) return "No model";
  if (!candidate) return "No master chosen";
  if (candidate.id === model.id) return "A model cannot be its own master";
  if (isChildModel(candidate))
    return `${candidate.brand} ${candidate.name} is itself a child — a master cannot be a child`;
  if (isMasterModel(model, all))
    return `${model.brand} ${model.name} already has children of its own, so it cannot become a child`;
  return null;
}

/* Which models may be offered as a master for this one. */
export const eligibleMasters = (model, all) =>
  (all || []).filter((m) => !masterLinkProblem(model, m, all));

/* Every child SKU names the master SKU whose stock it sells, through
   `masterRid`. An unmapped or dangling child SKU is what the Planned
   gate refuses to let past: without it there is nothing to draw the
   child's stock from, and the listing would sell air.

   `masterRids` is the set of rids on the master. Returns the child
   SKU rows that are not correctly mapped, with a reason each. */
export function childSkuMappingProblems(childSkus, masterRids) {
  const known = new Set(masterRids || []);
  const out = [];
  (childSkus || []).forEach((r) => {
    if (r?.masterRid == null) out.push({ sku: r, reason: "not mapped to a master SKU" });
    else if (!known.has(r.masterRid)) out.push({ sku: r, reason: "mapped to a SKU the master no longer has" });
  });
  return out;
}

/* ── Which stage a model may move to next ─────────────────────────
   A child skips the stages between Planned and the point its master
   releases stock: it is never ordered and never produced. Every
   forward check has to agree on that, or the board offers a move the
   gate then refuses — which is exactly what happened: advance() knew
   about the skip and moveStatus did not, so a linked child had NO
   legal forward move and sat at Planned invisibly.

   `order` is the ordered list of non-terminal stage keys. `skip` is
   { from, to }: the stage a child leaves and the one it lands on. */

export function nextStageKey(stageKey, isChild, order, skip) {
  const keys = order || [];
  const i = keys.indexOf(stageKey);
  if (i < 0) return null;
  if (isChild && skip && stageKey === skip.from)
    return keys.includes(skip.to) ? skip.to : null;
  return keys[i + 1] ?? null;
}

export function prevStageKey(stageKey, isChild, order, skip) {
  const keys = order || [];
  const i = keys.indexOf(stageKey);
  if (i <= 0) return null;
  if (isChild && skip && stageKey === skip.to)
    return keys.includes(skip.from) ? skip.from : null;
  return keys[i - 1];
}

/* Is this child ready to be released with its master's stock?

   Called when a master reaches the stage that holds stock. A child that is
   ready moves with it; one that is not stays at Planned and keeps saying why
   on its card. An unmapped child in the listing queue would be offering
   stock it has no claim on, which is worse than it being late to appear. */
export function isReadyToRelease(child, masterRids, plannedKey) {
  if (!child || child.masterId == null) return false;
  if (child.stage !== (plannedKey || "planned")) return false;
  const rows = child.skus || [];
  if (!rows.length) return false;
  return childSkuMappingProblems(rows, masterRids).length === 0;
}

/* ── launch dates out of a spreadsheet ───────────────────────────
   The import box took YYYY-MM-DD and DD/MM/YYYY only, but Excel
   shows a real date cell as `16-Apr-25` and writes exactly that to
   CSV, so a file filled in from our own template came back with
   every row rejected as a bad date.

   Returns "" for anything it cannot read, which is what the caller
   reports as an error. Day and month are range-checked but not
   calendar-checked: 31-Feb-25 still passes, same as the DD/MM/YYYY
   branch always did.

   The two-digit year follows Excel's own rule — 00-29 is 2000s,
   30-99 is 1900s — because that is what the person saw in the cell
   they typed it into. */
const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

export function parseLaunchDate(value) {
  const text = String(value ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return inRange(iso[1], iso[2], iso[3]);

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (slash) return inRange(slash[3], slash[2], slash[1]);

  /* 16-Apr-25, 16-Apr-2025, and the same with a space or a slash */
  const named = /^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2}|\d{4})$/.exec(text);
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    if (!month) return "";
    const yy = named[3];
    const year = yy.length === 4 ? yy : Number(yy) <= 29 ? `20${yy}` : `19${yy}`;
    return inRange(year, month, named[1]);
  }
  return "";
}

function inRange(y, m, d) {
  const month = Number(m), day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
