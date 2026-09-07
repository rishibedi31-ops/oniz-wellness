if (!requireRole("staff", "login.html")) throw new Error("redirect");

qs("#side-mark").innerHTML = wordmark();
qs("#signout-portal").addEventListener("click", () => { setSession(null); location.href = "index.html"; });
qs("#mobile-nav").innerHTML = qsa(".side nav a").map((a) =>
  `<a href="${a.getAttribute("href")}" data-tab="${a.dataset.tab}">${a.textContent}</a>`
).join("");

let currentPatient = null;

function setTab(name) {
  qsa("[data-tab]").forEach((a) => a.classList.toggle("is-on", a.dataset.tab === name));
}

async function showToday() {
  setTab("today");
  const d = await api("/api/portal/dashboard");
  qs("#view").innerHTML = `
    <p class="kicker">Today</p>
    <h1>Board</h1>
    <p class="muted" style="margin-top:0.5rem">${d.patientCount || 0} patients on file · ${d.openClaims || 0} open claims</p>
    <h2 style="margin-top:2rem">This morning</h2>
    ${apptTable(d.today)}
    <h2 style="margin-top:2rem">Coming up</h2>
    ${apptTable(d.upcoming)}`;
}

function apptTable(rows) {
  const list = rows || [];
  if (!list.length) return `<p class="muted" style="margin-top:0.8rem">Nothing scheduled.</p>`;
  return `<div class="table-wrap" style="margin-top:0.8rem"><table>
    <thead><tr><th>Time</th><th>Patient</th><th>Service</th><th>Status</th></tr></thead>
    <tbody>${list.map((a) => `<tr>
      <td>${formatWhen(a.start_at)}</td>
      <td>${a.patient_name || "—"}</td>
      <td>${a.service_name || ""}</td>
      <td>${a.status}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

async function showPatients() {
  setTab("patients");
  const q = new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "";
  const d = await api("/api/portal/patients" + (q ? `?q=${encodeURIComponent(q)}` : ""));
  qs("#view").innerHTML = `
    <p class="kicker">Roster</p>
    <h1>Patients</h1>
    <form id="search" class="row-2" style="margin-top:1rem;max-width:28rem">
      <input name="q" placeholder="Search name, email, phone" value="${q}" />
      <button class="btn btn-ghost" type="submit">Search</button>
    </form>
    <div class="table-wrap" style="margin-top:1rem"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th></tr></thead>
      <tbody>${(d.patients || []).map((p) => `<tr class="clickable" data-id="${p.id}">
        <td>${p.last_name}, ${p.first_name}</td>
        <td>${p.email}</td>
        <td>${p.phone}</td>
      </tr>`).join("") || `<tr><td colspan="3">No patients yet.</td></tr>`}</tbody>
    </table></div>`;
  qs("#search").addEventListener("submit", (e) => {
    e.preventDefault();
    location.hash = "patients?q=" + encodeURIComponent(new FormData(e.target).get("q") || "");
  });
  qsa("tr.clickable").forEach((row) => {
    row.addEventListener("click", () => { location.hash = "chart/" + row.dataset.id; });
  });
}

async function showChart(id) {
  setTab("chart");
  const d = await api("/api/portal/patients/" + id);
  currentPatient = d.patient;
  const p = d.patient;
  qs("#view").innerHTML = `
    <p class="kicker">Chart</p>
    <h1>${p.first_name} ${p.last_name}</h1>
    <p class="muted" style="margin-top:0.4rem">${p.email} · ${p.phone}${p.alerts ? " · " + p.alerts : ""}</p>
    <div class="tabs" id="chart-tabs">
      <button class="is-on" data-pane="visits">Visits</button>
      <button data-pane="soap">SOAP</button>
      <button data-pane="intake">Intake</button>
      <button data-pane="consents">Consents</button>
      <button data-pane="insurance">Insurance</button>
      <button data-pane="claims">Claims</button>
      <button data-pane="notes">Notes</button>
    </div>
    <div id="pane"></div>`;
  const panes = {
    visits: () => apptTable(d.visits),
    soap: () => soapPane(d.soap, id),
    intake: () => (d.intakes || []).map((i) => `<article class="notice" style="margin-top:0.8rem"><p class="muted">${formatWhen(i.submitted_at)}</p><pre style="white-space:pre-wrap;font:inherit">${JSON.stringify(i.answers_json, null, 2)}</pre></article>`).join("") || empty("No intake yet."),
    consents: () => (d.consents || []).map((c) => `<p>${c.template_name} · ${c.signed_name} · ${formatWhen(c.signed_at)}</p>`).join("") || empty("No signatures."),
    insurance: () => insurancePane(d.insurances, id),
    claims: () => claimsPane(d.claims, id),
    notes: () => notesPane(d.notes, id),
  };
  const render = (name) => { qs("#pane").innerHTML = panes[name](); bindChart(id, d); };
  qsa("#chart-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa("#chart-tabs button").forEach((b) => b.classList.toggle("is-on", b === btn));
      render(btn.dataset.pane);
    });
  });
  render("visits");
}

function empty(t) { return `<p class="muted" style="margin-top:0.8rem">${t}</p>`; }

function soapPane(notes, id) {
  const list = (notes || []).map((n) => `<article class="notice" style="margin-top:0.8rem">
    <p class="muted">${formatWhen(n.visit_at)}</p>
    <p><strong>S</strong> ${n.subjective || "—"}</p>
    <p><strong>O</strong> ${n.objective || "—"}</p>
    <p><strong>A</strong> ${n.assessment || "—"}</p>
    <p><strong>P</strong> ${n.plan || "—"}</p>
  </article>`).join("") || empty("No SOAP notes yet.");
  return list + `<form class="form" id="soap-form" style="margin-top:1.25rem">
    <h3>New note</h3>
    <label>Subjective<textarea name="subjective"></textarea></label>
    <label>Objective<textarea name="objective"></textarea></label>
    <label>Assessment<textarea name="assessment"></textarea></label>
    <label>Plan<textarea name="plan"></textarea></label>
    <button class="btn btn-primary" type="submit">Save SOAP</button>
  </form>`;
}

function notesPane(notes, id) {
  return (notes || []).map((n) => `<p class="notice" style="margin-top:0.6rem">${n.body}<br><span class="faint">${formatWhen(n.created_at)}</span></p>`).join("") +
    `<form class="form" id="note-form" style="margin-top:1rem"><label>Staff note<textarea name="body" required></textarea></label>
     <button class="btn btn-ghost" type="submit">Add note</button></form>`;
}

function insurancePane(rows, id) {
  return `<div class="table-wrap">${(rows || []).length ? `<table><thead><tr><th>Carrier</th><th>Member</th><th></th></tr></thead><tbody>
    ${(rows || []).map((r) => `<tr><td>${r.carrier}${r.is_primary ? " (primary)" : ""}</td><td>${r.member_id || ""}</td><td>${r.policy_number || ""}</td></tr>`).join("")}
    </tbody></table>` : empty("No coverage on file.")}</div>
    <form class="form" id="ins-form" style="margin-top:1rem">
      <div class="row-2">
        <label>Carrier<input name="carrier" required /></label>
        <label>Member ID<input name="memberId" /></label>
      </div>
      <label style="flex-direction:row;align-items:center;gap:0.5rem"><input type="checkbox" name="isPrimary" /> Primary</label>
      <button class="btn btn-ghost" type="submit">Add insurance</button>
    </form>`;
}

function claimsPane(rows, id) {
  return `<div class="table-wrap">${(rows || []).length ? `<table><thead><tr><th>Service</th><th>Amount</th><th>Status</th></tr></thead><tbody>
    ${(rows || []).map((r) => `<tr><td>${r.description || r.service_code || ""}</td><td>${money(r.amount_cents)}</td><td>${r.status}</td></tr>`).join("")}
    </tbody></table>` : empty("No claims.")}</div>
    <form class="form" id="claim-form" style="margin-top:1rem">
      <label>Description<input name="description" required /></label>
      <div class="row-2">
        <label>Amount (CAD)<input name="amount" type="number" step="0.01" required /></label>
        <label>Status<select name="status"><option>draft</option><option>submitted</option><option>pending</option><option>paid</option><option>denied</option></select></label>
      </div>
      <button class="btn btn-ghost" type="submit">Add claim</button>
    </form>`;
}

function bindChart(id, d) {
  const soap = qs("#soap-form");
  if (soap) soap.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(soap);
    try {
      await api(`/api/portal/patients/${id}/soap`, {
        method: "POST",
        body: { subjective: fd.get("subjective"), objective: fd.get("objective"), assessment: fd.get("assessment"), plan: fd.get("plan") },
      });
      toast("SOAP saved");
      showChart(id);
    } catch (err) { toast(err.message, "err"); }
  });
  const note = qs("#note-form");
  if (note) note.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/api/portal/patients/${id}/notes`, { method: "POST", body: { body: new FormData(note).get("body") } });
      toast("Note added");
      showChart(id);
    } catch (err) { toast(err.message, "err"); }
  });
  const ins = qs("#ins-form");
  if (ins) ins.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(ins);
    try {
      await api(`/api/portal/patients/${id}/insurance`, {
        method: "POST",
        body: { carrier: fd.get("carrier"), memberId: fd.get("memberId"), isPrimary: fd.get("isPrimary") === "on" },
      });
      toast("Insurance saved");
      showChart(id);
    } catch (err) { toast(err.message, "err"); }
  });
  const claim = qs("#claim-form");
  if (claim) claim.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(claim);
    try {
      await api("/api/portal/claims", {
        method: "POST",
        body: {
          patientId: id,
          description: fd.get("description"),
          amountCents: Math.round(Number(fd.get("amount")) * 100),
          status: fd.get("status"),
        },
      });
      toast("Claim saved");
      showChart(id);
    } catch (err) { toast(err.message, "err"); }
  });
}

async function showDesk() {
  setTab("desk");
  const d = await api("/api/portal/desk");
  qs("#view").innerHTML = `
    <p class="kicker">Front desk</p>
    <h1>Inbox</h1>
    <h2 style="margin-top:1.5rem">Messages from the site</h2>
    ${(d.inquiries || []).map((i) => `<article class="notice" style="margin-top:0.7rem">
      <strong>${i.name}</strong> · ${i.email} · ${i.topic}
      <p class="muted" style="margin-top:0.4rem">${i.message}</p>
    </article>`).join("") || empty("Inbox is quiet.")}
    <h2 style="margin-top:2rem">Waitlist</h2>
    ${(d.waitlist || []).map((w) => `<p>${w.name} · ${w.email} · ${w.status}</p>`).join("") || empty("Empty.")}
    <h2 style="margin-top:2rem">Tasks</h2>
    ${(d.tasks || []).map((t) => `<p>${t.title} · ${t.status}</p>`).join("") || empty("No tasks.")}`;
}

async function showClaims() {
  setTab("claims");
  const d = await api("/api/portal/claims");
  qs("#view").innerHTML = `
    <p class="kicker">Billing</p>
    <h1>Claims</h1>
    <div class="table-wrap" style="margin-top:1rem"><table>
      <thead><tr><th>Patient</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>${(d.claims || []).map((c) => `<tr>
        <td>${c.patient_name || ""}</td><td>${c.description || ""}</td>
        <td>${money(c.amount_cents)}</td><td>${c.status}</td>
      </tr>`).join("") || `<tr><td colspan="4">No claims.</td></tr>`}</tbody>
    </table></div>`;
}

async function route() {
  const hash = (location.hash || "#today").slice(1);
  try {
    if (hash.startsWith("chart/")) await showChart(hash.slice(6).split("?")[0]);
    else if (hash.startsWith("patients")) await showPatients();
    else if (hash.startsWith("desk")) await showDesk();
    else if (hash.startsWith("claims")) await showClaims();
    else await showToday();
  } catch (err) {
    if (/sign in/i.test(err.message)) {
      setSession(null);
      location.href = "login.html";
      return;
    }
    qs("#view").innerHTML = `<p class="danger">${err.message}</p>`;
  }
}

window.addEventListener("hashchange", route);
route();
