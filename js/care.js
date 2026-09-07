if (!requireRole("patient", "login.html?next=care")) throw new Error("redirect");

api("/api/care").then((d) => {
  if (!d.linked) {
    qs("#care").innerHTML = `<p class="kicker">My care</p><h1>No chart yet</h1>
      <p class="lead">Book a visit with the same email and you can open this page after.</p>
      <p style="margin-top:1rem"><a class="btn btn-primary" href="book.html">Book a visit</a></p>`;
    return;
  }
  const p = d.patient;
  qs("#care").innerHTML = `
    <p class="kicker">My care</p>
    <h1>${p.first_name} ${p.last_name}</h1>
    <p class="muted" style="margin-top:0.4rem">${d.clinic?.name || "Oniz Health and Wellness"}</p>
    <h2 style="margin-top:2rem">Visits</h2>
    ${(d.visits || []).map((v) => `<p>${formatWhen(v.start_at)} · ${v.services?.name || ""} · ${v.status}</p>`).join("") || "<p class='muted'>No visits yet.</p>"}
    <h2 style="margin-top:2rem">Invoices</h2>
    ${(d.invoices || []).map((i) => `<p>${i.number} · ${money(i.total_cents)} · ${i.status}</p>`).join("") || "<p class='muted'>None.</p>"}
    <h2 style="margin-top:2rem">Plans</h2>
    ${(d.plans || []).map((pl) => `<article class="notice" style="margin-top:0.6rem"><strong>${pl.title}</strong><p class="muted">${pl.body}</p></article>`).join("") || "<p class='muted'>Your plan will appear after a visit.</p>"}
    <h2 style="margin-top:2rem">Message the clinic</h2>
    <form class="form" id="msg-form">
      <label>Message<textarea name="body" required></textarea></label>
      <button class="btn btn-primary" type="submit">Send</button>
    </form>`;
  qs("#msg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/care/messages", { method: "POST", body: { body: new FormData(e.target).get("body") } });
      toast("Message sent");
      e.target.reset();
    } catch (err) { toast(err.message, "err"); }
  });
}).catch((err) => {
  if (/sign in/i.test(err.message)) {
    setSession(null);
    location.href = "login.html";
    return;
  }
  qs("#care").innerHTML = `<p class="danger">${err.message}</p>`;
});
