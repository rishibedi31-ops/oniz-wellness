let mode = "staff";
if (session().token) {
  location.href = session().role === "staff" ? "portal.html" : "care.html";
}

qsa(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    qsa(".tabs button").forEach((b) => b.classList.toggle("is-on", b === btn));
    qs("#pass-field").hidden = mode !== "staff";
    qs("#phone-field").hidden = mode !== "patient";
    qs("#hint").textContent = mode === "staff"
      ? "Use the owner email and password from your Worker secrets."
      : "Use the email and phone number from your booking.";
  });
});

qs("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    const path = mode === "staff" ? "/api/auth/staff" : "/api/auth/patient";
    const body = mode === "staff"
      ? { email: fd.get("email"), password: fd.get("password") }
      : { email: fd.get("email"), phone: fd.get("phone") };
    const data = await api(path, { method: "POST", auth: false, body });
    setSession(data);
    location.href = data.role === "staff" ? "portal.html" : "care.html";
  } catch (err) {
    toast(err.message, "err");
    btn.disabled = false;
  }
});
