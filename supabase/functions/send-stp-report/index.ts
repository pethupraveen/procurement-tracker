// Consumes a one-time approval and sends a fixed STP report. No browser input
// controls recipients, email content, or the data included in the report.

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function cors(req: Request, origin: string) { return req.headers.get("origin") === origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" } : null; }
function reply(req: Request, origin: string, body: unknown, status = 200) { const headers = cors(req, origin); return new Response(JSON.stringify(body), { status, headers: { ...(headers || {}), "Content-Type": "application/json" } }); }
function esc(v: unknown) { return String(v ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string)); }
// AUD-006: a spreadsheet runs a cell that opens with = + - @ or a control
// character as a formula. This attachment is emailed to the MD and the factory,
// so a SKU typed as `=HYPERLINK(...)` executed in whoever opened it. Prefix
// those with an apostrophe, which Excel and Sheets read as "this is text";
// plain numbers are left alone so numeric columns still sum. Mirrors
// exportCell() in src/App.jsx — keep the two in step.
function cellText(v: unknown) {
  const s = String(v ?? "");
  if (!/^[=+\-@\t\r\u0000-\u001f]/.test(s)) return s;
  if (s.trim() !== "" && Number.isFinite(Number(s))) return s;
  return "'" + s;
}
function csvCell(v: unknown) { const s = cellText(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function emails(value: string | undefined) { try { const a = JSON.parse(value || "[]"); return Array.isArray(a) ? [...new Set(a.filter((v) => typeof v === "string" && EMAIL.test(v.trim())).map((v) => v.trim()))].slice(0, 25) : []; } catch { return []; } }
async function hash(value: string) { const bytes = new TextEncoder().encode(value); const digest = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join(""); }

Deno.serve(async (req: Request) => {
  const origin = Deno.env.get("APP_ORIGIN")?.replace(/\/+$/, "");
  const url = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("REPORT_FROM"), pepper = Deno.env.get("REPORT_APPROVAL_PEPPER");
  const recipients = emails(Deno.env.get("REPORT_RECIPIENTS"));
  if (!origin || !url || !key || !resendKey || !from || !pepper || !recipients.length) return new Response("Function misconfigured", { status: 500 });
  if (!cors(req, origin)) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, origin)! });
  if (req.method !== "POST") return reply(req, origin, { error: "Method not allowed" }, 405);
  let body: { approvalId?: string; code?: string }; try { body = await req.json(); } catch { return reply(req, origin, { error: "Invalid approval" }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(body.approvalId || "") || !/^[A-HJ-NP-Z2-9]{8}$/.test(body.code || "")) return reply(req, origin, { error: "Invalid approval" }, 403);
  const codeHash = await hash(`${pepper}:code:${body.approvalId}:${body.code}`);
  const claim = await fetch(`${url}/rest/v1/rpc/claim_report_approval`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_id: body.approvalId, p_code_hash: codeHash }) });
  if (!claim.ok || await claim.json() !== true) return reply(req, origin, { error: "Invalid or expired approval" }, 403);

  // AUD-029: the claim above consumes the approval, so every failure path from
  // here on has to hand it back or a transient fault burns a code the operator
  // can only replace three times an hour. release_report_approval refuses once
  // the send log says 'sent', so this can never un-consume a real send.
  const release = async () => {
    await fetch(`${url}/rest/v1/rpc/release_report_approval`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_id: body.approvalId }) }).catch(() => {});
  };
  const failed = async (message: string, status: number, logError?: string) => {
    if (logError) await fetch(`${url}/rest/v1/report_send_log?approval_id=eq.${body.approvalId}`, { method: "PATCH", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "failed", error: logError }) });
    await release();
    return reply(req, origin, { error: message, retryable: true }, status);
  };

  // Upsert, not insert: approval_id is the primary key here, so a retry of a
  // released approval (AUD-029) hits the existing row. A plain insert failed
  // silently and left the previous attempt's error text on a row this run then
  // marked 'sent', so clear it explicitly.
  await fetch(`${url}/rest/v1/report_send_log?on_conflict=approval_id`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ approval_id: body.approvalId, status: "sending", recipient_count: recipients.length, error: null, resend_email_id: null, sent_at: null }) });
  const phonesResponse = await fetch(`${url}/rest/v1/phones?select=brand,name,stage,po,skus&stage=in.(ordered,production)&order=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const phones = phonesResponse.ok ? await phonesResponse.json() : null;
  if (!Array.isArray(phones)) return failed("Could not build report", 502, "Could not read phones");
  // AUD-013: must match STP_REPORT_HEADERS and materialHeader() in src/rules.js
  // exactly — this is the copy that reaches the MD and the factory, and it used
  // to label the PO column "PO" and an unset material "-" where the two
  // in-app exports said "PO Number" and "(no material)".
  const headers = ["Brand", "Model", "Stage", "PO Number", "Material", "SKUs", "Units", "STP File"];
  const rows: unknown[][] = phones.flatMap((m) => {
    const groups = new Map<string, any[]>(); for (const sku of Array.isArray(m.skus) ? m.skus : []) { const material = String(sku?.material || "") || "(no material)"; groups.set(material, [...(groups.get(material) || []), sku]); }
    return [...groups].map(([material, list]) => { const values = new Set(list.map((s) => s.stpRequired === true ? "Required" : s.stpRequired === false ? "Not required" : "Not decided")); return [m.brand, m.name, m.stage === "ordered" ? "Ordered" : "Production", m.po || "", material, list.map((s) => s.sku).filter(Boolean).join(" / "), list.reduce((n, s) => n + (Number(s.units) || 0), 0), values.size === 1 ? [...values][0] : "Mixed"]; });
  }).slice(0, 500);
  // Nothing to send is not the operator's mistake and must not cost them the code.
  if (!rows.length) return failed("No STP rows to send", 422, "No STP rows");
  const table = `<table style="border-collapse:collapse;width:100%;font-family:system-ui">${[headers, ...rows].map((r, i) => `<tr>${r.map((v) => `<${i ? "td" : "th"} style="text-align:left;padding:6px;border-bottom:1px solid #ddd">${esc(v)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table>`;
  const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  const sent = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `stp-report/${body.approvalId}` }, body: JSON.stringify({ from, to: recipients, subject: "STP file requirement report", html: `<p>Current model and material STP requirements.</p>${table}`, attachments: [{ filename: "stp_requirement.csv", content: btoa(unescape(encodeURIComponent(csv))) }] }) });
  const result = await sent.text();
  // The Idempotency-Key above is scoped to the approval id, so retrying with
  // the same released code cannot send the report twice at Resend.
  if (!sent.ok) return failed("Could not send report", 502, `Resend ${sent.status}`);
  let messageId = null; try { messageId = JSON.parse(result).id || null; } catch {}
  await fetch(`${url}/rest/v1/report_send_log?approval_id=eq.${body.approvalId}`, { method: "PATCH", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "sent", resend_email_id: messageId, sent_at: new Date().toISOString() }) });
  return reply(req, origin, { ok: true });
});
