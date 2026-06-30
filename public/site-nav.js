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
