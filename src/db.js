/* ═══════════════════════════════════════════════════════════════
   db.js — thin Supabase client wrapper

   All DB calls live here. The App never touches fetch() directly.
   Every function returns { data, error } — callers handle errors.

   The URL and anon key are read from localStorage so they survive
   page refresh without needing a build-time .env file.
   ═══════════════════════════════════════════════════════════════ */

const CONFIG_KEY = "proc_tracker_sb_config";

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"); }
  catch { return null; }
}
export function saveConfig(url, key) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: url.trim(), key: key.trim() }));
}
export function clearConfig() { localStorage.removeItem(CONFIG_KEY); }

/* Build a minimal fetch wrapper that looks like the Supabase JS client
   but requires no npm package — just the REST API.                   */
function client() {
  const cfg = getConfig();
  if (!cfg?.url || !cfg?.key) return null;
  const base = cfg.url.replace(/\/$/, "") + "/rest/v1";
  const headers = {
    "Content-Type": "application/json",
    "apikey": cfg.key,
    "Authorization": `Bearer ${cfg.key}`,
    "Prefer": "return=representation",
  };

  const req = async (method, path, body) => {
    try {
      const r = await fetch(base + path, {
        method,
        headers: { ...headers, ...(method === "GET" ? {} : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      const data = text ? JSON.parse(text) : null;
      if (!r.ok) return { data: null, error: data?.message || `HTTP ${r.status}` };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: e.message };
    }
  };

  return {
    get:    (path)        => req("GET",    path),
    post:   (path, body)  => req("POST",   path, body),
    patch:  (path, body)  => req("PATCH",  path, body),
    delete: (path)        => req("DELETE", path),
  };
}

/* ── users ────────────────────────────────────────────────────── */
export async function dbGetUsers() {
  const c = client(); if (!c) return { data: null, error: "not configured" };
  const { data, error } = await c.get("/users?order=created_at");
  return { data, error };
}

export async function dbSaveUser(user) {
  const c = client(); if (!c) return { data: null, error: "not configured" };
  const row = { id: user.id, name: user.name, role: user.role, pin: user.pin, avatar: user.avatar };
  const { data, error } = await c.post("/users?on_conflict=id", row);
  return { data, error };
}

export async function dbDeleteUser(id) {
  const c = client(); if (!c) return { data: null, error: "not configured" };
  return c.delete(`/users?id=eq.${id}`);
}

/* ── phones ───────────────────────────────────────────────────── */
export async function dbGetPhones() {
  const c = client(); if (!c) return { data: null, error: "not configured" };
  const { data, error } = await c.get("/phones?order=created_at");
  return { data, error };
}

export async function dbUpsertPhone(phone) {
  const c = client(); if (!c) return { data: null, error: "not configured" };
  /* flatten to row — complex fields stored as JSONB */
  const row = {
    id:           phone.id,
    brand:        phone.brand,
    name:         phone.name,
    segment:      phone.segment,
    launch:       phone.launch,
    stage:        phone.stage,
    po:           phone.po || null,
    done:         phone.done || {},
    skus:         phone.skus || [],
    sales_entries: phone.salesEntries || [],
  };
  const { data, error } = await c.post("/phones?on_conflict=id", row);
  return { data, error };
}

export async function dbDeletePhone(id) {
  const c = client(); if (!c) return { data: null, error: "not configured" };
  return c.delete(`/phones?id=eq.${id}`);
}

export async function dbDeleteAllPhones() {
  const c = client(); if (!c) return { data: null, error: "not configured" };
  return c.delete("/phones?id=neq.0");   /* delete all rows */
}

/* ── ping (used to verify the connection) ─────────────────────── */
export async function dbPing() {
  const c = client(); if (!c) return { ok: false, error: "not configured" };
  const { data, error } = await c.get("/phones?limit=1");
  return { ok: !error, error };
}
