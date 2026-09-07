const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function apiUrl(path) {
  return window.ONIZ.api.replace(/\/$/, "") + path;
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const token = localStorage.getItem("oniz_token");
  if (opts.auth !== false && token) headers.Authorization = "Bearer " + token;
  const res = await fetch(apiUrl(path), {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }
  if (!res.ok) throw new Error((data && data.error) || res.statusText || "Request failed");
  return data;
}

function money(cents) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format((cents || 0) / 100);
}

function formatWhen(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: window.ONIZ.tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatDay(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: window.ONIZ.tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function formatTime(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: window.ONIZ.tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function ymdInZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: window.ONIZ.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysYmd(ymd, days) {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + days);
  return ymdInZone(d);
}

function toast(msg, kind) {
  document.querySelectorAll(".toast").forEach((n) => n.remove());
  const el = document.createElement("div");
  el.className = "toast" + (kind === "err" ? " err" : "");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function setSession(data) {
  if (data && data.token) {
    localStorage.setItem("oniz_token", data.token);
    localStorage.setItem("oniz_role", data.role || "");
    localStorage.setItem("oniz_name", data.name || "");
  } else {
    localStorage.removeItem("oniz_token");
    localStorage.removeItem("oniz_role");
    localStorage.removeItem("oniz_name");
  }
}

function session() {
  return {
    token: localStorage.getItem("oniz_token"),
    role: localStorage.getItem("oniz_role"),
    name: localStorage.getItem("oniz_name"),
  };
}

function requireRole(role, loginHref) {
  const s = session();
  if (!s.token || (role && s.role !== role)) {
    location.href = loginHref || "login.html";
    return false;
  }
  return true;
}

function mark(size) {
  const s = size || 32;
  return `<svg viewBox="0 0 32 32" width="${s}" height="${s}" aria-hidden="true" style="color:var(--sage);flex-shrink:0">
    <circle cx="16" cy="16" r="15" fill="currentColor" opacity="0.12"></circle>
    <path d="M16 6.5c.4 4.2 2.6 7 6.8 8.2C18.6 16 16.4 18.8 16 23c-.4-4.2-2.6-7-6.8-8.3C13.4 13.5 15.6 10.7 16 6.5Z" fill="currentColor"></path>
  </svg>`;
}

function wordmark() {
  return `<span class="wordmark">${mark(32)}<span><strong>Oniz</strong><small>Health & Wellness</small></span></span>`;
}

function headerNav() {
  const s = session();
  const auth = s.token
    ? `<a href="${s.role === "staff" ? "portal.html" : "care.html"}">${s.role === "staff" ? "Portal" : "My care"}</a>
       <button class="link" type="button" id="signout">Sign out</button>`
    : `<a href="login.html">My care</a>
       <a class="btn btn-primary" href="book.html">Book a visit</a>`;
  return `<header class="site-header"><div class="wrap bar">
    <a href="index.html" aria-label="Oniz Health and Wellness home">${wordmark()}</a>
    <nav class="nav">
      <a class="hide-sm" href="index.html#services">Services</a>
      <a class="hide-sm" href="contact.html">Contact</a>
      ${auth}
    </nav>
  </div></header>`;
}

function footerNav() {
  return `<footer class="site-footer"><div class="wrap grid">
    <div>${wordmark()}<p class="muted" style="margin-top:0.75rem">Root-cause care for a quieter body. Queen Street East, Brampton.</p></div>
    <div>
      <p class="kicker">Visit</p>
      <p style="margin-top:0.6rem">84 Queen Street East<br>Brampton, ON L6V 1A1</p>
      <p style="margin-top:0.6rem"><a href="tel:+19055550148">${window.ONIZ.phone}</a></p>
    </div>
    <div>
      <p class="kicker">Desk</p>
      <p style="margin-top:0.6rem"><a href="mailto:${window.ONIZ.email}">${window.ONIZ.email}</a></p>
      <p style="margin-top:0.6rem"><a href="book.html">Book a visit</a></p>
      <p style="margin-top:0.4rem"><a href="login.html">Practitioner portal</a></p>
    </div>
  </div></footer>`;
}

function mountChrome() {
  const h = qs("[data-header]");
  const f = qs("[data-footer]");
  if (h) h.outerHTML = headerNav();
  if (f) f.outerHTML = footerNav();
  const out = qs("#signout");
  if (out) out.addEventListener("click", () => { setSession(null); location.href = "index.html"; });
}

document.addEventListener("DOMContentLoaded", mountChrome);
