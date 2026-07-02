'use strict';
// =============================================================================
// AlaraOS Engine V1 — the staff console.
//
// Internal only. Mounted by server.js under /os and enabled ONLY when
// ENGINE_KEY is set in the environment; every request must carry the key
// (?key=... once, then a cookie). Never linked from the public site.
//
// Three screens:
//   /os            the work queue (every pending human prompt, due-first) + cases
//   /os/case/ID    one case: the prompt form (if waiting) + full journal
//   POST /os/complete   a human's input → engine validates, applies, continues
// =============================================================================
const core = require('./core');
const flows = require('./workflows');

const ENGINE_KEY = process.env.ENGINE_KEY || '';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function authed(req, url) {
  if (!ENGINE_KEY) return false;
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('oskey='));
  if (cookie && cookie.slice(6) === ENGINE_KEY) return true;
  return url.searchParams.get('key') === ENGINE_KEY;
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex"/>
<title>${esc(title)} · AlaraOS</title><style>
:root{--ink:#342E2E;--soft:#6b625d;--line:#DED5C7;--bg:#FBFAF7;--warm:#EFEAE2;--accent:#6E5330;--bad:#8a2f2f}
*{box-sizing:border-box}body{margin:0;font:15px/1.55 system-ui,sans-serif;color:var(--ink);background:var(--bg)}
header{display:flex;gap:18px;align-items:baseline;padding:14px 22px;border-bottom:2px solid var(--line);background:#fff}
header b{letter-spacing:.12em}header a{color:var(--soft);text-decoration:none}header a:hover{color:var(--ink)}
main{max-width:920px;margin:0 auto;padding:22px}
h1{font-size:1.3rem;margin:8px 0 14px}h2{font-size:1.05rem;margin:22px 0 8px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:9px 12px;border-top:1px solid var(--line);vertical-align:top}th{border-top:none;background:var(--warm);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--soft)}
a.case{color:var(--ink)}
.tag{display:inline-block;font-size:.7rem;letter-spacing:.06em;padding:2px 8px;border:1px solid var(--line);border-radius:100px;background:#fff}
.due-bad{color:var(--bad);font-weight:600}.due-ok{color:var(--soft)}
pre.brief{white-space:pre-wrap;background:#fff;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;padding:16px;font:13.5px/1.55 ui-monospace,monospace}
form.prompt{background:#fff;border:1px solid var(--line);border-radius:8px;padding:18px;margin-top:14px}
label{display:block;margin:12px 0 4px;font-weight:600;font-size:.85rem}
input[type=text],textarea,select{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:6px;font:inherit}
textarea{min-height:70px}
button{margin-top:16px;background:var(--ink);color:#fff;border:none;border-radius:6px;padding:11px 20px;font:inherit;cursor:pointer}
.journal{font:12.5px/1.6 ui-monospace,monospace;color:var(--soft)}
.note{font-size:.85rem;color:var(--soft)}
.breach{background:#fff;border:1px solid var(--bad);border-radius:8px;padding:10px 14px;color:var(--bad);margin-bottom:14px}
</style></head><body>
<header><b>ALARAOS</b><a href="/os">Work queue</a><a href="/os?view=cases">All cases</a><span class="note">engine prepares · human acts · engine continues</span></header>
<main>${body}</main></body></html>`;
}

function fmtDue(clock) {
  if (!clock || !clock.dueAt) return '<span class="note">no clock</span>';
  return clock.breached
    ? `<span class="due-bad">BREACHED ${esc(-clock.remainingH)}h</span>`
    : `<span class="due-ok">due in ${esc(clock.remainingH)}h</span>`;
}

function homeView(view) {
  const ticks = flows.tick(); // time-based work runs on every console load
  const breaches = ticks.filter(t => t.slaBreach);
  let body = '';
  if (breaches.length) body += `<div class="breach">⚑ ${breaches.length} SLA clock(s) breached — they are at the top of the queue.</div>`;

  if (view === 'cases') {
    const rows = core.listCases().map(c =>
      `<tr><td><a class="case" href="/os/case/${esc(c.id)}">${esc(c.id)}</a></td>
       <td>${esc(c.kind)}</td><td><span class="tag">${esc(c.state)}</span></td>
       <td>${esc(c.fields.patient || '—')}</td><td>${esc((c.updatedAt || '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('');
    body += `<h1>All cases</h1><table><tr><th>Case</th><th>Kind</th><th>State</th><th>Patient</th><th>Updated</th></tr>${rows || '<tr><td colspan=5>None yet.</td></tr>'}</table>`;
    return page('Cases', body);
  }

  const q = core.workQueue();
  const rows = q.map(({ case: c, clock }) =>
    `<tr><td><a class="case" href="/os/case/${esc(c.id)}"><b>${esc(c.prompt.title)}</b><br/><span class="note">${esc(c.id)} · ${esc(c.kind)}${c.fields.patient ? ' · ' + esc(c.fields.patient) : ''}</span></a></td>
     <td><span class="tag">${esc(c.prompt.role)}</span></td><td>${fmtDue(clock)}</td></tr>`).join('');
  body += `<h1>Work queue — ${q.length} waiting on a human</h1>
  <table><tr><th>Prompt</th><th>Role</th><th>Clock</th></tr>${rows || '<tr><td colspan=3>Queue is empty. The engine is running everything else.</td></tr>'}</table>`;

  const sleeping = core.listCases().filter(c => c.state === 'sleeping')
    .sort((a, b) => (a.wakeAt || '').localeCompare(b.wakeAt || ''));
  if (sleeping.length) {
    const srows = sleeping.map(c =>
      `<tr><td><a class="case" href="/os/case/${esc(c.id)}">${esc(c.id)}</a> <span class="note">${esc(c.kind)}${c.fields.patient ? ' · ' + esc(c.fields.patient) : ''}${c.fields.claimStage ? ' · ' + esc(c.fields.claimStage) : ''}</span></td>
       <td class="note">wakes ${esc((c.wakeAt || '').slice(0, 10))}</td></tr>`).join('');
    body += `<h2>Scheduled — ${sleeping.length} sleeping (claim companions, re-prompts)</h2>
    <table><tr><th>Case</th><th>Wakes</th></tr>${srows}</table>`;
  }
  body += `<p class="note">Everything not on this screen is being handled by the engine: drafts, clocks, renewals, routing, records.</p>`;
  return page('Work queue', body);
}

function caseView(id) {
  const c = core.loadCase(id);
  if (!c) return page('Not found', '<h1>No such case.</h1>');
  let body = `<h1>${esc(c.id)} <span class="tag">${esc(c.state)}</span></h1>
  <p class="note">${esc(c.kind)} · created ${esc((c.createdAt || '').slice(0, 16).replace('T', ' '))}${c.fields.patient ? ' · patient: <b>' + esc(c.fields.patient) + '</b>' : ''}${c.fields.renewalOf ? ' · renewal of ' + esc(c.fields.renewalOf) : ''}</p>`;

  if (c.state === 'waiting_human' && c.prompt) {
    const clock = core.clockStatus(c);
    body += `<h2>${esc(c.prompt.title)} ${fmtDue(clock)}</h2>
    <pre class="brief">${esc(c.prompt.brief)}</pre>
    <form class="prompt" method="POST" action="/os/complete">
      <input type="hidden" name="caseId" value="${esc(c.id)}"/>`;
    for (const spec of c.prompt.inputs) {
      body += `<label>${esc(spec.name)}${spec.required === false ? ' <span class="note">(optional)</span>' : ''}${spec.hint ? ' <span class="note">— ' + esc(spec.hint) + '</span>' : ''}</label>`;
      if (spec.type === 'choice') {
        body += `<select name="${esc(spec.name)}">` + spec.options.map(o => `<option>${esc(o)}</option>`).join('') + `</select>`;
      } else if ((spec.max || 0) > 500) {
        body += `<textarea name="${esc(spec.name)}"></textarea>`;
      } else {
        body += `<input type="text" name="${esc(spec.name)}"/>`;
      }
    }
    body += `<br/><button type="submit">Submit — the engine continues from here</button></form>`;
  } else if (c.state === 'error') {
    body += `<div class="breach">Engine error at step ${esc(c.error && c.error.stepId)}: ${esc(c.error && c.error.message)}</div>`;
  } else if (c.fields.lmnDraft) {
    body += `<h2>Current LMN</h2><pre class="brief">${esc(c.fields.lmnDraft)}</pre>`;
  }

  if (c.fields.authNumber) {
    body += `<h2>Authorization</h2><p>#${esc(c.fields.authNumber)} · ${esc(c.fields.authStart)} → ${esc(c.fields.authEnd)} · ${esc(c.fields.hoursPerDay || '?')}h/day × ${esc(c.fields.daysPerWeek || '?')}d/wk` +
      (c.fields.renewalDueAt ? ` · <b>renewal auto-spawns ${esc(c.fields.renewalDueAt.slice(0, 10))}</b>` : '') + `</p>`;
  }

  const j = core.readJournal(id).map(r =>
    `<div>${esc(r.ts.slice(0, 19).replace('T', ' '))} · <b>${esc(r.type)}</b> ${esc(JSON.stringify(r.detail)).slice(0, 400)}</div>`).join('');
  body += `<h2>Journal — the audit trail</h2><div class="journal">${j || 'empty'}</div>`;
  return page(c.id, body);
}

// ---------------------------------------------------------------------------
// HTTP handling — plugged into server.js's request handler.
// Returns true if the request was handled.
// ---------------------------------------------------------------------------
function handle(req, res, url) {
  const p = url.pathname;
  if (!p.startsWith('/os')) return false;
  if (!ENGINE_KEY) { res.writeHead(404); res.end('Not found'); return true; }
  if (!authed(req, url)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('AlaraOS: key required'); return true; }

  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
    'Set-Cookie': 'oskey=' + ENGINE_KEY + '; Path=/os; HttpOnly; SameSite=Strict'
  };

  if (p === '/os' || p === '/os/') {
    res.writeHead(200, headers); res.end(homeView(url.searchParams.get('view'))); return true;
  }
  const caseMatch = p.match(/^\/os\/case\/([a-z0-9-]+)$/);
  if (caseMatch) {
    res.writeHead(200, headers); res.end(caseView(caseMatch[1])); return true;
  }
  if (p === '/os/complete' && req.method === 'POST') {
    let raw = '';
    req.on('data', ch => { raw += ch; if (raw.length > 65536) req.destroy(); });
    req.on('error', () => {});
    req.on('end', () => {
      // This callback runs after server.js's try/catch has returned — anything
      // that throws here would kill the whole process. Contain everything.
      try {
        const input = {};
        const dec = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
        for (const pair of raw.split('&')) {
          const i = pair.indexOf('=');
          if (i > 0) input[dec(pair.slice(0, i))] = dec(pair.slice(i + 1).replace(/\+/g, ' '));
        }
        const out = core.completePrompt(input.caseId, input, 'console');
        if (!out.ok) { res.writeHead(400, headers); res.end(page('Error', '<h1>' + esc(out.error) + '</h1><p><a href="/os/case/' + esc(input.caseId || '') + '">Back</a></p>')); return; }
        res.writeHead(303, Object.assign({}, headers, { Location: '/os/case/' + out.case.id }));
        res.end();
      } catch (e) {
        console.error('[os] complete failed:', e.message);
        try { res.writeHead(500, headers); res.end(page('Error', '<h1>Something went wrong.</h1><p>' + esc(e.message) + '</p><p><a href="/os">Back to the queue</a></p>')); } catch (e2) {}
      }
    });
    return true;
  }
  res.writeHead(404, headers); res.end(page('Not found', '<h1>Not found.</h1>'));
  return true;
}

// Website conversions become engine cases (A2–A4: the front door flows in).
function intakeFromSubmission(kind, subject, text) {
  try {
    return core.createCase('intake', kind || 'submission', { subject, text });
  } catch (e) { return null; }
}

// The heartbeat: tick() must not depend on someone opening the console.
// Sleeping claim companions, 3-day re-prompts, and T-45 renewals wake on
// this schedule even through a quiet week. Called once from server.js.
function startSchedule() {
  if (!ENGINE_KEY) return null;
  const t = setInterval(() => {
    try {
      const actions = flows.tick();
      if (actions.length) console.log('[engine] tick:', JSON.stringify(actions).slice(0, 400));
    } catch (e) { console.error('[engine] tick failed:', e.message); }
  }, 15 * 60 * 1000);
  t.unref(); // never keep the process alive on our account
  return t;
}

module.exports = { handle, intakeFromSubmission, startSchedule, ENGINE_KEY };
