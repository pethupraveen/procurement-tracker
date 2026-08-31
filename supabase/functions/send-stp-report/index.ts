/* Sends the STP requirement report to MD / the factory team.
 *
 * This function is the authorization boundary for outbound report email. It
 * verifies a caller's Supabase Auth token, then reads the caller's `profiles`
 * row with its server-only service-role credential. Only `role = 'admin'`
 * reaches the report body or the Resend API.
 *
 * Deploy:
 *   supabase secrets set RESEND_API_KEY=re_xxx REPORT_FROM="Procurement <noreply@yourdomain.com>" APP_ORIGIN="https://pethupraveen.github.io"
 *   supabase functions deploy send-stp-report
 *
 * Required custom secrets:
 *   RESEND_API_KEY  Resend API key
 *   REPORT_FROM     address on a domain verified in Resend
 *   APP_ORIGIN      exact browser origin allowed to call this function
 *
 * Supabase provides SUPABASE_URL, SUPABASE_ANON_KEY, and
 * SUPABASE_SERVICE_ROLE_KEY to Edge Functions. Never put the service-role key
 * (or the Resend key) in the browser or in a GitHub Actions secret.
 */

const MAX_BODY_BYTES = 256_000;
const MAX_RECIPIENTS = 25;
const MAX_REPORT_ROWS = 500;
const MAX_COLUMNS = 25;
const MAX_EMAIL_LENGTH = 254;
const MAX_HEADER_LENGTH = 100;
const MAX_CELL_LENGTH = 500;
const MAX_SUBJECT_LENGTH = 160;
const MAX_INTRO_LENGTH = 2_000;

const DEFAULT_SUBJECT = "STP requirement report";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ReportCell = string | number | boolean | null;
type Report = {
  to: string[];
  subject: string;
  intro: string;
  headers: string[];
  rows: ReportCell[][];
};

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>\"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

function corsHeaders(req: Request, appOrigin: string | null): HeadersInit {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    ...(origin && appOrigin && origin === appOrigin
      ? { "Access-Control-Allow-Origin": appOrigin }
      : {}),
  };
}

function response(req: Request, appOrigin: string | null, body: string, status = 200, json = false) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders(req, appOrigin),
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReportCell(value: unknown): value is ReportCell {
  return value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
}

function validateReport(value: unknown): { report?: Report; error?: string } {
  if (!isRecord(value)) return { error: "Body must be a JSON object" };

  if (!Array.isArray(value.to) || !value.to.length)
    return { error: "At least one recipient is required" };
  if (value.to.length > MAX_RECIPIENTS)
    return { error: `At most ${MAX_RECIPIENTS} recipients are allowed` };
  if (!value.to.every((email) => typeof email === "string"))
    return { error: "Recipients must be email addresses" };

  const to = value.to.map((email) => email.trim());
  if (to.some((email) => !email || email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)))
    return { error: "Each recipient must be a valid email address" };
  if (new Set(to.map((email) => email.toLowerCase())).size !== to.length)
    return { error: "Recipients must be unique" };

  const subject = value.subject === undefined ? DEFAULT_SUBJECT : value.subject;
  if (typeof subject !== "string" || !subject.trim() || subject.length > MAX_SUBJECT_LENGTH)
    return { error: `Subject must be 1 to ${MAX_SUBJECT_LENGTH} characters` };

  const intro = value.intro === undefined ? "" : value.intro;
  if (typeof intro !== "string" || intro.length > MAX_INTRO_LENGTH)
    return { error: `Intro must be at most ${MAX_INTRO_LENGTH} characters` };

  if (!Array.isArray(value.headers) || !value.headers.length)
    return { error: "At least one report column is required" };
  if (value.headers.length > MAX_COLUMNS)
    return { error: `At most ${MAX_COLUMNS} report columns are allowed` };
  if (!value.headers.every((header) => typeof header === "string" && header.trim() && header.length <= MAX_HEADER_LENGTH))
    return { error: `Each report column must be 1 to ${MAX_HEADER_LENGTH} characters` };

  if (!Array.isArray(value.rows) || !value.rows.length)
    return { error: "At least one report row is required" };
  if (value.rows.length > MAX_REPORT_ROWS)
    return { error: `At most ${MAX_REPORT_ROWS} report rows are allowed` };

  const rows: ReportCell[][] = [];
  for (const row of value.rows) {
    if (!Array.isArray(row) || row.length !== value.headers.length)
      return { error: "Every report row must match the report columns" };
    if (!row.every(isReportCell) || row.some((cell) => String(cell ?? "").length > MAX_CELL_LENGTH))
      return { error: `Report cells must be primitive values up to ${MAX_CELL_LENGTH} characters` };
    rows.push(row);
  }

  return {
    report: {
      to,
      subject: subject.trim(),
      intro,
      headers: value.headers.map((header) => header.trim()),
      rows,
    },
  };
}

/* The report is a table; send it as one rather than as pasted text, so it is
   readable on a phone without horizontal scrolling gymnastics. */
function renderTable(headers: string[], rows: ReportCell[][]) {
  const th = headers.map((h) =>
    `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ddd;font-size:12px">${esc(h)}</th>`).join("");
  const tr = rows.map((row, i) =>
    `<tr style="background:${i % 2 ? "#fafafa" : "#fff"}">` +
    row.map((cell) =>
      `<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px">${esc(cell)}</td>`).join("") +
    "</tr>").join("");
  return `<table style="border-collapse:collapse;width:100%;font-family:system-ui,sans-serif">
    <thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

function toCsv(headers: string[], rows: ReportCell[][]) {
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
}

async function getAuthUser(supabaseUrl: string, anonKey: string, authorization: string) {
  try {
    const result = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authorization },
    });
    if (result.status === 401 || result.status === 403) return { unauthorized: true };
    if (!result.ok) return { unavailable: true };
    const user = await result.json();
    return isRecord(user) && typeof user.id === "string" ? { id: user.id } : { unauthorized: true };
  } catch {
    return { unavailable: true };
  }
}

async function isAdmin(supabaseUrl: string, serviceRoleKey: string, userId: string) {
  try {
    const result = await fetch(
      `${supabaseUrl}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(userId)}&limit=2`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      },
    );
    if (!result.ok) return { unavailable: true };
    const profiles = await result.json();
    if (!Array.isArray(profiles) || profiles.length !== 1 || !isRecord(profiles[0]))
      return { admin: false };
    return { admin: profiles[0].role === "admin" };
  } catch {
    return { unavailable: true };
  }
}

Deno.serve(async (req: Request) => {
  const appOrigin = Deno.env.get("APP_ORIGIN")?.replace(/\/+$/, "") || null;
  const origin = req.headers.get("origin");
  if (!appOrigin)
    return response(req, null, "Function misconfigured", 500);

  if (req.method === "OPTIONS") {
    if (origin !== appOrigin) return response(req, appOrigin, "Forbidden origin", 403);
    return response(req, appOrigin, "ok");
  }
  if (origin && origin !== appOrigin)
    return response(req, appOrigin, "Forbidden origin", 403);
  if (req.method !== "POST")
    return response(req, appOrigin, "Method not allowed", 405);

  const authorization = req.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization))
    return response(req, appOrigin, "Unauthorized", 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey)
    return response(req, appOrigin, "Function misconfigured", 500);

  // Do not read the request body until the bearer token has been verified.
  const user = await getAuthUser(supabaseUrl, anonKey, authorization);
  if (user.unauthorized) return response(req, appOrigin, "Unauthorized", 401);
  if (user.unavailable || !user.id)
    return response(req, appOrigin, "Authentication service unavailable", 503);

  // The service-role query bypasses client RLS and makes the role decision
  // independent of anything the caller can put in the request body.
  const profile = await isAdmin(supabaseUrl, serviceRoleKey, user.id);
  if (profile.unavailable)
    return response(req, appOrigin, "Profile service unavailable", 503);
  if (!profile.admin) return response(req, appOrigin, "Forbidden", 403);

  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
    return response(req, appOrigin, "Request body is too large", 413);

  let payload: unknown;
  try {
    const raw = await req.arrayBuffer();
    if (raw.byteLength > MAX_BODY_BYTES)
      return response(req, appOrigin, "Request body is too large", 413);
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return response(req, appOrigin, "Body is not valid JSON", 400);
  }

  const validated = validateReport(payload);
  if (!validated.report)
    return response(req, appOrigin, validated.error || "Invalid report", 400);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("REPORT_FROM");
  if (!apiKey || !from)
    return response(req, appOrigin, "Function misconfigured", 500);

  const { to, subject, intro, headers, rows } = validated.report;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:900px">
    <p style="font-size:14px;color:#333">${esc(intro)}</p>
    ${renderTable(headers, rows)}
    <p style="font-size:11px;color:#888;margin-top:18px">
      Sent from the Procurement Tracker · ${rows.length} row${rows.length === 1 ? "" : "s"}
    </p></div>`;

  /* Attach the CSV too — the factory team works in Excel, and a table pasted
     out of an email body loses its columns. */
  const csv = toCsv(headers, rows);
  let resend: Response;
  try {
    resend = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to, subject, html,
        attachments: [{
          filename: "stp_requirement.csv",
          content: btoa(unescape(encodeURIComponent(csv))),
        }],
      }),
    });
  } catch {
    return response(req, appOrigin, "Email service unavailable", 502);
  }

  if (!resend.ok)
    return response(req, appOrigin, `Email service rejected the report (${resend.status})`, 502);

  return response(req, appOrigin, JSON.stringify({ ok: true, sent: to.length }), 200, true);
});
