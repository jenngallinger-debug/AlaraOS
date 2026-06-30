# System architecture — decisions of record

Status: proposed (2026-06-30). Owner sign-off pending on Decision 2.

This document exists because the site grew faster than its structure. The same
facts about the same benefit programs were hand-copied into five places, and
they have already drifted. Before we add more pages, we fix the spine: one
source of truth, one canonical implementation, one information architecture.

---

## The problem, stated plainly

"White Card" facts currently live in **at least five hand-maintained copies**:

| Surface | What it holds | Lives where |
|---|---|---|
| `preview_server.py` | EEOICPA dict, program pillars, homepage copy | **the version actually live on alarahc.com** |
| `public/white-card.html` | the deep guide (new) | static prose |
| `public/programs.html` | benefit cards | static prose |
| `public/learn.html` | glossary `TERMS` | inlined JS object |
| `public/qualify.html` | navigator `TREE` answer nodes | inlined JS object |

They already disagree. The audit found **six different phrasings for "cost"**
in production at once:

- `no out-of-pocket cost` ×19
- `pay nothing` ×6
- `most patients pay nothing` ×3
- `no cost` ×3
- `at no cost to you` ×2
- `$0 out-of-pocket` ×1

Three of those ("pay nothing", "most patients pay nothing", "at no cost to you")
are the cheap-sounding variants that were explicitly retired — and they are
**still live on the Python server.** This is what "no source of truth" costs:
a decision made once does not stay made.

---

## Decision 1 — One source of truth for benefit facts

**`data/programs.json` is canonical.** (Promoted and reconciled from the
abandoned `content/_examples/programs.json`, which shows this was the original
intent before it got hand-copied instead.)

It owns: program names, audiences, covered services, the single approved cost
phrasing, the "missed benefits" with their self-serve actions, the
does/does-not boundary, source URLs, and the shared phone numbers (Alara, DOL
Resource Center, Acentra). Sibling canonical files already exist:
`data/glossary.json` (terms) and `data/navigator.json` (the decision tree).

**Rule:** a fact changes in `data/`, never in markup. Surfaces read from it.
A drift-check (`scripts/check-content.mjs`) fails the build if a retired
phrasing or a stale phone number reappears anywhere.

## Decision 2 — One canonical implementation  ✅ RESOLVED: static build is canonical

Owner direction: "do what's easiest, cleanest, and best long term." That is the
static build. **Resolved 2026-06-30.**

We had **two** websites:

- **`public/*.html`** — the static build. All recent design and brand work
  lives here. Self-contained, hostable anywhere, no build step.
- **`preview_server.py`** — a Python server that renders its *own* HTML from
  dicts and is what alarahc.com serves today. It uniquely provides the staging
  `noindex` guard, JSON-LD structured data, the `/glossary` + `/navigator` +
  `/programs/*` routes, and `robots`/`sitemap`.

**Done:** `server.js` (the file `render.yaml` runs) is now a thin static file
server rooted at `public/` — pretty/extensionless URLs, the staging
`noindex` + `robots: Disallow` guard keyed off `SITE_MODE`, and the
`/api/event` analytics endpoint. It generates no HTML. `preview_server.py` and
the old `server.js` view functions are deprecated. The next deploy from `main`
therefore serves the real static site, including `white-card.html`.

Still open (follow-on, not blocking): point `learn.html`/`qualify.html` and the
prose pages at `data/programs.json` so nothing is hand-copied, and add JSON-LD
back into the static `<head>`s.

## Decision 3 — Information architecture

One job per surface; one canonical home per topic; never an orphan.

```
Home  ──────────────  recognition + what AlaraOS is + paths in
│
├─ Benefits (programs.html)   the index: each program in one card,
│   │                          linking to its pillar. NOT the deep content.
│   ├─ White Card  ▶ white-card.html      ← canonical EEOICPA pillar
│   ├─ OWCP / FECA ▶ (pillar TBD)
│   └─ VA Community Care ▶ (pillar TBD)
│
├─ Library (learn.html)       definitions only — the glossary. Cites pillars,
│                              does not re-explain them.
│
├─ Benefit Navigator (qualify.html)   the interactive flow → answers → pillars
│
└─ About
```

Fixes this requires:
1. **White Card is the EEOICPA pillar**, reachable from the global nav path
   (Benefits → White Card), not only from contextual links.
2. **Breadcrumbs** on every deep page (`Benefits / White Card`) so a cold
   landing (someone who Googled their way in) always knows where they are.
3. **De-duplicate:** Benefits = index, Library = definitions, pillar = the
   deep guide. Today all three re-explain White Card. After this, each links to
   the pillar instead of restating it.
4. **A "start from your story" on-ramp** for the level-0 visitor who doesn't yet
   know the words "EEOICPA" or "White Card." (Deferred build, but the IA holds
   a slot for it now.)

---

## What this turn delivered

- `data/programs.json` — the canonical spine (Decision 1).
- `scripts/check-content.mjs` — the drift guard.
- This record.

## What's next (in order)

1. Owner sign-off on Decision 2.
2. Point `programs.html`, `white-card.html`, `learn.html`, `qualify.html` at
   `data/programs.json`; delete the inlined copies.
3. Reconcile / retire the Python server's hand-written copy per Decision 2.
4. IA: breadcrumbs + nav placement + de-duplication (Decision 3).
5. Then, and only then, resume building new pages (the "start from your story"
   on-ramp first).
