if (!requireRole("staff", "login.html")) throw new Error("redirect");

qs("#side-mark").innerHTML = wordmark();
if (qs("#staff-label")) qs("#staff-label").textContent = session().staffRole === "owner" ? "Owner" : "Practitioner";
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
  const qSafe = String(q).replace(/[<>&"]/g, "");
  const d = await api("/api/portal/patients" + (q ? `?q=${encodeURIComponent(q)}` : ""));
  qs("#view").innerHTML = `
    <p class="kicker">Roster</p>
    <h1>Patients</h1>
    <form id="search" class="row-2" style="margin-top:1rem;max-width:28rem">
      <input name="q" placeholder="Search name, email, phone" value="${qSafe}" />
      <button class="btn btn-ghost" type="submit">Search</button>
    </form>
    <form class="form notice" id="add-patient" style="margin-top:1.25rem">
      <h3>Add patient</h3>
      <div class="row-2">
        <label>First name<input name="firstName" required autocomplete="given-name" /></label>
        <label>Last name<input name="lastName" required autocomplete="family-name" /></label>
      </div>
      <div class="row-2">
        <label>Email<input name="email" type="email" required autocomplete="email" /></label>
        <label>Phone<input name="phone" required autocomplete="tel" /></label>
      </div>
      <label>Date of birth<input name="dateOfBirth" type="date" /></label>
      <button class="btn btn-primary" type="submit">Save patient</button>
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
  qs("#add-patient").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const res = await api("/api/portal/patients", {
        method: "POST",
        body: {
          firstName: fd.get("firstName"),
          lastName: fd.get("lastName"),
          email: fd.get("email"),
          phone: fd.get("phone"),
          dateOfBirth: fd.get("dateOfBirth") || null,
        },
      });
      toast("Patient saved");
      location.hash = "chart/" + res.patient.id;
    } catch (err) {
      toast(err.message, "err");
      btn.disabled = false;
    }
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
  const forms = await api("/api/portal/forms").catch(() => ({ intake: null, soap: null, consents: [] }));
  const panes = {
    visits: () => apptTable(d.visits),
    soap: () => soapPane(d.soap, id, forms.soap),
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

function soapPane(notes, id, soapTmpl) {
  const schema = soapTmpl && soapTmpl.schema_json ? soapTmpl.schema_json : {
    sections: [
      { title: "SOAP", fields: [
        { id: "subjective", label: "Subjective", type: "textarea" },
        { id: "objective", label: "Objective", type: "textarea" },
        { id: "assessment", label: "Assessment", type: "textarea" },
        { id: "plan", label: "Plan", type: "textarea" },
      ] },
    ],
  };
  const list = (notes || []).map((n) => `<article class="notice" style="margin-top:0.8rem">
    <p class="muted">${formatWhen(n.visit_at)}</p>
    <p><strong>S</strong> ${n.subjective || "—"}</p>
    <p><strong>O</strong> ${n.objective || "—"}</p>
    <p><strong>A</strong> ${n.assessment || "—"}</p>
    <p><strong>P</strong> ${n.plan || "—"}</p>
  </article>`).join("") || empty("No SOAP notes yet.");
  let fields = "";
  for (const sec of schema.sections || []) {
    fields += `<h3>${sec.title || ""}</h3>` + (sec.fields || []).map(fieldInput).join("");
  }
  return list + `<form class="form" id="soap-form" style="margin-top:1.25rem">
    <h3>New note${soapTmpl ? " · v" + soapTmpl.version : ""}</h3>
    ${fields}
    <button class="btn btn-primary" type="submit">Save SOAP</button>
  </form>`;
}

function fieldInput(f) {
  const req = f.required ? "required" : "";
  const id = f.id || "field";
  const label = f.label || id;
  if (f.type === "textarea") return `<label>${label}<textarea name="${id}" ${req}></textarea></label>`;
  if (f.type === "select") {
    const opts = ["<option value=''></option>"].concat((f.options || []).map((o) => `<option>${o}</option>`)).join("");
    return `<label>${label}<select name="${id}" ${req}>${opts}</select></label>`;
  }
  if (f.type === "yesno") {
    return `<label>${label}<select name="${id}" ${req}><option value=""></option><option>Yes</option><option>No</option></select></label>`;
  }
  if (f.type === "checkboxes") {
    return `<fieldset><legend>${label}</legend>${(f.options || []).map((o) =>
      `<label style="font-weight:400"><input type="checkbox" name="${id}" value="${o}" /> ${o}</label>`
    ).join("")}</fieldset>`;
  }
  if (f.type === "date") return `<label>${label}<input name="${id}" type="date" ${req} /></label>`;
  return `<label>${label}<input name="${id}" ${req} /></label>`;
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
    const answers = {};
    for (const [k, v] of fd.entries()) {
      if (answers[k]) answers[k] = [].concat(answers[k], v);
      else answers[k] = v;
    }
    try {
      await api(`/api/portal/patients/${id}/soap`, {
        method: "POST",
        body: {
          answers,
          subjective: answers.subjective || "",
          objective: answers.objective || "",
          assessment: answers.assessment || "",
          plan: answers.plan || "",
        },
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

async function showCalendar() {
  setTab("calendar");
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 14);
  const d = await api(`/api/portal/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
  qs("#view").innerHTML = `
    <p class="kicker">Schedule</p>
    <h1>Calendar</h1>
    <p class="muted" style="margin-top:0.4rem">Next 14 days</p>
    ${apptTable(d.appointments)}
    <h2 style="margin-top:2rem">Blocks</h2>
    ${(d.blocks || []).map((b) => `<p>${formatWhen(b.start_at)} · ${b.reason || "Blocked"}</p>`).join("") || empty("No blocks.")}`;
}

async function showForms() {
  setTab("forms");
  const d = await api("/api/portal/forms");
  const services = await api("/api/portal/services").catch(() => ({ services: [] }));
  const state = {
    pane: "intake",
    intake: parseSchema(d.intake && d.intake.schema_json, defaultIntakeSchema()),
    soap: parseSchema(d.soap && d.soap.schema_json, defaultSoapSchema()),
    intakeName: (d.intake && d.intake.name) || "Clinic intake",
    soapName: (d.soap && d.soap.name) || "SOAP note",
    intakeVer: d.intake ? d.intake.version : 0,
    soapVer: d.soap ? d.soap.version : 0,
    consents: d.consents || [],
    services: services.services || [],
    consentEdit: null,
  };

  function draw() {
    qs("#view").innerHTML = `
      <p class="kicker">Library</p>
      <h1>Form builders</h1>
      <p class="muted" style="margin-top:0.4rem">One intake · one SOAP template · as many consents as you need. Saving bumps the version; old submissions stay as they were.</p>
      <div class="tabs" id="form-tabs" style="margin-top:1.25rem">
        <button type="button" data-pane="intake"${state.pane === "intake" ? " class='is-on'" : ""}>Intake</button>
        <button type="button" data-pane="soap"${state.pane === "soap" ? " class='is-on'" : ""}>SOAP</button>
        <button type="button" data-pane="consents"${state.pane === "consents" ? " class='is-on'" : ""}>Consents</button>
      </div>
      <div id="form-pane"></div>`;
    qsa("#form-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => { state.pane = btn.dataset.pane; draw(); });
    });
    const pane = qs("#form-pane");
    if (state.pane === "consents") drawConsents(pane);
    else drawBuilder(pane, state.pane);
  }

  function drawBuilder(pane, kind) {
    const schema = kind === "soap" ? state.soap : state.intake;
    const name = kind === "soap" ? state.soapName : state.intakeName;
    const ver = kind === "soap" ? state.soapVer : state.intakeVer;
    pane.innerHTML = `
      <p class="muted">${kind === "soap" ? "Used when you write a chart note." : "Sent to the patient after a booking."} ${ver ? "Current version " + ver + "." : "Not saved yet."}</p>
      <label style="margin-top:1rem">Template name<input id="tmpl-name" value="${esc(name)}" /></label>
      <div id="sec-list"></div>
      <p style="margin-top:1rem;display:flex;gap:0.6rem;flex-wrap:wrap">
        <button class="btn btn-ghost" type="button" id="add-sec">Add section</button>
        <button class="btn btn-primary" type="button" id="save-tmpl">Save ${kind === "soap" ? "SOAP" : "intake"} template</button>
      </p>`;
    qs("#sec-list").innerHTML = schema.sections.map((sec, si) => sectionCard(sec, si, kind)).join("");
    bindBuilder(kind);
  }

  function sectionCard(sec, si, kind) {
    return `<article class="notice" data-sec="${si}" style="margin-top:1rem">
      <div class="row-2">
        <label>Section title<input data-k="title" value="${esc(sec.title)}" /></label>
        <p style="align-self:end"><button class="btn btn-ghost" type="button" data-del-sec="${si}">Remove section</button></p>
      </div>
      ${(sec.fields || []).map((f, fi) => fieldCard(f, si, fi)).join("")}
      <button class="btn btn-ghost" type="button" data-add-field="${si}" style="margin-top:0.6rem">Add field</button>
    </article>`;
  }

  function fieldCard(f, si, fi) {
    const types = [
      ["text", "Short text"],
      ["textarea", "Long text"],
      ["select", "Dropdown"],
      ["yesno", "Yes / No"],
      ["checkboxes", "Checkboxes"],
      ["date", "Date"],
    ];
    const opts = (f.options || []).join(", ");
    const needOpts = f.type === "select" || f.type === "checkboxes";
    return `<div class="notice" data-field="${si}-${fi}" style="margin-top:0.7rem;padding:0.9rem">
      <div class="row-2">
        <label>Question<input data-k="label" value="${esc(f.label)}" /></label>
        <label>Type<select data-k="type">${types.map(([v, l]) =>
          `<option value="${v}"${f.type === v ? " selected" : ""}>${l}</option>`
        ).join("")}</select></label>
      </div>
      <label${needOpts ? "" : " hidden"}>Choices (comma separated)<input data-k="options" value="${esc(opts)}" /></label>
      <label style="flex-direction:row;align-items:center;gap:0.5rem;margin-top:0.4rem">
        <input type="checkbox" data-k="required"${f.required ? " checked" : ""} /> Required
      </label>
      <button class="btn btn-ghost" type="button" data-del-field="${si}-${fi}">Remove field</button>
    </div>`;
  }

  function readBuilder(kind) {
    const schema = kind === "soap" ? state.soap : state.intake;
    const nameEl = qs("#tmpl-name");
    if (kind === "soap") state.soapName = nameEl.value.trim() || "SOAP note";
    else state.intakeName = nameEl.value.trim() || "Clinic intake";
    qsa("[data-sec]").forEach((wrap) => {
      const si = Number(wrap.dataset.sec);
      const title = wrap.querySelector('[data-k="title"]');
      if (schema.sections[si] && title) schema.sections[si].title = title.value.trim() || "Section";
    });
    qsa("[data-field]").forEach((wrap) => {
      const [si, fi] = wrap.dataset.field.split("-").map(Number);
      const field = schema.sections[si] && schema.sections[si].fields[fi];
      if (!field) return;
      const label = wrap.querySelector('[data-k="label"]');
      const type = wrap.querySelector('[data-k="type"]');
      const options = wrap.querySelector('[data-k="options"]');
      const req = wrap.querySelector('[data-k="required"]');
      if (label) field.label = label.value.trim() || "Field";
      if (type) field.type = type.value;
      if (options) field.options = options.value.split(",").map((s) => s.trim()).filter(Boolean);
      if (req) field.required = req.checked;
    });
  }

  function bindBuilder(kind) {
    const schema = () => (kind === "soap" ? state.soap : state.intake);
    qs("#add-sec").addEventListener("click", () => {
      readBuilder(kind);
      schema().sections.push({ id: nid(), title: "New section", fields: [] });
      draw();
    });
    qsa("[data-add-field]").forEach((btn) => {
      btn.addEventListener("click", () => {
        readBuilder(kind);
        const si = Number(btn.dataset.addField);
        schema().sections[si].fields.push({
          id: nid(), label: "New question", type: "textarea", required: false, options: [],
        });
        draw();
      });
    });
    qsa("[data-del-sec]").forEach((btn) => {
      btn.addEventListener("click", () => {
        readBuilder(kind);
        schema().sections.splice(Number(btn.dataset.delSec), 1);
        draw();
      });
    });
    qsa("[data-del-field]").forEach((btn) => {
      btn.addEventListener("click", () => {
        readBuilder(kind);
        const [si, fi] = btn.dataset.delField.split("-").map(Number);
        schema().sections[si].fields.splice(fi, 1);
        draw();
      });
    });
    qsa('[data-k="type"]').forEach((sel) => {
      sel.addEventListener("change", () => { readBuilder(kind); draw(); });
    });
    qs("#save-tmpl").addEventListener("click", async () => {
      readBuilder(kind);
      const path = kind === "soap" ? "/api/portal/forms/soap" : "/api/portal/forms/intake";
      try {
        const res = await api(path, {
          method: "POST",
          body: {
            name: kind === "soap" ? state.soapName : state.intakeName,
            schema: kind === "soap" ? state.soap : state.intake,
          },
        });
        if (kind === "soap") state.soapVer = res.template.version;
        else state.intakeVer = res.template.version;
        toast("Template saved as version " + res.template.version);
      } catch (err) { toast(err.message, "err"); }
    });
  }

  function drawConsents(pane) {
    const edit = state.consentEdit;
    pane.innerHTML = `
      ${(state.consents).map((c) => `<article class="notice" style="margin-top:0.7rem">
        <strong>${esc(c.name)}</strong> · v${c.version} · ${c.is_active ? "active" : "off"}
        <p class="muted" style="white-space:pre-wrap;margin-top:0.4rem">${esc((c.body || "").slice(0, 220))}</p>
        <button class="btn btn-ghost" type="button" data-edit-c="${c.id}">Edit</button>
      </article>`).join("") || empty("No consent forms yet.")}
      <form class="form" id="consent-form" style="margin-top:1.5rem">
        <h3>${edit ? "Edit consent" : "Add consent"}</h3>
        <input type="hidden" name="id" value="${edit ? edit.id : ""}" />
        <label>Name<input name="name" required value="${edit ? esc(edit.name) : ""}" /></label>
        <label>Linked service
          <select name="serviceId">
            <option value="">All visits</option>
            ${state.services.map((s) => `<option value="${s.id}"${edit && edit.service_id === s.id ? " selected" : ""}>${esc(s.name)}</option>`).join("")}
          </select>
        </label>
        <label>Consent text<textarea name="body" required>${edit ? esc(edit.body) : ""}</textarea></label>
        <button class="btn btn-primary" type="submit">${edit ? "Save new version" : "Add consent"}</button>
      </form>`;
    qsa("[data-edit-c]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.consentEdit = state.consents.find((c) => c.id === btn.dataset.editC) || null;
        draw();
      });
    });
    qs("#consent-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api("/api/portal/forms/consents", {
          method: "POST",
          body: {
            id: fd.get("id") || undefined,
            name: fd.get("name"),
            body: fd.get("body"),
            serviceId: fd.get("serviceId") || null,
          },
        });
        toast("Consent saved");
        state.consentEdit = null;
        showForms();
      } catch (err) { toast(err.message, "err"); }
    });
  }

  draw();
}

function parseSchema(raw, fallback) {
  let v = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { v = null; }
  }
  if (!v || !Array.isArray(v.sections) || !v.sections.length) return fallback;
  return {
    sections: v.sections.map((s) => ({
      id: s.id || nid(),
      title: s.title || "Section",
      fields: (s.fields || []).map((f) => ({
        id: f.id || nid(),
        label: f.label || "Field",
        type: f.type || "text",
        required: Boolean(f.required),
        options: f.options || [],
      })),
    })),
  };
}

function defaultIntakeSchema() {
  return { sections: [{ id: "s1", title: "This visit", fields: [
    { id: "reason", label: "What is the main reason for your visit?", type: "textarea", required: true, options: [] },
    { id: "goals", label: "What would you like to change in the next 90 days?", type: "textarea", required: true, options: [] },
  ] }] };
}

function defaultSoapSchema() {
  return { sections: [
    { id: "s", title: "Subjective", fields: [{ id: "subjective", label: "Subjective — what the patient reports", type: "textarea", required: true, options: [] }] },
    { id: "o", title: "Objective", fields: [{ id: "objective", label: "Objective — findings and vitals", type: "textarea", required: true, options: [] }] },
    { id: "a", title: "Assessment", fields: [{ id: "assessment", label: "Assessment", type: "textarea", required: true, options: [] }] },
    { id: "p", title: "Plan", fields: [{ id: "plan", label: "Plan and recommendations", type: "textarea", required: true, options: [] }] },
  ] };
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&#38;")
    .replace(/</g, "&#60;")
    .replace(/>/g, "&#62;")
    .replace(/"/g, "&#34;");
}

function nid() {
  return "id-" + Math.random().toString(36).slice(2, 10);
}

async function showConnectors() {
  setTab("connectors");
  const d = await api("/api/portal/connectors");
  qs("#view").innerHTML = `
    <p class="kicker">Integrations</p>
    <h1>Connectors</h1>
    ${(d.connectors || []).map((c) => `<article class="notice" style="margin-top:0.7rem">
      <strong>${c.label || c.kind}</strong> · ${c.status}
      <p class="muted" style="margin-top:0.3rem">${c.kind}</p>
    </article>`).join("") || empty("No connectors seeded yet.")}
    <form class="form" id="cal-form" style="margin-top:1.5rem">
      <h3>Cal.com embed</h3>
      <label>Embed URL<input name="embed" value="${d.clinic?.cal_embed_url || ""}" placeholder="https://cal.com/..." /></label>
      <button class="btn btn-ghost" type="submit">Save Cal.com</button>
    </form>`;
  qs("#cal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const embed = new FormData(e.target).get("embed");
    try {
      await api("/api/portal/connectors/calcom", { method: "POST", body: { config: { embed_url: embed }, status: embed ? "connected" : "disconnected" } });
      toast("Cal.com saved");
    } catch (err) { toast(err.message, "err"); }
  });
}

async function showSettings() {
  setTab("settings");
  const clinic = await api("/api/clinic", { auth: false });
  const c = clinic.clinic || clinic;
  qs("#view").innerHTML = `
    <p class="kicker">Clinic</p>
    <h1>Settings</h1>
    <form class="form" id="set-form" style="margin-top:1rem">
      <label>Name<input name="name" value="${c.name || ""}" required /></label>
      <label>Tagline<input name="tagline" value="${c.tagline || ""}" /></label>
      <div class="row-2">
        <label>Phone<input name="phone" value="${c.phone || ""}" /></label>
        <label>Email<input name="email" value="${c.email || ""}" /></label>
      </div>
      <label>Address<input name="address" value="${c.address || ""}" /></label>
      <div class="row-2">
        <label>City<input name="city" value="${c.city || ""}" /></label>
        <label>Postal<input name="postalCode" value="${c.postal_code || ""}" /></label>
      </div>
      <label>Cal.com URL<input name="calEmbedUrl" value="${c.cal_embed_url || ""}" /></label>
      <button class="btn btn-primary" type="submit">Save settings</button>
    </form>
    <h2 style="margin-top:2rem">Services</h2>
    <div id="svc-list"></div>
    <form class="form" id="svc-form" style="margin-top:1rem">
      <h3>Add service</h3>
      <label>Name<input name="name" required /></label>
      <div class="row-2">
        <label>Minutes<input name="durationMinutes" type="number" value="60" /></label>
        <label>Price (CAD)<input name="price" type="number" step="0.01" value="0" /></label>
      </div>
      <button class="btn btn-ghost" type="submit">Add service</button>
    </form>`;
  const services = await api("/api/portal/services");
  qs("#svc-list").innerHTML = (services.services || []).map((s) =>
    `<p>${s.name} · ${s.duration_minutes} min · ${money(s.price_cents)}</p>`
  ).join("") || empty("No services.");
  qs("#set-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/portal/settings", {
        method: "POST",
        body: {
          name: fd.get("name"), tagline: fd.get("tagline"), phone: fd.get("phone"),
          email: fd.get("email"), address: fd.get("address"), city: fd.get("city"),
          postalCode: fd.get("postalCode"), calEmbedUrl: fd.get("calEmbedUrl"),
        },
      });
      toast("Settings saved");
    } catch (err) { toast(err.message, "err"); }
  });
  qs("#svc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/portal/services", {
        method: "POST",
        body: { name: fd.get("name"), durationMinutes: Number(fd.get("durationMinutes")), priceCents: Math.round(Number(fd.get("price")) * 100) },
      });
      toast("Service added");
      showSettings();
    } catch (err) { toast(err.message, "err"); }
  });
}

async function route() {
  const hash = (location.hash || "#today").slice(1);
  try {
    if (hash.startsWith("chart/")) await showChart(hash.slice(6).split("?")[0]);
    else if (hash.startsWith("patients")) await showPatients();
    else if (hash.startsWith("calendar")) await showCalendar();
    else if (hash.startsWith("desk")) await showDesk();
    else if (hash.startsWith("claims")) await showClaims();
    else if (hash.startsWith("forms")) await showForms();
    else if (hash.startsWith("connectors")) await showConnectors();
    else if (hash.startsWith("settings")) await showSettings();
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
