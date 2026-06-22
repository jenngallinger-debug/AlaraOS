'use strict';
// Minimal, dependency-free HTML renderer. Intentionally neutral styling — AlaraOS theming
// (brand palette/typography) is applied later; this layer is structure + semantics + schema.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function jsonldScript(obj) {
  if (!obj) return '';
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

const NAV = [
  { path: '/', label: 'Home' },
  { path: '/navigator', label: 'Benefit Navigator' },
  { path: '/glossary', label: 'Glossary' },
  { path: '/graph', label: 'Knowledge Graph' },
  { path: '/trust', label: 'Trust & Sources' }
];

function breadcrumbHtml(items) {
  if (!items || items.length < 2) return '';
  return `<nav class="crumbs" aria-label="Breadcrumb">` +
    items.map((it, i) =>
      i < items.length - 1
        ? `<a href="${esc(it.path)}">${esc(it.name)}</a><span aria-hidden="true"> › </span>`
        : `<span aria-current="page">${esc(it.name)}</span>`
    ).join('') + `</nav>`;
}

function page({ title, description, bodyHtml, jsonld, breadcrumbs, activePath }) {
  const nav = NAV.map(n =>
    `<a href="${n.path}"${n.path === activePath ? ' aria-current="page" class="active"' : ''}>${esc(n.label)}</a>`
  ).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — AlaraOS</title>
<meta name="description" content="${esc(description || '')}">
<link rel="stylesheet" href="/public/app.css">
${jsonldScript(jsonld)}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site">
  <a class="brand" href="/"><svg viewBox="0 0 100 92" width="26" height="24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M22,88 V34 L50,8 L78,34 V88 Z M37,88 V66 A13,13 0 0 1 63,66 V88 Z M52.4,27 A2.4,2.4 0 1 0 47.6,27 A2.4,2.4 0 1 0 52.4,27 Z"/></svg><span style="display:flex;flex-direction:column;gap:3px;line-height:1"><strong>ALARA</strong><span>HOME CARE</span></span></a>
  <nav class="mainnav" aria-label="Primary">${nav}</nav>
</header>
<div class="disclaimer" role="note">AlaraOS is an educational and navigation tool. It does not replace your Resource Center, physician, attorney, authorized representative, or any federal agency — it helps you work with them.</div>
<main id="main">
${breadcrumbHtml(breadcrumbs)}
${bodyHtml}
</main>
<footer class="site">
  <p><strong>AlaraOS</strong> · Educational information, not a benefits determination. Always confirm with your Resource Center, physician, or the relevant federal agency.</p>
  <p>Operated by Alara Home Care · Las Vegas / Clark County / Southern Nevada · (702) 814-9630</p>
</footer>
</body>
</html>`;
}

module.exports = { page, esc, breadcrumbHtml, jsonldScript };
