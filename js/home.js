async function loadHome() {
  try {
    const data = await api("/api/clinic", { auth: false });
    const list = qs("#services-list");
    list.innerHTML = (data.services || []).map((s) => `
      <article class="card">
        <h3>${escapeHtml(s.name)}</h3>
        <p>${escapeHtml(s.description || "")}</p>
        <div class="card-meta">
          <span class="muted">${s.duration_minutes} minutes</span>
          <strong>${money(s.price_cents)}</strong>
        </div>
      </article>`).join("") || "<p class='muted'>Services will appear once the Worker can reach Supabase.</p>";

    if (data.practitioner) {
      qs("#prac-name").textContent = data.practitioner.credentials
        ? `${data.practitioner.name}, ${data.practitioner.credentials}`
        : data.practitioner.name;
      if (data.practitioner.bio) qs("#prac-bio").textContent = data.practitioner.bio;
    }

    qs("#hours-list").innerHTML = (data.hours || []).map((h) => `
      <li><span class="muted">${DAYS[h.weekday]}</span>
      <span>${h.is_closed ? "Closed" : `${h.open_time}–${h.close_time}`}</span></li>`).join("");

    qs("#faq-list").innerHTML = (data.faqs || []).map((f) => `
      <div><dt>${escapeHtml(f.question)}</dt><dd>${escapeHtml(f.answer)}</dd></div>`).join("");

    if (data.testimonials && data.testimonials.length) {
      qs("#quotes").hidden = false;
      qs("#quote-list").innerHTML = data.testimonials.map((t) => `
        <article class="card">
          <p style="color:var(--ink);font-size:1.05rem">“${escapeHtml(t.quote)}”</p>
          <p class="muted" style="margin-top:1rem">${escapeHtml(t.author_name)}${t.author_city ? " · " + escapeHtml(t.author_city) : ""}</p>
        </article>`).join("");
    }
  } catch (err) {
    qs("#services-list").innerHTML = `<p class="danger">${escapeHtml(err.message)}</p>
      <p class="muted">The site is up. The Worker still needs Supabase secrets.</p>`;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&", "<": "<", ">": ">", '"': """, "'": "&#39;" }[c]
  ));
}

loadHome();
