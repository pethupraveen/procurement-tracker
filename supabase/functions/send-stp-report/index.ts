/* Sends the STP requirement report to MD / the factory team.
 *
 * This exists because the tracker is a static page — it talks to Supabase
 * straight from the browser, so there is nowhere in it to keep a mail
 * credential that visitors could not read. The key lives here instead.
 *
 * Deploy:
 *   supabase functions deploy send-stp-report
 *   supabase secrets set RESEND_API_KEY=re_xxx REPORT_FROM="Procurement <noreply@yourdomain.com>"
 *
 * RESEND_API_KEY  required — https://resend.com, free tier is enough
 * REPORT_FROM     required — must be an address on a domain verified in Resend
 *
 * Until it is deployed the app's send button reports a 404 rather than
 * claiming the mail went out.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/* The report is a table; send it as one rather than as pasted text, so it is
   readable on a phone without horizontal scrolling gymnastics. */
function renderTable(headers: string[], rows: unknown[][]) {
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

function toCsv(headers: string[], rows: unknown[][]) {
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: CORS });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from   = Deno.env.get("REPORT_FROM");
  if (!apiKey || !from)
    return new Response("RESEND_API_KEY and REPORT_FROM must be set as function secrets",
      { status: 500, headers: CORS });

  let body: { to?: string[]; subject?: string; intro?: string; headers?: string[]; rows?: unknown[][] };
  try { body = await req.json(); }
  catch { return new Response("Body is not JSON", { status: 400, headers: CORS }); }

  const { to = [], subject = "STP requirement report", intro = "", headers = [], rows = [] } = body;
  if (!to.length)   return new Response("No recipients", { status: 400, headers: CORS });
  if (!rows.length) return new Response("No rows to send", { status: 400, headers: CORS });

  const html = `<div style="font-family:system-ui,sans-serif;max-width:900px">
    <p style="font-size:14px;color:#333">${esc(intro)}</p>
    ${renderTable(headers, rows)}
    <p style="font-size:11px;color:#888;margin-top:18px">
      Sent from the Procurement Tracker · ${rows.length} row${rows.length === 1 ? "" : "s"}
    </p></div>`;

  /* Attach the CSV too — the factory team works in Excel, and a table pasted
     out of an email body loses its columns. */
  const csv = toCsv(headers, rows);
  const res = await fetch("https://api.resend.com/emails", {
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

  const text = await res.text();
  if (!res.ok)
    return new Response(`Resend rejected it (${res.status}): ${text}`, { status: 502, headers: CORS });

  return new Response(JSON.stringify({ ok: true, sent: to.length }),
    { headers: { ...CORS, "Content-Type": "application/json" } });
});
