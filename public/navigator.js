/* AlaraOS Benefit Navigator — client wizard. Data-driven from /api/navigator.
   Captures anonymous navigation events (data moat) via /api/event. No PII. */
(function () {
  var root = document.getElementById('navigator');
  if (!root) return;
  var tree = null;
  var stack = [];

  function logEvent(type, nodeId, label) {
    try {
      navigator.sendBeacon
        ? navigator.sendBeacon('/api/event', JSON.stringify({ type: type, nodeId: nodeId, label: label }))
        : fetch('/api/event', { method: 'POST', body: JSON.stringify({ type: type, nodeId: nodeId, label: label }), keepalive: true });
    } catch (e) { /* analytics is best-effort */ }
  }

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (html != null) n.innerHTML = html;
    return n;
  }

  function go(id, isBack) {
    var node = tree[id];
    if (!node) { root.innerHTML = '<p>Sorry, that path is not available yet.</p>'; return; }
    if (!isBack) stack.push(id);
    logEvent(node.type === 'answer' ? 'reach_answer' : 'navigate', id);
    node.type === 'answer' ? renderAnswer(node) : renderBranch(node);
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function controls() {
    var bar = el('div', { class: 'nav-controls' });
    if (stack.length > 1) {
      var back = el('button', { class: 'btn ghost', type: 'button' }, '‹ Back');
      back.onclick = function () { stack.pop(); go(stack[stack.length - 1], true); };
      bar.appendChild(back);
    }
    if (stack.length > 0) {
      var restart = el('button', { class: 'btn ghost', type: 'button' }, 'Start over');
      restart.onclick = function () { stack = []; go('start'); };
      bar.appendChild(restart);
    }
    return bar;
  }

  function renderBranch(node) {
    root.innerHTML = '';
    var card = el('div', { class: 'nav-card' });
    card.appendChild(el('h2', null, node.question));
    if (node.help) card.appendChild(el('p', { class: 'help' }, node.help));
    var list = el('div', { class: 'options' });
    (node.options || []).forEach(function (opt) {
      var b = el('button', { class: 'btn option', type: 'button' }, opt.label);
      b.onclick = function () { logEvent('choose', node.id, opt.label); go(opt.next); };
      list.appendChild(b);
    });
    card.appendChild(list);
    card.appendChild(controls());
    root.appendChild(card);
  }

  function renderAnswer(node) {
    root.innerHTML = '';
    var card = el('div', { class: 'nav-card answer' });
    card.appendChild(el('div', { class: 'answer-badge' }, 'Answer'));
    card.appendChild(el('h2', null, node.title));
    card.appendChild(el('p', { class: 'lead' }, node.answer));
    if (node.covered && node.covered.length) {
      card.appendChild(el('h3', null, 'Generally included'));
      var ul = el('ul', { class: 'covered' });
      node.covered.forEach(function (c) { ul.appendChild(el('li', null, c)); });
      card.appendChild(ul);
    }
    if (node.nextStep) {
      card.appendChild(el('h3', null, 'Your next step'));
      card.appendChild(el('p', null, node.nextStep));
    }
    if (node.source) {
      card.appendChild(el('p', { class: 'source' }, 'Source: <a href="' + node.source.url + '" rel="nofollow noopener" target="_blank">' + node.source.label + '</a>'));
    }
    if (node.term) {
      card.appendChild(el('p', { class: 'learn' }, 'Learn more: <a href="/glossary/' + node.term + '">Glossary entry ›</a>'));
    }
    if (node.trust) card.appendChild(el('p', { class: 'trust' }, node.trust));
    var cta = el('div', { class: 'cta' });
    cta.appendChild(el('a', { class: 'btn primary', href: 'tel:+17028149630' }, 'Talk to a nurse — free 10-min call'));
    cta.appendChild(el('a', { class: 'btn ghost', href: '/glossary' }, 'Browse the glossary'));
    card.appendChild(cta);
    card.appendChild(controls());
    root.appendChild(card);
  }

  root.innerHTML = '<p class="help">Loading the Benefit Navigator…</p>';
  fetch('/api/navigator').then(function (r) { return r.json(); }).then(function (data) {
    tree = data;
    var params = new URLSearchParams(location.search);
    go(params.get('node') || 'start');
  }).catch(function () {
    root.innerHTML = '<p>The Benefit Navigator could not load. Please refresh.</p>';
  });
})();
