api("/api/clinic", { auth: false }).then((data) => {
  qs("#hours-list").innerHTML = (data.hours || []).map((h) =>
    `<li><span class="muted">${DAYS[h.weekday]}</span><span>${h.is_closed ? "Closed" : `${h.open_time}–${h.close_time}`}</span></li>`
  ).join("");
}).catch(() => {});

qs("#contact-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    await api("/api/contact", {
      method: "POST",
      auth: false,
      body: {
        name: fd.get("name"),
        email: fd.get("email"),
        phone: fd.get("phone"),
        topic: fd.get("topic"),
        message: fd.get("message"),
      },
    });
    toast("Message received. The desk will reply by email.");
    e.target.reset();
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

qs("#news-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/newsletter", {
      method: "POST",
      auth: false,
      body: { email: new FormData(e.target).get("email") },
    });
    toast("You’re on the list.");
    e.target.reset();
  } catch (err) {
    toast(err.message, "err");
  }
});
