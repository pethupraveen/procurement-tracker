// Sends a short-lived approval code to server-configured approvers. The PIN
// client is not an authorization credential, so it is deliberately ignored.

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function cors(req: Request, origin: string) {
  return req.headers.get("origin") === origin
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" }
    : null;
}
function reply(req: Request, origin: string, body: unknown, status = 200) {
  const headers = cors(req, origin);
  return new Response(JSON.stringify(body), { status, headers: { ...(headers || {}), "Content-Type": "application/json" } });
}
function configEmails(value: string | undefined) {
  try {
    const values = JSON.parse(value || "[]");
    return Array.isArray(values) ? [...new Set(values.filter((v) => typeof v === "string" && EMAIL.test(v.trim())).map((v) => v.trim()))].slice(0, 10) : [];
  } catch { return []; }
}
async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

Deno.serve(async (req: Request) => {
  const origin = Deno.env.get("APP_ORIGIN")?.replace(/\/+$/, "");
  const url = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("REPORT_FROM");
  const pepper = Deno.env.get("REPORT_APPROVAL_PEPPER");
  const approvers = configEmails(Deno.env.get("REPORT_APPROVER_EMAILS"));
  if (!origin || !url || !serviceKey || !resendKey || !from || !pepper || !approvers.length)
    return new Response("Function misconfigured", { status: 500 });
  if (!cors(req, origin)) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, origin)! });
  if (req.method !== "POST") return reply(req, origin, { error: "Method not allowed" }, 405);

  const rawIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const id = crypto.randomUUID();
  const approvalCode = code();
  const ipHash = await hash(`${pepper}:ip:${rawIp}`);
  const codeHash = await hash(`${pepper}:code:${id}:${approvalCode}`);
  const created = await fetch(`${url}/rest/v1/rpc/create_report_approval`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_id: id, p_code_hash: codeHash, p_request_ip_hash: ipHash }),
  });
  if (!created.ok || await created.json() !== true)
    return reply(req, origin, { error: "Please wait before requesting another approval" }, 429);

  const email = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `stp-approval/${id}` },
    body: JSON.stringify({ from, to: approvers, subject: "Procurement Tracker report approval code", html: `<p>Your approval code is <strong style="font-size:24px;letter-spacing:3px">${approvalCode}</strong>.</p><p>It expires in 10 minutes. Do not share it with anyone except the person sending the approved STP report.</p>` }),
  });
  if (!email.ok) {
    await fetch(`${url}/rest/v1/report_approvals?id=eq.${id}`, { method: "DELETE", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    return reply(req, origin, { error: "Could not deliver the approval code" }, 502);
  }
  return reply(req, origin, { approvalId: id, expiresAt: new Date(Date.now() + 600000).toISOString() });
});
