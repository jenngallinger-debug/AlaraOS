# Alara Home Care — working notes

Static multi-page site in `public/*.html`, shared `public/site.css` (design tokens).
Served by `server.js` (Node stdlib). Deployed to the **alarahc.com staging** site via
Render from `main`. The live production site (alarahomecare.com, Squarespace) is separate
and untouched by this repo.

## Locked content — do NOT change without explicit owner approval

- **Homepage hero headline** (`public/home.html`):
  `Skilled home health. You earned it. Let's bring it home.`
  This is enforced mechanically by `scripts/check-content.mjs` (the `LOCKED[]` array).
  If the owner explicitly approves a change, update the string in `LOCKED[]` in the
  **same commit** — that update is the approval record. Never edit the hero to satisfy a
  general copy sweep.

## Copy voice rules (owner-set)

- No "we're being plain/simple" self-description: no "in plain language", "plainly",
  "a plain answer", "a few plain questions", "simply put".
- No burden/loss metaphors: no **carry / carrying / hold (as in holding it together) /
  handle / weight / cracks / fall through / falls between / slip through**. "Hold/have a
  White Card" → say "have". "Held together" → "used together".
- No vague reassurance: no "you don't have to do this alone" / "work this out alone".
- The website should **replace the first phone call**, not push one. Primary CTAs are
  self-serve: **Start a case review** (`case-review.html`), **See what you qualify for**
  (`qualify.html` Navigator), **Refer a patient** (`begin.html?who=referrer`). Phone is a
  quiet fallback only.

## Before you ship

- Run `node scripts/check-content.mjs` (drift guard: canonical "no cost to you" cost
  phrasing, known phone numbers, banned voice phrases, and the locked hero). Must exit 0.
- Deploy flow: work on branch `claude/alara-homepage-design-ra8y4t` → PR → squash-merge to
  `main` (Render auto-deploys staging).
