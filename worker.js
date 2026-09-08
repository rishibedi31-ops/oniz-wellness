/**
 * Oniz Health and Wellness — Cloudflare Worker API
 *
 * Paste this entire file into Cloudflare → Workers & Pages → Create Worker.
 * Bind the secrets listed in wrangler.toml. Talks to Supabase over HTTPS
 * (service_role). Does not use the anon key and does not need Node/pg.
 *
 * Public site, patient app, and practitioner portal all call /api/*.
 */

const CLINIC_FALLBACK = "clinic-oniz-health";
const TZ_FALLBACK = "America/Toronto";
const DEFAULT_HOURS = {
  1: [
    { start: "09:00", end: "12:30" },
    { start: "13:30", end: "17:30" },
  ],
  2: [
    { start: "09:00", end: "12:30" },
    { start: "13:30", end: "17:30" },
  ],
  3: [
    { start: "09:00", end: "12:30" },
    { start: "13:30", end: "17:30" },
  ],
  4: [
    { start: "09:00", end: "12:30" },
    { start: "13:30", end: "17:30" },
  ],
  5: [
    { start: "09:00", end: "12:30" },
    { start: "13:30", end: "16:00" },
  ],
  6: [{ start: "09:00", end: "13:00" }],
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api")) {
      const page = await serveAsset(request, env);
      if (page) return page;
    }
    return handleRequest(request, env);
  },
};

async function serveAsset(request, env) {
  if (!env || !env.ASSETS) return null;
  const url = new URL(request.url);
  const paths = [url.pathname];
  if (url.pathname === "/" || url.pathname === "") paths.push("/index.html");
  else if (url.pathname.endsWith("/")) paths.push(url.pathname + "index.html");
  else if (!url.pathname.includes(".")) paths.push(url.pathname + ".html");
  for (const path of paths) {
    const res = await env.ASSETS.fetch(new URL(path, url.origin));
    if (res && res.status !== 404) return res;
  }
  return null;
}

export async function handleRequest(request, env) {
  const origin = corsOrigin(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  try {
    const res = await route(request, env);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  } catch (err) {
    const message = err instanceof HttpError ? err.message : "Something went wrong.";
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(err);
    return json({ error: message }, status, corsHeaders(origin));
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new HttpError(status, message);
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

function corsOrigin(request, env) {
  const allowed = (pickString(env, "ALLOWED_ORIGIN") || "*").trim();
  const reqOrigin = request.headers.get("Origin");
  if (allowed === "*") return reqOrigin || "*";
  if (reqOrigin && allowed.split(",").map((s) => s.trim()).includes(reqOrigin)) return reqOrigin;
  return allowed.split(",")[0].trim();
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function clinicId(env) {
  return pickString(env, "CLINIC_ID") || CLINIC_FALLBACK;
}

function envNames(env) {
  try {
    return Object.keys(env || {}).sort();
  } catch {
    return [];
  }
}

function pickString(env, ...names) {
  if (!env) return "";
  for (const name of names) {
    const value = unwrapBinding(env[name]);
    if (value) return value;
  }
  try {
    const proc = globalThis.process?.env;
    if (proc) {
      for (const name of names) {
        const value = unwrapBinding(proc[name]);
        if (value) return value;
      }
    }
  } catch {
    /* no Node compat */
  }
  return "";
}

function unwrapBinding(raw) {
  if (raw == null || raw === "") return "";
  if (typeof raw === "string") return cleanSecret(raw);
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return "";
}

async function pickSecret(env, ...names) {
  const sync = pickString(env, ...names);
  if (sync) return sync;
  if (!env) return "";
  for (const name of names) {
    const raw = env[name];
    if (raw && typeof raw.get === "function") {
      try {
        const value = cleanSecret(await raw.get());
        if (value) return value;
      } catch {
        /* not a Secrets Store binding */
      }
    }
  }
  return "";
}

function cleanSecret(value) {
  let v = String(value ?? "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(v)) v = v.replace(/^bearer\s+/i, "").trim();
  if (!v) return "";
  if (/^YOUR[-_]/i.test(v) || v.includes("YOUR-PROJECT") || v.includes("YOUR_SERVICE")) return "";
  return v;
}

async function supabaseCreds(env) {
  const url = await pickSecret(env, "SUPABASE_URL", "SUPABASE_PROJECT_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const key = await pickSecret(
    env,
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_KEY",
    "SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
  );
  return { url, key };
}

function plainEnv(env) {
  const out = {};
  for (const k of envNames(env)) {
    const v = unwrapBinding(env[k]);
    if (v) out[k] = v;
  }
  return Object.assign(out, env);
}

async function withSupabase(env) {
  const { url, key } = await supabaseCreds(env);
  if (!url || !key) fail(500, missingSecretsMessage(env, url, key));
  return Object.assign(plainEnv(env), {
    SUPABASE_URL: url.replace(/\/$/, ""),
    SUPABASE_SERVICE_ROLE_KEY: key,
  });
}

function missingSecretsMessage(env, url, key) {
  const names = envNames(env);
  const missing = [!url ? "SUPABASE_URL" : null, !key ? "SUPABASE_SERVICE_ROLE_KEY" : null].filter(Boolean);
  return (
    `Worker cannot see ${missing.join(" and ")}. ` +
    `Open Cloudflare → Workers & Pages → onizwellness → Settings → Variables and Secrets. ` +
    `Names must be ALL CAPS on this worker, then Save and Deploy. ` +
    `A .env file on your computer is not sent to Cloudflare. ` +
    `Bindings visible here: ${names.length ? names.join(", ") : "(none)"}`
  );
}

async function healthPayload(env) {
  const { url, key } = await supabaseCreds(env);
  return {
    ok: true,
    service: "oniz-health-api",
    ready: Boolean(url && key),
    secrets: {
      SUPABASE_URL: Boolean(url),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(key),
      SESSION_SECRET: Boolean(pickString(env, "SESSION_SECRET")),
      STAFF_EMAIL: Boolean(pickString(env, "STAFF_EMAIL")),
      STAFF_PASSWORD: Boolean(pickString(env, "STAFF_PASSWORD")),
    },
    bindings: envNames(env),
    clinicId: clinicId(env),
  };
}

function homePage(health) {
  const ready = health.ready
    ? "Supabase is connected."
    : "Supabase secrets are not visible to this worker yet.";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Oniz Health API</title>
<style>
  body{margin:0;font-family:Outfit,system-ui,sans-serif;background:#f3eee4;color:#1a241c}
  main{max-width:36rem;margin:12vh auto;padding:0 1.25rem}
  h1{font-family:Georgia,serif;font-weight:500;font-size:2.4rem}
  p{color:#5e6a61;line-height:1.55}
  a{color:#3d5846}
  code{font-size:.9rem}
</style></head>
<body><main>
  <p style="letter-spacing:.2em;text-transform:uppercase;font-size:.75rem;color:#3d5846">Oniz Health and Wellness</p>
  <h1>Worker is running.</h1>
  <p>${ready}</p>
  <p>Check <a href="/api/health">/api/health</a> · clinic data <a href="/api/clinic">/api/clinic</a></p>
  ${health.ready ? "" : `<p>Add <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> on <strong>this</strong> worker: onizwellness → Settings → Variables and Secrets → Deploy.</p>`}
</main></body></html>`;
}

function nid() {
  return crypto.randomUUID();
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function nowIso() {
  return new Date().toISOString();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    fail(400, "Invalid JSON body.");
  }
}

function pathParts(url) {
  return url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
}

async function route(request, env) {
  const url = new URL(request.url);
  const parts = pathParts(url);
  const method = request.method.toUpperCase();

  if (method === "GET" && (url.pathname === "/" || url.pathname === "")) {
    const health = await healthPayload(env);
    return new Response(homePage(health), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (parts[0] !== "api") fail(404, "Not found. API lives under /api.");

  const rest = parts.slice(1);
  const key = `${method} /${rest.join("/")}`;

  if (method === "GET" && rest.length === 0) return json(apiIndex());
  if (key === "GET /health") return json(await healthPayload(env));

  env = await withSupabase(env);

  if (key === "GET /clinic") return json(await publicClinic(env));
  if (key === "GET /availability") return json(await availability(env, url.searchParams));
  if (key === "POST /book") return json(await bookVisit(env, await readJson(request)));
  if (key === "GET /intake") return json(await getIntake(env, url.searchParams.get("token")));
  if (key === "POST /intake") return json(await submitIntake(env, await readJson(request)));
  if (key === "POST /contact") return json(await submitContact(env, await readJson(request)));
  if (key === "POST /newsletter") return json(await subscribe(env, await readJson(request)));
  if (key === "POST /waitlist") return json(await joinWaitlist(env, await readJson(request)));

  if (key === "POST /auth/staff") return json(await staffLogin(env, await readJson(request)));
  if (key === "POST /auth/patient") return json(await patientLogin(env, await readJson(request)));
  if (key === "GET /me") return json(await whoAmI(env, request));

  if (key === "POST /webhooks/calcom") return json(await calcomWebhook(env, request));

  const session = await requireSession(env, request);

  if (session.role === "patient") {
    if (key === "GET /care") return json(await myCare(env, session));
    if (key === "POST /care/messages") return json(await sendPatientMessage(env, session, await readJson(request)));
    fail(403, "Staff only.");
  }

  if (key === "GET /portal/dashboard") return json(await dashboard(env, session));
  if (key === "GET /portal/patients" && rest.length === 2) return json(await listPatients(env, session, url.searchParams));
  if (key === "POST /portal/patients" && rest.length === 2) {
    return json(await createPatient(env, session, await readJson(request)));
  }
  if (rest[0] === "portal" && rest[1] === "patients" && rest[2]) {
    const id = rest[2];
    const action = rest[3];
    if (method === "GET" && !action) return json(await patientChart(env, session, id));
    if (method === "POST" && !action) return json(await updatePatient(env, session, id, await readJson(request)));
    if (method === "POST" && action === "notes") return json(await addNote(env, session, id, await readJson(request)));
    if (method === "POST" && action === "soap") return json(await saveSoap(env, session, id, await readJson(request)));
    if (method === "POST" && action === "insurance") return json(await addInsurance(env, session, id, await readJson(request)));
    if (method === "POST" && action === "files") return json(await addFile(env, session, id, await readJson(request)));
    if (method === "POST" && action === "intake-link") return json(await issueIntake(env, session, id));
    if (method === "POST" && action === "consent") {
      return json(await signConsent(env, session, id, await readJson(request)));
    }
  }

  if (key === "GET /portal/appointments") return json(await listAppointments(env, session, url.searchParams));
  if (rest[0] === "portal" && rest[1] === "appointments" && rest[3] === "status" && method === "POST") {
    return json(await setAppointmentStatus(env, session, rest[2], await readJson(request)));
  }

  if (key === "GET /portal/claims") return json(await listClaims(env, session));
  if (key === "POST /portal/claims") return json(await saveClaim(env, session, await readJson(request)));
  if (rest[0] === "portal" && rest[1] === "claims" && rest[2] && method === "POST") {
    return json(await saveClaim(env, session, { ...await readJson(request), id: rest[2] }));
  }

  if (key === "GET /portal/calendar") return json(await calendar(env, session, url.searchParams));
  if (key === "GET /portal/services") return json(await listServices(env, session));
  if (key === "POST /portal/services") return json(await saveService(env, session, await readJson(request)));
  if (key === "GET /portal/forms") return json(await formLibrary(env, session));
  if (key === "POST /portal/forms/consents") {
    return json(await saveConsentTemplate(env, session, await readJson(request)));
  }
  if (key === "POST /portal/settings") return json(await saveSettings(env, session, await readJson(request)));

  if (key === "GET /portal/desk") return json(await desk(env, session));
  if (rest[0] === "portal" && rest[1] === "inquiries" && rest[2] && method === "POST") {
    return json(await setInquiry(env, session, rest[2], await readJson(request)));
  }
  if (rest[0] === "portal" && rest[1] === "conversations" && rest[2] && method === "GET") {
    return json(await getThread(env, session, rest[2]));
  }
  if (rest[0] === "portal" && rest[1] === "conversations" && rest[2] && method === "POST") {
    return json(await replyThread(env, session, rest[2], await readJson(request)));
  }
  if (rest[0] === "portal" && rest[1] === "waitlist" && rest[2] && method === "POST") {
    return json(await setWaitlist(env, session, rest[2], await readJson(request)));
  }
  if (key === "POST /portal/tasks") return json(await addTask(env, session, await readJson(request)));
  if (rest[0] === "portal" && rest[1] === "tasks" && rest[2] && method === "POST") {
    return json(await setTask(env, session, rest[2], await readJson(request)));
  }
  if (rest[0] === "portal" && rest[1] === "invoices" && rest[3] === "paid" && method === "POST") {
    return json(await markPaid(env, session, rest[2]));
  }
  if (key === "GET /portal/connectors") return json(await listConnectors(env, session));
  if (rest[0] === "portal" && rest[1] === "connectors" && rest[2] && method === "POST") {
    return json(await saveConnector(env, session, rest[2], await readJson(request)));
  }

  fail(404, "Not found.");
}

function apiIndex() {
  return {
    name: "Oniz Health and Wellness API",
    version: "1.0",
    layers: {
      website: ["GET /api/clinic", "POST /api/book", "POST /api/contact", "POST /api/newsletter"],
      patient: ["POST /api/auth/patient", "GET /api/care", "GET /api/intake"],
      portal: ["POST /api/auth/staff", "GET /api/portal/dashboard", "GET /api/portal/desk"],
      connectors: ["POST /api/webhooks/calcom", "GET /api/portal/connectors"],
    },
  };
}

/* ── Supabase REST ──────────────────────────────────────────────────────── */

async function sb(env, table, { method = "GET", query = "", body, headers = {} } = {}) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base || !env.SUPABASE_SERVICE_ROLE_KEY) fail(500, "Supabase is not configured on this worker.");
  const url = `${base}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg = data && typeof data === "object" ? data.message || data.hint || data.details : text;
    fail(res.status === 404 ? 404 : 502, msg || "Database error.");
  }
  return data;
}

function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  return p.toString();
}

async function one(env, table, query) {
  const rows = await sb(env, table, { query });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function many(env, table, query) {
  const rows = await sb(env, table, { query });
  return Array.isArray(rows) ? rows : [];
}

async function insert(env, table, row) {
  const rows = await sb(env, table, { method: "POST", body: row });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function patch(env, table, query, row) {
  const rows = await sb(env, table, { method: "PATCH", query, body: row });
  return Array.isArray(rows) ? rows[0] : rows;
}

/* ── Time / slots ───────────────────────────────────────────────────────── */

function fromZoned(ymd, hhmm, tz = TZ_FALLBACK) {
  const naive = `${ymd}T${hhmm}:00`;
  const utc = new Date(`${naive}Z`);
  const tzDate = new Date(utc.toLocaleString("en-US", { timeZone: tz }));
  return new Date(utc.getTime() + (utc.getTime() - tzDate.getTime()));
}

function weekdayInZone(ymd, tz = TZ_FALLBACK) {
  const d = fromZoned(ymd, "12:00", tz);
  const w = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
}

function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMin(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function generateSlots(ymd, hours, durationMin, booked, tz, now = new Date()) {
  const dow = weekdayInZone(ymd, tz);
  const blocks = hours[String(dow)] || hours[dow] || [];
  const out = [];
  const lead = now.getTime() + 60 * 60 * 1000;
  for (const block of blocks) {
    const startM = toMin(block.start);
    const endM = toMin(block.end);
    for (let t = startM; t + durationMin <= endM; t += 15) {
      const start = fromZoned(ymd, fromMin(t), tz);
      const end = fromZoned(ymd, fromMin(t + durationMin), tz);
      if (start.getTime() < lead) continue;
      const overlap = booked.some((b) => {
        const bs = new Date(b.start).getTime();
        const be = new Date(b.end).getTime();
        return start.getTime() < be && end.getTime() > bs;
      });
      if (!overlap) out.push(start.toISOString());
    }
  }
  return out;
}

function parseHours(value) {
  if (!value) return DEFAULT_HOURS;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return DEFAULT_HOURS;
  }
}

function isoOf(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/* ── JWT (HMAC-SHA256) ──────────────────────────────────────────────────── */

function b64url(bytes) {
  let str;
  if (typeof bytes === "string") str = btoa(bytes);
  else {
    let bin = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (const b of arr) bin += String.fromCharCode(b);
    str = btoa(bin);
  }
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signJwt(env, payload) {
  const secret = env.SESSION_SECRET;
  if (!secret) fail(500, "SESSION_SECRET is not set.");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

async function verifyJwt(env, token) {
  const secret = env.SESSION_SECRET;
  if (!secret || !token) return null;
  const bits = token.split(".");
  if (bits.length !== 3) return null;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(fromB64url(bits[2]), (c) => c.charCodeAt(0)),
    new TextEncoder().encode(`${bits[0]}.${bits[1]}`),
  );
  if (!ok) return null;
  try {
    const payload = JSON.parse(fromB64url(bits[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function bearer(request) {
  const h = request.headers.get("Authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)hh_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function requireSession(env, request) {
  const token = bearer(request);
  const payload = await verifyJwt(env, token);
  if (!payload) fail(401, "Sign in required.");
  return payload;
}

async function whoAmI(env, request) {
  const token = bearer(request);
  const payload = await verifyJwt(env, token);
  if (!payload) return { signedIn: false };
  return { signedIn: true, role: payload.role, email: payload.email, name: payload.name };
}

async function issueToken(env, claims) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  const token = await signJwt(env, { ...claims, iat: Math.floor(Date.now() / 1000), exp });
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

function timingSafe(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  const max = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let i = 0; i < max; i++) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/* ── Public ─────────────────────────────────────────────────────────────── */

async function publicClinic(env) {
  const id = clinicId(env);
  const clinic = await one(env, "clinics", qs({ id: `eq.${id}`, select: "*" }));
  if (!clinic) fail(404, "Clinic not found. Run the SQL in your Supabase project first.");
  const services = await many(
    env,
    "services",
    qs({ clinic_id: `eq.${id}`, is_active: "eq.true", order: "sort_order.asc,name.asc" }),
  );
  const prac = await many(
    env,
    "practitioners",
    qs({ clinic_id: `eq.${id}`, is_active: "eq.true", order: "created_at.asc", limit: "1" }),
  );
  const hours = await many(env, "clinic_hours", qs({ clinic_id: `eq.${id}`, order: "weekday.asc" }));
  const faqs = await many(
    env,
    "faqs",
    qs({ clinic_id: `eq.${id}`, is_published: "eq.true", order: "sort_order.asc" }),
  );
  const testimonials = await many(
    env,
    "testimonials",
    qs({ clinic_id: `eq.${id}`, is_published: "eq.true", order: "sort_order.asc" }),
  );
  const p = prac[0];
  return {
    clinic,
    services,
    hours,
    faqs,
    testimonials,
    practitioner: p
      ? { name: `${p.first_name} ${p.last_name}`.trim(), credentials: p.credentials, bio: p.bio }
      : null,
  };
}

async function availability(env, params) {
  const serviceId = params.get("serviceId");
  const date = params.get("date");
  if (!serviceId || !date) fail(400, "serviceId and date are required.");
  const id = clinicId(env);
  const svc = await one(env, "services", qs({ id: `eq.${serviceId}`, clinic_id: `eq.${id}`, is_active: "eq.true" }));
  if (!svc) fail(404, "Service not found.");
  const prac = await many(
    env,
    "practitioners",
    qs({ clinic_id: `eq.${id}`, is_active: "eq.true", order: "created_at.asc", limit: "1" }),
  );
  const hours = parseHours(prac[0]?.weekly_hours);
  const bookedRows = await many(
    env,
    "appointments",
    `clinic_id=eq.${id}&status=not.in.(cancelled,no_show)&start_at=gte.${date}T00:00:00.000Z&start_at=lt.${date}T23:59:59.999Z&select=start_at,end_at`,
  );
  const booked = bookedRows.map((b) => ({ start: isoOf(b.start_at), end: isoOf(b.end_at) }));
  const tz = env.TZ || TZ_FALLBACK;
  return { slots: generateSlots(date, hours, Number(svc.duration_minutes), booked, tz), duration: Number(svc.duration_minutes) };
}

async function bookVisit(env, body) {
  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const serviceId = String(body.serviceId || "");
  const startAt = String(body.startAt || "");
  if (!firstName || !lastName || !email || !phone || !serviceId || !startAt) {
    fail(400, "First name, last name, email, phone, service and time are required.");
  }
  const id = clinicId(env);
  const svc = await one(env, "services", qs({ id: `eq.${serviceId}`, clinic_id: `eq.${id}`, is_active: "eq.true" }));
  if (!svc) fail(404, "Service not found.");
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) fail(400, "Invalid time.");
  const end = new Date(start.getTime() + Number(svc.duration_minutes) * 60 * 1000);

  const clash = await many(
    env,
    "appointments",
    `clinic_id=eq.${id}&status=not.in.(cancelled,no_show)&start_at=lt.${end.toISOString()}&end_at=gt.${start.toISOString()}&select=id&limit=1`,
  );
  if (clash[0]) fail(409, "That time was just taken. Please pick another slot.");

  let patient = await one(
    env,
    "patients",
    `clinic_id=eq.${id}&email=ilike.${encodeURIComponent(email)}&select=id&limit=1`,
  );
  if (!patient) {
    patient = await insert(env, "patients", {
      id: nid(),
      clinic_id: id,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
    });
    try {
      await insert(env, "patient_accounts", {
        id: nid(),
        clinic_id: id,
        patient_id: patient.id,
        email,
      });
    } catch {
      /* unique conflict is fine */
    }
  } else {
    await patch(env, "patients", qs({ id: `eq.${patient.id}` }), {
      first_name: firstName,
      last_name: lastName,
      phone,
      updated_at: nowIso(),
    });
  }

  const prac = await many(
    env,
    "practitioners",
    qs({ clinic_id: `eq.${id}`, is_active: "eq.true", order: "created_at.asc", limit: "1" }),
  );
  const appt = await insert(env, "appointments", {
    id: nid(),
    clinic_id: id,
    patient_id: patient.id,
    practitioner_id: prac[0]?.id || null,
    service_id: serviceId,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    status: "booked",
    source: "web",
  });
  const token = nid().replace(/-/g, "") + nid().replace(/-/g, "").slice(0, 8);
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  await insert(env, "form_tokens", {
    id: nid(),
    clinic_id: id,
    patient_id: patient.id,
    appointment_id: appt.id,
    token,
    purpose: "intake",
    expires_at: expires,
  });
  return {
    appointmentId: appt.id,
    patientId: patient.id,
    intakeToken: token,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    serviceName: svc.name,
  };
}

async function getIntake(env, token) {
  if (!token) fail(400, "Missing intake token.");
  const tok = await one(env, "form_tokens", qs({ token: `eq.${token}`, purpose: "eq.intake" }));
  if (!tok) fail(404, "This intake link is invalid.");
  if (tok.used_at) fail(409, "This intake form has already been submitted.");
  if (new Date(tok.expires_at).getTime() < Date.now()) fail(410, "This intake link has expired.");
  const patient = await one(env, "patients", qs({ id: `eq.${tok.patient_id}`, select: "id,first_name,last_name,email,phone" }));
  const tmpl = await many(
    env,
    "intake_templates",
    qs({ clinic_id: `eq.${tok.clinic_id}`, is_active: "eq.true", order: "version.desc", limit: "1" }),
  );
  if (!tmpl[0] || !patient) fail(404, "Form is not available.");
  let appointment = null;
  if (tok.appointment_id) {
    const appt = await one(
      env,
      "appointments",
      `id=eq.${tok.appointment_id}&select=start_at,service_id,services(name)`,
    );
    if (appt) {
      appointment = {
        startAt: isoOf(appt.start_at),
        serviceId: appt.service_id,
        serviceName: appt.services?.name || null,
      };
    }
  }
  const consents = await many(
    env,
    "consent_templates",
    qs({ clinic_id: `eq.${tok.clinic_id}`, is_active: "eq.true", order: "name.asc" }),
  );
  return {
    patient: {
      first_name: patient.first_name,
      last_name: patient.last_name,
      email: patient.email,
      phone: patient.phone,
    },
    appointment,
    template: {
      id: tmpl[0].id,
      name: tmpl[0].name,
      version: tmpl[0].version,
      schema: tmpl[0].schema_json,
    },
    consents,
  };
}

async function submitIntake(env, body) {
  const token = String(body.token || "");
  const answers = body.answers || {};
  const consents = Array.isArray(body.consents) ? body.consents : [];
  const tok = await one(env, "form_tokens", qs({ token: `eq.${token}`, purpose: "eq.intake" }));
  if (!tok) fail(404, "Invalid intake link.");
  if (tok.used_at) fail(409, "Already submitted.");
  if (new Date(tok.expires_at).getTime() < Date.now()) fail(410, "Link expired.");
  const tmpl = await many(
    env,
    "intake_templates",
    qs({ clinic_id: `eq.${tok.clinic_id}`, is_active: "eq.true", order: "version.desc", limit: "1" }),
  );
  if (!tmpl[0]) fail(404, "Template missing.");
  await insert(env, "intake_submissions", {
    id: nid(),
    clinic_id: tok.clinic_id,
    patient_id: tok.patient_id,
    appointment_id: tok.appointment_id,
    template_id: tmpl[0].id,
    template_version: tmpl[0].version,
    answers_json: answers,
  });
  for (const c of consents) {
    const t = await one(env, "consent_templates", qs({ id: `eq.${c.templateId}` }));
    if (!t) continue;
    await insert(env, "consent_signatures", {
      id: nid(),
      clinic_id: tok.clinic_id,
      patient_id: tok.patient_id,
      appointment_id: tok.appointment_id,
      template_id: t.id,
      template_version: t.version,
      template_name: t.name,
      signature_data: c.signatureData || null,
      signed_name: c.signedName,
    });
  }
  await patch(env, "form_tokens", qs({ id: `eq.${tok.id}` }), { used_at: nowIso() });
  return { ok: true };
}

async function submitContact(env, body) {
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const message = String(body.message || "").trim();
  if (!name || !email || message.length < 8) fail(400, "Name, email and a message are required.");
  await insert(env, "inquiries", {
    id: nid(),
    clinic_id: clinicId(env),
    name,
    email,
    phone: body.phone ? String(body.phone).trim() : null,
    topic: String(body.topic || "general"),
    message,
    status: "new",
  });
  return { ok: true };
}

async function subscribe(env, body) {
  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) fail(400, "A valid email is required.");
  await sb(env, "newsletter_subscribers", {
    method: "POST",
    body: {
      id: nid(),
      clinic_id: clinicId(env),
      email,
      name: body.name ? String(body.name).trim() : null,
      status: "subscribed",
      source: "website",
    },
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  });
  return { ok: true };
}

async function joinWaitlist(env, body) {
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  if (!name || !email) fail(400, "Name and email are required.");
  await insert(env, "waitlist", {
    id: nid(),
    clinic_id: clinicId(env),
    name,
    email,
    phone: body.phone ? String(body.phone).trim() : null,
    service_id: body.serviceId || null,
    preferred_days: body.preferredDays || null,
    notes: body.notes || null,
    status: "open",
  });
  return { ok: true };
}

/* ── Auth ───────────────────────────────────────────────────────────────── */

async function staffLogin(env, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) fail(400, "Email and password are required.");

  const envEmail = String(env.STAFF_EMAIL || "").trim().toLowerCase();
  const envPass = String(env.STAFF_PASSWORD || "");
  let practitioner = null;
  let role = "practitioner";

  if (envEmail && timingSafe(email, envEmail) && timingSafe(password, envPass)) {
    practitioner = await many(
      env,
      "practitioners",
      qs({ clinic_id: `eq.${clinicId(env)}`, is_active: "eq.true", order: "created_at.asc", limit: "1" }),
    ).then((rows) => rows[0] || null);
    role = "owner";
  } else {
    let login = null;
    try {
      login = await one(
        env,
        "staff_logins",
        qs({ clinic_id: `eq.${clinicId(env)}`, email: `eq.${email}`, is_active: "eq.true" }),
      );
    } catch {
      login = null;
    }
    if (!login || !timingSafe(login.password_hash, password)) fail(401, "Invalid email or password.");
    role = login.role || "practitioner";
    if (login.practitioner_id) {
      practitioner = await one(env, "practitioners", qs({ id: `eq.${login.practitioner_id}` }));
    }
  }

  const name = practitioner ? `${practitioner.first_name} ${practitioner.last_name}`.trim() : "Practitioner";
  const issued = await issueToken(env, {
    sub: practitioner?.id || "staff",
    role: "staff",
    staffRole: role,
    email,
    name,
    clinic_id: clinicId(env),
    practitioner_id: practitioner?.id || null,
  });
  return { ...issued, role: "staff", staffRole: role, name, email };
}

async function patientLogin(env, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const phone = digits(body.phone);
  if (!email || phone.length < 7) fail(400, "Email and phone number are required.");
  const patient = await one(
    env,
    "patients",
    `clinic_id=eq.${clinicId(env)}&email=ilike.${encodeURIComponent(email)}&select=*`,
  );
  if (!patient || digits(patient.phone) !== phone) fail(401, "No matching patient record.");
  const issued = await issueToken(env, {
    sub: patient.id,
    role: "patient",
    email: patient.email,
    name: `${patient.first_name} ${patient.last_name}`.trim(),
    clinic_id: clinicId(env),
    patient_id: patient.id,
  });
  return { ...issued, role: "patient", name: `${patient.first_name} ${patient.last_name}`.trim(), email: patient.email };
}

/* ── Patient app ────────────────────────────────────────────────────────── */

async function myCare(env, session) {
  const pid = session.patient_id;
  if (!pid) fail(403, "No patient chart is linked to this login.");
  const clinic = await one(env, "clinics", qs({ id: `eq.${session.clinic_id}` }));
  const patient = await one(env, "patients", qs({ id: `eq.${pid}` }));
  const visits = await many(
    env,
    "appointments",
    `patient_id=eq.${pid}&select=*,services(name)&order=start_at.desc`,
  );
  const invoices = await many(env, "invoices", qs({ patient_id: `eq.${pid}`, order: "created_at.desc" }));
  const labs = await many(env, "lab_orders", qs({ patient_id: `eq.${pid}`, order: "ordered_at.desc" }));
  const plans = await many(env, "treatment_plans", qs({ patient_id: `eq.${pid}`, order: "created_at.desc" }));
  const prescriptions = await many(env, "prescriptions", qs({ patient_id: `eq.${pid}`, order: "created_at.desc" }));
  const conversations = await many(env, "conversations", qs({ patient_id: `eq.${pid}`, order: "last_message_at.desc" }));
  return { linked: true, clinic, patient, visits, invoices, labs, plans, prescriptions, conversations };
}

async function sendPatientMessage(env, session, body) {
  const pid = session.patient_id;
  if (!pid) fail(403, "No patient chart is linked to this login.");
  const text = String(body.body || "").trim();
  if (!text) fail(400, "Message is required.");
  let convId = body.conversationId;
  if (!convId) {
    const conv = await insert(env, "conversations", {
      id: nid(),
      clinic_id: session.clinic_id,
      patient_id: pid,
      subject: String(body.subject || "Message to the clinic"),
      status: "open",
      last_message_at: nowIso(),
    });
    convId = conv.id;
  }
  await insert(env, "messages", {
    id: nid(),
    clinic_id: session.clinic_id,
    conversation_id: convId,
    author_kind: "patient",
    author_id: pid,
    body: text,
  });
  await patch(env, "conversations", qs({ id: `eq.${convId}` }), { last_message_at: nowIso(), status: "open" });
  return { ok: true, conversationId: convId };
}

/* ── Portal ─────────────────────────────────────────────────────────────── */

function staffClinic(session) {
  return session.clinic_id || CLINIC_FALLBACK;
}

async function dashboard(env, session) {
  const id = staffClinic(session);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const week = new Date(start);
  week.setDate(week.getDate() + 7);
  const today = await many(
    env,
    "appointments",
    `clinic_id=eq.${id}&start_at=gte.${start.toISOString()}&start_at=lt.${end.toISOString()}&status=neq.cancelled&select=*,patients(first_name,last_name),services(name)&order=start_at.asc`,
  );
  const upcoming = await many(
    env,
    "appointments",
    `clinic_id=eq.${id}&start_at=gte.${end.toISOString()}&start_at=lt.${week.toISOString()}&status=neq.cancelled&select=*,patients(first_name,last_name),services(name)&order=start_at.asc`,
  );
  const patients = await many(env, "patients", qs({ clinic_id: `eq.${id}`, select: "id", limit: "1000" }));
  const openClaims = await many(env, "claims", `clinic_id=eq.${id}&status=in.(draft,submitted,pending)&select=id`);
  return {
    today: today.map(shapeAppt),
    upcoming: upcoming.map(shapeAppt),
    patientCount: patients.length,
    openClaims: openClaims.length,
  };
}

function shapeAppt(row) {
  return {
    ...row,
    patient_name: row.patients ? `${row.patients.first_name} ${row.patients.last_name}`.trim() : undefined,
    service_name: row.services?.name,
  };
}

async function listPatients(env, session, params) {
  const id = staffClinic(session);
  const q = params.get("q");
  let query = `clinic_id=eq.${id}&order=last_name.asc,first_name.asc&select=*`;
  if (q) {
    const safe = String(q).replace(/[,()*]/g, "").trim();
    if (safe) {
      query += `&or=(first_name.ilike.*${encodeURIComponent(safe)}*,last_name.ilike.*${encodeURIComponent(safe)}*,email.ilike.*${encodeURIComponent(safe)}*,phone.ilike.*${encodeURIComponent(safe)}*)`;
    }
  }
  const rows = await many(env, "patients", query);
  return { patients: rows };
}

async function createPatient(env, session, body) {
  const first = String(body.firstName || body.first_name || "").trim();
  const last = String(body.lastName || body.last_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  if (!first || !last || !email || !phone) fail(400, "Name, email and phone are required.");
  const row = await insert(env, "patients", {
    id: nid(),
    clinic_id: staffClinic(session),
    first_name: first,
    last_name: last,
    email,
    phone,
    date_of_birth: body.dateOfBirth || body.date_of_birth || null,
  });
  return { patient: row };
}

async function patientChart(env, session, id) {
  const clinic = staffClinic(session);
  const patient = await one(env, "patients", qs({ id: `eq.${id}`, clinic_id: `eq.${clinic}` }));
  if (!patient) fail(404, "Patient not found.");
  const [visits, intakes, consents, notes, soap, files, insurances, claims] = await Promise.all([
    many(env, "appointments", `patient_id=eq.${id}&select=*,services(name)&order=start_at.desc`),
    many(env, "intake_submissions", qs({ patient_id: `eq.${id}`, order: "submitted_at.desc" })),
    many(env, "consent_signatures", qs({ patient_id: `eq.${id}`, order: "signed_at.desc" })),
    many(env, "patient_notes", qs({ patient_id: `eq.${id}`, order: "created_at.desc" })),
    many(env, "chart_notes", qs({ patient_id: `eq.${id}`, order: "visit_at.desc" })),
    many(
      env,
      "patient_files",
      `patient_id=eq.${id}&select=id,name,mime,size_bytes,kind,notes,uploaded_by,created_at&order=created_at.desc`,
    ),
    many(env, "insurances", qs({ patient_id: `eq.${id}`, order: "created_at.desc" })),
    many(env, "claims", qs({ patient_id: `eq.${id}`, order: "created_at.desc" })),
  ]);
  return {
    patient,
    visits: visits.map(shapeAppt),
    intakes,
    consents,
    notes,
    soap,
    files,
    insurances,
    claims,
  };
}

async function updatePatient(env, session, id, body) {
  const row = await patch(env, "patients", qs({ id: `eq.${id}`, clinic_id: `eq.${staffClinic(session)}` }), {
    first_name: body.firstName ?? body.first_name,
    last_name: body.lastName ?? body.last_name,
    email: body.email,
    phone: body.phone,
    date_of_birth: body.dateOfBirth ?? body.date_of_birth,
    sex: body.sex,
    pronouns: body.pronouns,
    address: body.address,
    city: body.city,
    province: body.province,
    postal_code: body.postalCode ?? body.postal_code,
    emergency_name: body.emergencyName ?? body.emergency_name,
    emergency_phone: body.emergencyPhone ?? body.emergency_phone,
    alerts: body.alerts,
    updated_at: nowIso(),
  });
  return { patient: row };
}

async function addNote(env, session, id, body) {
  const text = String(body.body || "").trim();
  if (!text) fail(400, "Note is required.");
  const row = await insert(env, "patient_notes", {
    id: nid(),
    clinic_id: staffClinic(session),
    patient_id: id,
    author_id: session.practitioner_id || session.sub,
    body: text,
  });
  return { note: row };
}

async function saveSoap(env, session, id, body) {
  const payload = {
    clinic_id: staffClinic(session),
    patient_id: id,
    appointment_id: body.appointmentId || body.appointment_id || null,
    practitioner_id: session.practitioner_id || session.sub,
    visit_at: body.visitAt || body.visit_at || nowIso(),
    subjective: body.subjective || null,
    objective: body.objective || null,
    assessment: body.assessment || null,
    plan: body.plan || null,
    updated_at: nowIso(),
  };
  if (body.id) {
    const row = await patch(env, "chart_notes", qs({ id: `eq.${body.id}` }), payload);
    return { note: row };
  }
  const row = await insert(env, "chart_notes", { id: nid(), ...payload });
  return { note: row };
}

async function addInsurance(env, session, id, body) {
  const carrier = String(body.carrier || "").trim();
  if (!carrier) fail(400, "Carrier is required.");
  const row = await insert(env, "insurances", {
    id: nid(),
    clinic_id: staffClinic(session),
    patient_id: id,
    carrier,
    policy_number: body.policyNumber || body.policy_number || null,
    member_id: body.memberId || body.member_id || null,
    group_number: body.groupNumber || body.group_number || null,
    holder_name: body.holderName || body.holder_name || null,
    relationship: body.relationship || "self",
    phone: body.phone || null,
    is_primary: Boolean(body.isPrimary ?? body.is_primary),
    notes: body.notes || null,
  });
  return { insurance: row };
}

async function addFile(env, session, id, body) {
  const name = String(body.name || "").trim();
  if (!name) fail(400, "File name is required.");
  const content = body.contentBase64 || body.content_base64 || null;
  if (content && String(content).length > 5_500_000) fail(413, "File is too large (max about 4 MB).");
  const row = await insert(env, "patient_files", {
    id: nid(),
    clinic_id: staffClinic(session),
    patient_id: id,
    name,
    mime: body.mime || null,
    size_bytes: body.sizeBytes || body.size_bytes || 0,
    kind: body.kind || "other",
    notes: body.notes || null,
    content_base64: content,
    uploaded_by: session.email || session.name,
  });
  return { file: { ...row, content_base64: undefined } };
}

async function issueIntake(env, session, id) {
  const token = nid().replace(/-/g, "") + nid().replace(/-/g, "").slice(0, 8);
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  await insert(env, "form_tokens", {
    id: nid(),
    clinic_id: staffClinic(session),
    patient_id: id,
    token,
    purpose: "intake",
    expires_at: expires,
  });
  return { token, expiresAt: expires };
}

async function signConsent(env, session, id, body) {
  const t = await one(env, "consent_templates", qs({ id: `eq.${body.templateId}` }));
  if (!t) fail(404, "Consent template not found.");
  const row = await insert(env, "consent_signatures", {
    id: nid(),
    clinic_id: staffClinic(session),
    patient_id: id,
    appointment_id: body.appointmentId || null,
    template_id: t.id,
    template_version: t.version,
    template_name: t.name,
    signature_data: body.signatureData || null,
    signed_name: body.signedName || session.name,
  });
  return { signature: row };
}

async function listAppointments(env, session, params) {
  const id = staffClinic(session);
  const from = params.get("from") || new Date().toISOString();
  const to = params.get("to");
  let query = `clinic_id=eq.${id}&start_at=gte.${from}&select=*,patients(first_name,last_name),services(name)&order=start_at.asc`;
  if (to) query += `&start_at=lt.${to}`;
  const rows = await many(env, "appointments", query);
  return { appointments: rows.map(shapeAppt) };
}

async function setAppointmentStatus(env, session, id, body) {
  const status = String(body.status || "");
  if (!status) fail(400, "Status is required.");
  const row = await patch(
    env,
    "appointments",
    qs({ id: `eq.${id}`, clinic_id: `eq.${staffClinic(session)}` }),
    { status },
  );
  return { appointment: row };
}

async function listClaims(env, session) {
  const rows = await many(
    env,
    "claims",
    `clinic_id=eq.${staffClinic(session)}&select=*,patients(first_name,last_name),insurances(carrier)&order=created_at.desc`,
  );
  return {
    claims: rows.map((r) => ({
      ...r,
      patient_name: r.patients ? `${r.patients.first_name} ${r.patients.last_name}`.trim() : undefined,
      carrier: r.insurances?.carrier || null,
    })),
  };
}

async function saveClaim(env, session, body) {
  const payload = {
    clinic_id: staffClinic(session),
    patient_id: body.patientId || body.patient_id,
    appointment_id: body.appointmentId || body.appointment_id || null,
    insurance_id: body.insuranceId || body.insurance_id || null,
    service_id: body.serviceId || body.service_id || null,
    service_code: body.serviceCode || body.service_code || null,
    description: body.description || null,
    amount_cents: Number(body.amountCents ?? body.amount_cents ?? 0),
    status: body.status || "draft",
    claim_number: body.claimNumber || body.claim_number || null,
    submitted_at: body.status === "submitted" ? nowIso() : body.submitted_at || null,
    notes: body.notes || null,
    updated_at: nowIso(),
  };
  if (!payload.patient_id) fail(400, "Patient is required.");
  if (body.id) {
    const row = await patch(env, "claims", qs({ id: `eq.${body.id}` }), payload);
    return { claim: row };
  }
  const row = await insert(env, "claims", { id: nid(), ...payload });
  return { claim: row };
}

async function calendar(env, session, params) {
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) fail(400, "from and to are required.");
  const appts = await many(
    env,
    "appointments",
    `clinic_id=eq.${staffClinic(session)}&start_at=gte.${from}&start_at=lt.${to}&select=*,patients(first_name,last_name),services(name)&order=start_at.asc`,
  );
  const blocks = await many(
    env,
    "calendar_blocks",
    `clinic_id=eq.${staffClinic(session)}&start_at=gte.${from}&start_at=lt.${to}&order=start_at.asc`,
  );
  return { appointments: appts.map(shapeAppt), blocks };
}

async function listServices(env, session) {
  const rows = await many(env, "services", qs({ clinic_id: `eq.${staffClinic(session)}`, order: "sort_order.asc" }));
  return { services: rows };
}

async function saveService(env, session, body) {
  const payload = {
    clinic_id: staffClinic(session),
    name: body.name,
    description: body.description || null,
    duration_minutes: Number(body.durationMinutes ?? body.duration_minutes ?? 60),
    price_cents: Number(body.priceCents ?? body.price_cents ?? 0),
    requires_consent: Boolean(body.requiresConsent ?? body.requires_consent),
    is_active: body.isActive ?? body.is_active ?? true,
    sort_order: Number(body.sortOrder ?? body.sort_order ?? 0),
  };
  if (!payload.name) fail(400, "Name is required.");
  if (body.id) {
    const row = await patch(env, "services", qs({ id: `eq.${body.id}` }), payload);
    return { service: row };
  }
  const row = await insert(env, "services", { id: nid(), ...payload });
  return { service: row };
}

async function formLibrary(env, session) {
  const id = staffClinic(session);
  const intakes = await many(env, "intake_templates", qs({ clinic_id: `eq.${id}`, order: "created_at.desc" }));
  const consents = await many(env, "consent_templates", qs({ clinic_id: `eq.${id}`, order: "name.asc" }));
  return { intakes, consents };
}

async function saveConsentTemplate(env, session, body) {
  const payload = {
    clinic_id: staffClinic(session),
    name: body.name,
    slug: body.slug || String(body.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    body: body.body,
    version: Number(body.version || 1),
    service_id: body.serviceId || body.service_id || null,
    is_active: body.isActive ?? true,
  };
  if (!payload.name || !payload.body) fail(400, "Name and body are required.");
  if (body.id) {
    const existing = await one(env, "consent_templates", qs({ id: `eq.${body.id}` }));
    payload.version = Number(existing?.version || 1) + 1;
    const row = await patch(env, "consent_templates", qs({ id: `eq.${body.id}` }), payload);
    return { template: row };
  }
  const row = await insert(env, "consent_templates", { id: nid(), ...payload });
  return { template: row };
}

async function saveSettings(env, session, body) {
  const row = await patch(env, "clinics", qs({ id: `eq.${staffClinic(session)}` }), {
    name: body.name,
    tagline: body.tagline,
    phone: body.phone,
    email: body.email,
    address: body.address,
    city: body.city,
    province: body.province,
    postal_code: body.postalCode || body.postal_code,
    timezone: body.timezone,
    cal_embed_url: body.calEmbedUrl || body.cal_embed_url,
    google_calendar_id: body.googleCalendarId || body.google_calendar_id,
  });
  return { clinic: row };
}

async function desk(env, session) {
  const id = staffClinic(session);
  const [inquiries, conversations, waitlist, invoices, labs, tasks, inventory] = await Promise.all([
    many(env, "inquiries", qs({ clinic_id: `eq.${id}`, order: "created_at.desc", limit: "50" })),
    many(
      env,
      "conversations",
      `clinic_id=eq.${id}&select=*,patients(first_name,last_name)&order=last_message_at.desc&limit=40`,
    ),
    many(env, "waitlist", `clinic_id=eq.${id}&select=*,services(name)&order=created_at.desc`),
    many(
      env,
      "invoices",
      `clinic_id=eq.${id}&select=*,patients(first_name,last_name)&order=created_at.desc&limit=50`,
    ),
    many(
      env,
      "lab_orders",
      `clinic_id=eq.${id}&select=*,patients(first_name,last_name)&order=ordered_at.desc&limit=40`,
    ),
    many(env, "tasks", qs({ clinic_id: `eq.${id}`, order: "due_at.asc.nullslast", limit: "40" })),
    many(env, "inventory_items", qs({ clinic_id: `eq.${id}`, order: "name.asc" })),
  ]);
  return {
    inquiries,
    conversations: conversations.map((c) => ({
      ...c,
      patient_name: c.patients ? `${c.patients.first_name} ${c.patients.last_name}`.trim() : undefined,
    })),
    waitlist: waitlist.map((w) => ({ ...w, service_name: w.services?.name || null })),
    invoices: invoices.map((i) => ({
      ...i,
      patient_name: i.patients ? `${i.patients.first_name} ${i.patients.last_name}`.trim() : undefined,
    })),
    labs: labs.map((l) => ({
      ...l,
      patient_name: l.patients ? `${l.patients.first_name} ${l.patients.last_name}`.trim() : undefined,
    })),
    tasks,
    inventory,
  };
}

async function setInquiry(env, session, id, body) {
  const row = await patch(
    env,
    "inquiries",
    qs({ id: `eq.${id}`, clinic_id: `eq.${staffClinic(session)}` }),
    { status: body.status || "read" },
  );
  return { inquiry: row };
}

async function getThread(env, session, id) {
  const conv = await one(env, "conversations", qs({ id: `eq.${id}`, clinic_id: `eq.${staffClinic(session)}` }));
  if (!conv) fail(404, "Conversation not found.");
  const messages = await many(env, "messages", qs({ conversation_id: `eq.${id}`, order: "created_at.asc" }));
  return { conversation: conv, messages };
}

async function replyThread(env, session, id, body) {
  const text = String(body.body || "").trim();
  if (!text) fail(400, "Message is required.");
  await insert(env, "messages", {
    id: nid(),
    clinic_id: staffClinic(session),
    conversation_id: id,
    author_kind: "staff",
    author_id: session.practitioner_id || session.sub,
    body: text,
  });
  await patch(env, "conversations", qs({ id: `eq.${id}` }), { last_message_at: nowIso(), status: "open" });
  return { ok: true };
}

async function setWaitlist(env, session, id, body) {
  const row = await patch(
    env,
    "waitlist",
    qs({ id: `eq.${id}`, clinic_id: `eq.${staffClinic(session)}` }),
    { status: body.status || "closed" },
  );
  return { entry: row };
}

async function addTask(env, session, body) {
  const title = String(body.title || "").trim();
  if (!title) fail(400, "Title is required.");
  const row = await insert(env, "tasks", {
    id: nid(),
    clinic_id: staffClinic(session),
    practitioner_id: session.practitioner_id || null,
    patient_id: body.patientId || null,
    title,
    body: body.body || null,
    due_at: body.dueAt || body.due_at || null,
    status: "open",
  });
  return { task: row };
}

async function setTask(env, session, id, body) {
  const row = await patch(
    env,
    "tasks",
    qs({ id: `eq.${id}`, clinic_id: `eq.${staffClinic(session)}` }),
    { status: body.status || "done" },
  );
  return { task: row };
}

async function markPaid(env, session, id) {
  const inv = await one(env, "invoices", qs({ id: `eq.${id}`, clinic_id: `eq.${staffClinic(session)}` }));
  if (!inv) fail(404, "Invoice not found.");
  await patch(env, "invoices", qs({ id: `eq.${id}` }), { status: "paid", paid_at: nowIso() });
  await insert(env, "payments", {
    id: nid(),
    clinic_id: staffClinic(session),
    invoice_id: id,
    patient_id: inv.patient_id,
    amount_cents: inv.total_cents,
    method: "card",
    status: "succeeded",
    processor: "manual",
  });
  return { ok: true };
}

async function listConnectors(env, session) {
  const id = staffClinic(session);
  const connectors = await many(env, "clinic_connectors", qs({ clinic_id: `eq.${id}`, order: "label.asc" }));
  const events = await many(env, "connector_events", qs({ clinic_id: `eq.${id}`, order: "created_at.desc", limit: "20" }));
  const clinic = await one(env, "clinics", qs({ id: `eq.${id}`, select: "cal_embed_url,google_calendar_id" }));
  return { clinic, connectors, events };
}

async function saveConnector(env, session, kind, body) {
  const id = staffClinic(session);
  const config = body.config || {};
  const status = body.status || "connected";
  await patch(env, "clinic_connectors", qs({ clinic_id: `eq.${id}`, kind: `eq.${kind}` }), {
    config,
    status,
    external_id: body.externalId || body.external_id || null,
    last_error: null,
    updated_at: nowIso(),
  });
  if (kind === "calcom") {
    await patch(env, "clinics", qs({ id: `eq.${id}` }), { cal_embed_url: config.embed_url || null });
  }
  if (kind === "google_calendar") {
    await patch(env, "clinics", qs({ id: `eq.${id}` }), {
      google_calendar_id: body.externalId || config.calendar_id || null,
    });
  }
  const conn = await one(env, "clinic_connectors", qs({ clinic_id: `eq.${id}`, kind: `eq.${kind}` }));
  if (conn) {
    await insert(env, "connector_events", {
      id: nid(),
      clinic_id: id,
      connector_id: conn.id,
      event_type: "config",
      summary: `${kind} updated`,
      payload: config,
    });
  }
  return { ok: true, connector: conn };
}

async function calcomWebhook(env, request) {
  const secret = env.CALCOM_WEBHOOK_SECRET;
  if (secret) {
    const header = request.headers.get("x-cal-signature-256") || request.headers.get("x-webhook-secret") || "";
    if (!timingSafe(header, secret) && header !== secret) fail(401, "Invalid Cal.com signature.");
  }
  const body = await readJson(request);
  const payload = body.payload || body;
  const email = String(payload.attendee?.email || payload.email || payload.responses?.email?.value || "")
    .trim()
    .toLowerCase();
  const start = payload.startTime || payload.start;
  const end = payload.endTime || payload.end;
  const uid = String(payload.uid || payload.bookingId || nid());
  if (!email || !start) return { ok: true, ignored: true };
  const id = clinicId(env);
  let patient = await one(env, "patients", `clinic_id=eq.${id}&email=ilike.${encodeURIComponent(email)}&select=id`);
  if (!patient) {
    const name = String(payload.attendee?.name || payload.name || "Patient").trim();
    const [first, ...rest] = name.split(" ");
    patient = await insert(env, "patients", {
      id: nid(),
      clinic_id: id,
      first_name: first || "Patient",
      last_name: rest.join(" ") || "Cal.com",
      email,
      phone: String(payload.attendee?.phone || payload.responses?.phone?.value || "0000000000"),
    });
  }
  const existing = await one(env, "appointments", qs({ cal_event_uid: `eq.${uid}` }));
  const trigger = String(body.triggerEvent || body.type || "").toLowerCase();
  if (trigger.includes("cancel") && existing) {
    await patch(env, "appointments", qs({ id: `eq.${existing.id}` }), { status: "cancelled" });
    return { ok: true, cancelled: existing.id };
  }
  const services = await many(env, "services", qs({ clinic_id: `eq.${id}`, is_active: "eq.true", order: "sort_order.asc", limit: "1" }));
  if (existing) {
    await patch(env, "appointments", qs({ id: `eq.${existing.id}` }), {
      start_at: new Date(start).toISOString(),
      end_at: new Date(end || start).toISOString(),
      status: "booked",
    });
    return { ok: true, updated: existing.id };
  }
  const appt = await insert(env, "appointments", {
    id: nid(),
    clinic_id: id,
    patient_id: patient.id,
    service_id: services[0]?.id,
    start_at: new Date(start).toISOString(),
    end_at: new Date(end || start).toISOString(),
    status: "booked",
    source: "calcom",
    cal_event_uid: uid,
  });
  return { ok: true, appointmentId: appt.id };
}
