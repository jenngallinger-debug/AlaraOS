'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const C = require('./lib/content');
const S = require('./lib/schema');
const R = require('./lib/render');
const esc = R.esc;

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ANALYTICS_LOG = path.join(__dirname, 'data', 'analytics.log');

const TOOLS = [
  { slug: 'navigator', name: 'Benefit Navigator', status: 'live', href: '/navigator',
    desc: 'Start from your program, condition, question, or location and reach a plain-language answer with a cited source and a next step.' },
  { slug: 'white-card-explainer', name: 'White Card Explainer', status: 'soon', href: '/glossary/white-card',
    desc: 'What the EEOICPA White Card is, what it covers, and how to use it for home health.' },
  { slug: 'consequential-condition-guide', name: 'Consequential Condition Guide', status: 'soon', href: '/glossary/consequential-condition',
    desc: 'How a new condition caused by an accepted condition can also become covered.' },
  { slug: 'impairment-timeline', name: 'Impairment Evaluation Timeline', status: 'soon', href: '/glossary/impairment-evaluation',
    desc: 'What an impairment evaluation is and when it can be repeated as a condition worsens.' },
  { slug: 'owcp-home-care-guide', name: 'OWCP Home Care Guide', status: 'soon', href: '/glossary/owcp',
    desc: 'How federal and postal workers reach OWCP-authorized home health.' },
  { slug: 'veteran-navigator', name: 'Veteran Benefit Navigator', status: 'soon', href: '/glossary/community-care',
    desc: 'How eligible veterans reach home health through VA Community Care and TriWest.' }
];

const ENTRY_POINTS = [
  { label: 'My program', node: 'by-program' },
  { label: 'Who I am', node: 'by-who' },
  { label: 'A condition', node: 'by-condition' },
  { label: 'A service', node: 'by-service' },
  { label: 'A question', node: 'by-question' },
  { label: 'My location', node: 'by-geo' }
];

// ---------- Views ----------
function viewHome() {
  const st = C.stats();
  const entry = ENTRY_POINTS.map(e =>
    `<a href="/navigator?node=${e.node}">${esc(e.label)}</a>`).join('');
  const tools = TOOLS.map(t => `
    <div class="card">
      <a class="title" href="${t.href}">${esc(t.name)}</a>
      <span class="tag ${t.status === 'live' ? 'live' : 'soon'}">${t.status === 'live' ? 'Live' : 'Planned'}</span>
      <p class="sub">${esc(t.desc)}</p>
    </div>`).join('');
  const body = `
  <h1>The Federal Benefits Intelligence Platform</h1>
  <p class="lead sub">AlaraOS helps EEOICPA claimants, DOE and Nevada Test Site workers, federal and postal workers, veterans, families, physicians, and case managers understand and reach the home-health benefits they may already be entitled to.</p>
  <div class="stat">
    <div><b>${st.entities}</b><span>knowledge-graph entities</span></div>
    <div><b>${st.relationships}</b><span>mapped relationships</span></div>
    <div><b>${st.glossaryTerms}</b><span>glossary definitions</span></div>
    <div><b>${st.answers}</b><span>navigator answers</span></div>
  </div>
  <h2>Start anywhere — reach the answer</h2>
  <div class="entry">${entry}</div>
  <p class="muted">Or open the <a href="/navigator">Benefit Navigator</a> directly.</p>
  <h2>Tools</h2>
  <div class="grid cols-3">${tools}</div>
  <h2>Built to be trusted — and cited</h2>
  <div class="grid cols-2">
    <div class="card"><h3>Trust infrastructure</h3><p class="sub">Every definition carries a named clinician reviewer, a review date, a version, and primary-source citations (DOL, VA, CMS). See <a href="/trust">Trust &amp; Sources</a>.</p></div>
    <div class="card"><h3>It helps, it doesn't replace</h3><p class="sub">AlaraOS complements Resource Centers, physicians, attorneys, authorized representatives, and federal agencies — it reduces confusion and improves navigation.</p></div>
  </div>`;
  return R.page({
    title: 'Federal Benefits Intelligence Platform',
    description: 'AlaraOS helps EEOICPA, OWCP, federal, postal, and veteran beneficiaries understand and reach home-health benefits they may already have.',
    bodyHtml: body, activePath: '/',
    jsonld: S.basicPageGraph('AlaraOS — Federal Benefits Intelligence Platform', '/', [{ name: 'Home', path: '/' }])
  });
}

function viewNavigator() {
  const body = `
  <h1>Benefit Navigator</h1>
  <p class="sub">Answer a few questions and reach a plain-language answer with a cited source and your next step. Nothing here is a benefits determination — it helps you work with your Resource Center, physician, or the VA.</p>
  <div id="navigator" aria-live="polite"><noscript><p>The Benefit Navigator needs JavaScript. You can still <a href="/glossary">browse the glossary</a>.</p></noscript></div>
  <script src="/public/navigator.js" defer></script>`;
  return R.page({
    title: 'Benefit Navigator', description: 'Start from your program, condition, question, or location and reach a cited answer.',
    bodyHtml: body, activePath: '/navigator',
    breadcrumbs: [{ name: 'Home', path: '/' }, { name: 'Benefit Navigator', path: '/navigator' }],
    jsonld: S.basicPageGraph('Benefit Navigator', '/navigator', [{ name: 'Home', path: '/' }, { name: 'Benefit Navigator', path: '/navigator' }])
  });
}

function viewGlossaryIndex() {
  const items = C.glossary.slice().sort((a, b) => a.term.localeCompare(b.term))
    .map(t => `<div><a class="term-list" href="/glossary/${t.slug}">${esc(t.term)}</a><div class="muted" style="font-size:.85rem;margin-bottom:10px">${esc(t.shortDefinition.slice(0, 120))}…</div></div>`).join('');
  const body = `
  <h1>Glossary</h1>
  <p class="sub">Plain-language, clinician-reviewed, source-cited definitions of the entities in federal benefits and home health. These are the building blocks AI answer engines can cite.</p>
  <div class="glossary-list">${items}</div>`;
  return R.page({
    title: 'Glossary', description: 'Clinician-reviewed, source-cited definitions of federal-benefits and home-health terms.',
    bodyHtml: body, activePath: '/glossary',
    breadcrumbs: [{ name: 'Home', path: '/' }, { name: 'Glossary', path: '/glossary' }],
    jsonld: S.basicPageGraph('Glossary', '/glossary', [{ name: 'Home', path: '/' }, { name: 'Glossary', path: '/glossary' }])
  });
}

function viewGlossaryTerm(slug) {
  const t = C.getTerm(slug);
  if (!t) return null;
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'Glossary', path: '/glossary' }, { name: t.term, path: '/glossary/' + t.slug }];
  const related = (t.related || []).map(r => {
    const rt = C.getTerm(r);
    return rt ? `<a href="/glossary/${rt.slug}">${esc(rt.term)}</a>` : `<span class="muted">${esc(r)}</span>`;
  }).join(' · ');
  const who = (t.whoItAffects || []).map(w => `<li>${esc(w)}</li>`).join('');
  const sources = (t.sources || []).map(s => `<li><a href="${esc(s.url)}" rel="nofollow noopener" target="_blank">${esc(s.label)}</a></li>`).join('');
  const body = `
  <h1>What is ${esc(t.term)}?</h1>
  <p class="lead">${esc(t.shortDefinition)}</p>
  <h2>In plain terms</h2>
  <p>${esc(t.plain)}</p>
  ${who ? `<h2>Who it affects</h2><ul>${who}</ul>` : ''}
  ${related ? `<h2>Related terms</h2><p>${related}</p>` : ''}
  <div class="card" style="margin-top:22px">
    <h3>Trust &amp; review</h3>
    <p class="muted" style="font-size:.9rem">
      Reviewed by ${esc(t.reviewer ? t.reviewer.name : 'pending')}${t.reviewer ? ' (' + esc(t.reviewer.role) + ')' : ''} ·
      Last reviewed ${esc(t.lastReviewed)} · Version ${esc(t.version)} ·
      Status <span class="tag ${t.status === 'published' ? 'live' : 'draft'}">${esc(t.status)}</span>
    </p>
    ${sources ? `<strong>Sources</strong><ul>${sources}</ul>` : ''}
  </div>
  <div class="cta"><a class="btn primary" href="/navigator">Use the Benefit Navigator</a><a class="btn ghost" href="/glossary">Back to glossary</a></div>`;
  return R.page({
    title: 'What is ' + t.term + '?', description: t.shortDefinition,
    bodyHtml: body, activePath: '/glossary', breadcrumbs: crumbs,
    jsonld: S.glossaryGraph(t, crumbs)
  });
}

function viewGraph() {
  const byType = {};
  for (const n of C.graph.nodes) { (byType[n.type] = byType[n.type] || []).push(n); }
  const typeCards = Object.keys(byType).sort().map(type => `
    <div class="card"><h3>${esc(type)} <span class="muted">(${byType[type].length})</span></h3>
    <p class="sub" style="font-size:.88rem">${byType[type].map(n => esc(n.label)).join(' · ')}</p></div>`).join('');
  const edgeRows = C.graph.edges.map(e => {
    const f = C.nodeById[e.from], to = C.nodeById[e.to];
    return `<tr><td>${esc(f ? f.label : e.from)}</td><td><code>${esc(e.rel)}</code></td><td>${esc(to ? to.label : e.to)}</td></tr>`;
  }).join('');
  const body = `
  <h1>Knowledge Graph</h1>
  <p class="sub">${C.graph.nodes.length} entities and ${C.graph.edges.length} relationships across programs, beneficiaries, services, conditions, and geography. This is the structure AI engines traverse to decide whom to cite. Machine-readable at <a href="/api/graph">/api/graph</a>.</p>
  <h2>Entities by type</h2>
  <div class="grid cols-2">${typeCards}</div>
  <h2>Relationships</h2>
  <table><thead><tr><th>From</th><th>Relationship</th><th>To</th></tr></thead><tbody>${edgeRows}</tbody></table>`;
  return R.page({
    title: 'Knowledge Graph', description: 'The AlaraOS federal-benefits knowledge graph: entities and mapped relationships.',
    bodyHtml: body, activePath: '/graph',
    breadcrumbs: [{ name: 'Home', path: '/' }, { name: 'Knowledge Graph', path: '/graph' }],
    jsonld: S.basicPageGraph('Knowledge Graph', '/graph', [{ name: 'Home', path: '/' }, { name: 'Knowledge Graph', path: '/graph' }])
  });
}

function viewTrust() {
  const rows = C.glossary.map(t => `<tr><td><a href="/glossary/${t.slug}">${esc(t.term)}</a></td>
    <td><span class="tag ${t.status === 'published' ? 'live' : 'draft'}">${esc(t.status)}</span></td>
    <td>${esc(t.reviewer ? t.reviewer.name : '—')}</td><td>${esc(t.lastReviewed)}</td><td>${esc(t.version)}</td></tr>`).join('');
  const body = `
  <h1>Trust &amp; Sources</h1>
  <p class="sub">AlaraOS is YMYL ("Your Money or Your Life") content: federal benefits and healthcare. Trust is engineered, not assumed.</p>
  <div class="grid cols-2">
    <div class="card"><h3>Clinician review workflow</h3><p class="sub">Every page moves <code>Draft → SME review → Approved → Published</code>. Only approved content is indexed and cited. A named, credentialed reviewer (RN/DON) signs each page.</p></div>
    <div class="card"><h3>Source citations</h3><p class="sub">Every benefits claim cites a primary authority — DOL/DEEOIC, OWCP/FECA, or VA Community Care. Coverage is framed as "generally covered when authorized," never guaranteed.</p></div>
    <div class="card"><h3>Version history</h3><p class="sub">Each definition carries a semantic version and a last-reviewed date. Benefits rules change; a quarterly re-review keeps content — and its freshness signal — current.</p></div>
    <div class="card"><h3>Update tracking</h3><p class="sub">Changes are versioned at the content-model level so corrections are auditable and the "what changed, when, by whom" history is preserved.</p></div>
  </div>
  <h2>Live content register</h2>
  <table><thead><tr><th>Term</th><th>Status</th><th>Reviewer</th><th>Last reviewed</th><th>Version</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="trust" style="margin-top:16px">AlaraOS provides educational information and navigation. It does not determine eligibility, file claims, or replace your Resource Center, physician, attorney, authorized representative, or any federal agency.</p>`;
  return R.page({
    title: 'Trust & Sources', description: 'How AlaraOS engineers trust: clinician review, citations, versioning, and update tracking.',
    bodyHtml: body, activePath: '/trust',
    breadcrumbs: [{ name: 'Home', path: '/' }, { name: 'Trust & Sources', path: '/trust' }],
    jsonld: S.basicPageGraph('Trust & Sources', '/trust', [{ name: 'Home', path: '/' }, { name: 'Trust & Sources', path: '/trust' }])
  });
}

// ---------- Static + helpers ----------
const MIME = { '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, urlPath) {
  const rel = urlPath.replace(/^\/public\//, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'text/plain', 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'text/plain', 'Not found');
    send(res, 200, MIME[path.extname(file)] || 'application/octet-stream', data);
  });
}
function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function html(res, code, str) { send(res, code, 'text/html; charset=utf-8', str); }
function json(res, code, obj) { send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj)); }

function logEvent(res, req) {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 4096) req.destroy(); });
  req.on('end', () => {
    let ev = {};
    try { ev = JSON.parse(raw || '{}'); } catch (e) {}
    // Data moat: anonymous navigation/question-demand signal. No PII, no IP.
    const rec = { ts: new Date().toISOString(), day: new Date().toISOString().slice(0, 10),
      type: String(ev.type || 'unknown').slice(0, 40), nodeId: String(ev.nodeId || '').slice(0, 60),
      label: String(ev.label || '').slice(0, 120) };
    fs.appendFile(ANALYTICS_LOG, JSON.stringify(rec) + '\n', () => {});
    res.writeHead(204); res.end();
  });
}

// ---------- Router ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  try {
    if (p === '/healthz') return send(res, 200, 'text/plain', 'ok');
    if (p.startsWith('/public/')) return serveStatic(req, res, p);
    if (p === '/api/event' && req.method === 'POST') return logEvent(res, req);
    if (p === '/api/navigator') return json(res, 200, C.navigator);
    if (p === '/api/graph') return json(res, 200, C.graph);
    if (p === '/' ) return html(res, 200, viewHome());
    if (p === '/navigator') return html(res, 200, viewNavigator());
    if (p === '/glossary') return html(res, 200, viewGlossaryIndex());
    if (p.startsWith('/glossary/')) {
      const out = viewGlossaryTerm(decodeURIComponent(p.split('/')[2] || ''));
      return out ? html(res, 200, out) : html(res, 404, R.page({ title: 'Not found', bodyHtml: '<h1>Term not found</h1><p><a href="/glossary">Back to glossary</a></p>', activePath: '/glossary' }));
    }
    if (p === '/graph') return html(res, 200, viewGraph());
    if (p === '/trust') return html(res, 200, viewTrust());
    return html(res, 404, R.page({ title: 'Not found', bodyHtml: '<h1>404 — Not found</h1><p><a href="/">Go home</a></p>', activePath: '/' }));
  } catch (e) {
    console.error('[server] error on', p, e);
    return html(res, 500, R.page({ title: 'Error', bodyHtml: '<h1>Something went wrong</h1>', activePath: '/' }));
  }
});

server.listen(PORT, () => console.log(`AlaraOS listening on http://localhost:${PORT}`));
