/* Shared form delivery for the self-serve tools (case review, referral, begin).
   Key-ready: /api/config says whether server-side email delivery is live
   (RESEND_API_KEY set in the host environment). When it is, forms POST to
   /api/submit and confirm in-page. Until then, pages keep their mailto flow
   and still fire a backup POST so every submission lands in the server log. */
window.AlaraForms = (function () {
  var cfgPromise = null;

  function config() {
    if (!cfgPromise) {
      cfgPromise = fetch('/api/config', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : { emailDelivery: false }; })
        .catch(function () { return { emailDelivery: false }; });
    }
    return cfgPromise;
  }

  // Resolves true only when the server actually emailed the nurse team —
  // a logged-but-unsent submission is not a delivery, so callers fall back
  // to the mailto flow instead of showing a false confirmation.
  function post(kind, subject, text) {
    return fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: kind, subject: subject, text: text }),
      keepalive: true
    }).then(function (r) { return r.ok ? r.json() : { ok: false }; })
      .then(function (j) { return !!(j && j.ok && j.delivered === 'email'); })
      .catch(function () { return false; });
  }

  // Fire-and-forget backup record; never blocks or throws.
  function logOnly(kind, subject, text) {
    try { post(kind, subject, text); } catch (e) {}
  }

  return { config: config, post: post, logOnly: logOnly };
})();
