const token = new URLSearchParams(location.search).get("token") || "";
const form = qs("#intake-form");

function fieldHtml(f) {
  const req = f.required ? "required" : "";
  if (f.type === "textarea") {
    return `<label>${f.label}<textarea name="${f.id}" ${req}></textarea></label>`;
  }
  if (f.type === "select") {
    const opts = (f.options || []).map((o) => `<option>${o}</option>`).join("");
    return `<label>${f.label}<select name="${f.id}" ${req}><option value=""></option>${opts}</select></label>`;
  }
  if (f.type === "yesno") {
    return `<label>${f.label}<select name="${f.id}" ${req}><option value=""></option><option>Yes</option><option>No</option></select></label>`;
  }
  if (f.type === "checkboxes") {
    return `<fieldset><legend>${f.label}</legend>${(f.options || []).map((o) =>
      `<label style="font-weight:400"><input type="checkbox" name="${f.id}" value="${o}" /> ${o}</label>`
    ).join("")}</fieldset>`;
  }
  return `<label>${f.label}<input name="${f.id}" ${req} /></label>`;
}

async function setup() {
  if (!token) {
    qs("#status").textContent = "This intake link is missing a token.";
    return;
  }
  try {
    const data = await api("/api/intake?token=" + encodeURIComponent(token), { auth: false });
    qs("#who").textContent = `${data.patient.first_name} ${data.patient.last_name}` +
      (data.appointment ? ` · ${data.appointment.serviceName}` : "");
    const sections = (data.template && data.template.schema && data.template.schema.sections) || [];
    let html = "";
    for (const sec of sections) {
      html += `<h2 style="margin-top:0.5rem">${sec.title}</h2>`;
      html += (sec.fields || []).map(fieldHtml).join("");
    }
    html += `<h2>Consents</h2>`;
    for (const c of data.consents || []) {
      html += `<article class="notice"><h3>${c.name}</h3><p class="muted" style="white-space:pre-wrap;margin-top:0.6rem">${c.body}</p>
        <label style="margin-top:0.8rem">Type your name to sign
          <input name="consent:${c.id}" placeholder="Full name" />
        </label></article>`;
    }
    html += `<button class="btn btn-primary" type="submit">Submit intake</button>`;
    form.innerHTML = html;
  } catch (err) {
    qs("#status").innerHTML = `<span class="danger">${err.message}</span>`;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const answers = {};
  const consents = [];
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("consent:")) {
      if (String(v).trim()) consents.push({ templateId: k.slice(8), signedName: String(v).trim() });
      continue;
    }
    if (answers[k]) {
      answers[k] = [].concat(answers[k], v);
    } else {
      answers[k] = v;
    }
  }
  const btn = form.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    await api("/api/intake", { method: "POST", auth: false, body: { token, answers, consents } });
    form.hidden = true;
    qs("#status").innerHTML = `<p class="ok">Received. Your practitioner will review this before you arrive.</p>`;
  } catch (err) {
    toast(err.message, "err");
    btn.disabled = false;
  }
});

setup();
