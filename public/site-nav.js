/* Shared mobile-nav enhancements, layered on top of each page's inline toggle.
   The inline handler flips aria-expanded + data-open on click; this adds the
   finishing behaviors every page was missing: dismiss on outside tap, dismiss
   on Escape (returning focus to the toggle), and a body-scroll lock while open. */
(function () {
  var toggle = document.getElementById('navToggle');
  var menu = document.getElementById('site-menu');
  if (!toggle || !menu) return;

  function isOpen() { return toggle.getAttribute('aria-expanded') === 'true'; }

  function close() {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    menu.setAttribute('data-open', 'false');
    document.body.style.overflow = '';
  }

  function syncLock() { document.body.style.overflow = isOpen() ? 'hidden' : ''; }

  // The inline click handler runs first (it is bound during page parse); sync the
  // scroll lock to whatever state it just produced.
  toggle.addEventListener('click', function () { window.setTimeout(syncLock, 0); });

  // Tap or click anywhere outside the panel and toggle closes the menu.
  document.addEventListener('click', function (e) {
    if (!isOpen()) return;
    if (menu.contains(e.target) || toggle.contains(e.target)) return;
    close();
  });

  // Escape closes and returns focus to the control that opened it.
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.key === 'Esc') && isOpen()) { close(); toggle.focus(); }
  });

  // Following a menu link closes the panel (covers in-page anchors).
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) close(); });
})();

/* Anonymous usage signals -> /api/event. One page_view per load, one cta event
   per primary-button tap. No name, no phone, no email, no IP, no cookies, no
   cross-visit identity — just "which pages and buttons matter to families"
   (see privacy.html). */
(function () {
  function beacon(type, nodeId, label) {
    var payload = JSON.stringify({ type: type, nodeId: nodeId, label: label || '' });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/event', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/event', { method: 'POST', body: payload, keepalive: true });
      }
    } catch (e) {}
  }

  var page = window.location.pathname.replace(/\.html$/, '') || '/';
  beacon('page_view', page);

  // Primary CTAs only: .btn links/buttons and anything opting in via data-evt.
  document.addEventListener('click', function (e) {
    var el = e.target.closest('a.btn, button.btn, [data-evt]');
    if (!el) return;
    var label = el.getAttribute('data-evt') || (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    beacon('cta', page, label);
  });
})();
