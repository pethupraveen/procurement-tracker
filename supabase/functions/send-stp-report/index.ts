// Consumes a one-time approval and sends a fixed STP report. No browser input
// controls recipients, email content, or the data included in the report.

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function cors(req: Request, origin: string) { return req.headers.get("origin") === origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" } : null; }
function reply(req: Request, origin: string, body: unknown, status = 200) { const headers = cors(req, origin); return new Response(JSON.stringify(body), { status, headers: { ...(headers || {}), "Content-Type": "application/json" } }); }
function esc(v: unknown) { return String(v ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string)); }
function csvCell(v: unknown) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
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

  await fetch(`${url}/rest/v1/report_send_log`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ approval_id: body.approvalId, status: "sending", recipient_count: recipients.length }) });
  const phonesResponse = await fetch(`${url}/rest/v1/phones?select=brand,name,stage,po,skus&stage=in.(ordered,production)&order=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const phones = phonesResponse.ok ? await phonesResponse.json() : null;
  if (!Array.isArray(phones)) return reply(req, origin, { error: "Could not build report" }, 502);
  const headers = ["Brand", "Model", "Stage", "PO", "Material", "SKUs", "Units", "STP File"];
  const rows: unknown[][] = phones.flatMap((m) => {
    const groups = new Map<string, any[]>(); for (const sku of Array.isArray(m.skus) ? m.skus : []) { const material = String(sku?.material || "-"); groups.set(material, [...(groups.get(material) || []), sku]); }
    return [...groups].map(([material, list]) => { const values = new Set(list.map((s) => s.stpRequired === true ? "Required" : s.stpRequired === false ? "Not required" : "Not decided")); return [m.brand, m.name, m.stage === "ordered" ? "Ordered" : "Production", m.po || "", material, list.map((s) => s.sku).filter(Boolean).join(" / "), list.reduce((n, s) => n + (Number(s.units) || 0), 0), values.size === 1 ? [...values][0] : "Mixed"]; });
  }).slice(0, 500);
  if (!rows.length) return reply(req, origin, { error: "No STP rows to send" }, 422);
  const table = `<table style="border-collapse:collapse;width:100%;font-family:system-ui">${[headers, ...rows].map((r, i) => `<tr>${r.map((v) => `<${i ? "td" : "th"} style="text-align:left;padding:6px;border-bottom:1px solid #ddd">${esc(v)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table>`;
  const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  const sent = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `stp-report/${body.approvalId}` }, body: JSON.stringify({ from, to: recipients, subject: "STP file requirement report", html: `<p>Current model and material STP requirements.</p>${table}`, attachments: [{ filename: "stp_requirement.csv", content: btoa(unescape(encodeURIComponent(csv))) }] }) });
  const result = await sent.text();
  if (!sent.ok) { await fetch(`${url}/rest/v1/report_send_log?approval_id=eq.${body.approvalId}`, { method: "PATCH", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "failed", error: `Resend ${sent.status}` }) }); return reply(req, origin, { error: "Could not send report" }, 502); }
  let messageId = null; try { messageId = JSON.parse(result).id || null; } catch {}
  await fetch(`${url}/rest/v1/report_send_log?approval_id=eq.${body.approvalId}`, { method: "PATCH", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "sent", resend_email_id: messageId, sent_at: new Date().toISOString() }) });
  return reply(req, origin, { ok: true });
});
