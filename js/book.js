let serviceId = null;
let date = null;
let startAt = null;

function nextOpenDays(count = 12) {
  const out = [];
  let ymd = ymdInZone(new Date());
  for (let i = 0; i < 28 && out.length < count; i += 1) {
    const d = new Date(ymd + "T12:00:00");
    if (d.getDay() !== 0) out.push(ymd);
    ymd = addDaysYmd(ymd, 1);
  }
  return out;
}

async function loadSlots() {
  const box = qs("#slots");
  if (!serviceId || !date) {
    box.innerHTML = `<span class="muted">Choose a service and day.</span>`;
    return;
  }
  box.textContent = "Loading times…";
  try {
    const data = await api(`/api/availability?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`, { auth: false });
    const slots = data.slots || [];
    if (!slots.length) {
      box.innerHTML = `<span class="muted">No openings that day.</span>`;
      return;
    }
    box.innerHTML = slots.map((iso) =>
      `<button type="button" class="chip${startAt === iso ? " is-on" : ""}" data-start="${iso}">${formatTime(iso)}</button>`
    ).join("");
    qsa("#slots .chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        startAt = btn.dataset.start;
        qsa("#slots .chip").forEach((b) => b.classList.toggle("is-on", b === btn));
      });
    });
  } catch (err) {
    box.innerHTML = `<span class="danger">${err.message}</span>`;
  }
}

async function setup() {
  const days = nextOpenDays();
  date = days[0];
  qs("#days").innerHTML = days.map((d, i) =>
    `<button type="button" class="chip${i === 0 ? " is-on" : ""}" data-day="${d}">${formatDay(d + "T12:00:00")}</button>`
  ).join("");
  qsa("#days .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      date = btn.dataset.day;
      startAt = null;
      qsa("#days .chip").forEach((b) => b.classList.toggle("is-on", b === btn));
      loadSlots();
    });
  });

  try {
    const data = await api("/api/clinic", { auth: false });
    qs("#services").innerHTML = (data.services || []).map((s, i) =>
      `<button type="button" class="chip${i === 0 ? " is-on" : ""}" data-id="${s.id}">${s.name} · ${s.duration_minutes} min</button>`
    ).join("");
    if (data.services && data.services[0]) serviceId = data.services[0].id;
    qsa("#services .chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        serviceId = btn.dataset.id;
        startAt = null;
        qsa("#services .chip").forEach((b) => b.classList.toggle("is-on", b === btn));
        loadSlots();
      });
    });
    loadSlots();
  } catch (err) {
    qs("#services").innerHTML = `<p class="danger">${err.message}</p>`;
  }
}

qs("#book-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (!serviceId || !startAt) {
    toast("Choose a service and a time.", "err");
    return;
  }
  const btn = e.target.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    const result = await api("/api/book", {
      method: "POST",
      auth: false,
      body: {
        firstName: fd.get("firstName"),
        lastName: fd.get("lastName"),
        email: fd.get("email"),
        phone: fd.get("phone"),
        serviceId,
        startAt,
      },
    });
    e.target.hidden = true;
    const done = qs("#done");
    done.hidden = false;
    done.innerHTML = `<p class="kicker">Booked</p>
      <h2 style="margin-top:0.5rem">${result.serviceName}</h2>
      <p class="muted" style="margin-top:0.6rem">${formatWhen(result.startAt)}</p>
      <p style="margin-top:1rem">Complete your health history before you arrive.</p>
      <p style="margin-top:1rem"><a class="btn btn-primary" href="intake.html?token=${encodeURIComponent(result.intakeToken)}">Open intake</a></p>`;
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

setup();
