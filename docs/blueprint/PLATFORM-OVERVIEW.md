# Alara Home Care — Knowledge Platform Blueprint

Rebuilding **AlaraHomeCare.com** as a category-defining healthcare knowledge platform and
trust-first lead-generation engine for federal-benefits home health care.

> **Positioning to defend:** the dominant online authority on EEOICPA / White Card, OWCP /
> FECA, VA Community Care, and complex home health — for federal, postal, DOE, and veteran
> patients in Southern Nevada and beyond. Not a brochure. A knowledge platform, answer
> engine, SEO/AEO asset, referral source, and lead engine.

This blueprint is **grounded in a real crawl of the live Squarespace site** (June 2026),
not assumptions. Brand, palette, typography, the arch design, and existing SEO equity are
**preserved**; the platform is built additively around them.

---

## ⚡ Three things that change the trajectory (read first)

1. **The live site blocks AI crawlers.** Its `robots.txt` disallows `ClaudeBot`, `GPTBot`,
   and `Amazonbot` — so the site is currently invisible to the very engines (Claude, ChatGPT,
   Perplexity) it wants to be cited by. **A corrected `robots.txt` is shipped in
   `public/robots.txt`.** This is the single highest-leverage fix and can be applied to the
   current site immediately.
2. **It's a Las Vegas / Clark County business** (Nevada Test Site & DOE workers, 240k+
   Southern Nevada veterans). Local SEO + LocalBusiness/MedicalOrganization schema are
   first-class, not afterthoughts.
3. **YMYL discipline is the moat, not a tax.** Federal-benefits + healthcare claims must be
   cited (DOL/VA/CMS) and clinician-reviewed. That review bar is exactly what competitors
   won't pay for — so it's the defensible advantage. The programmatic engine is built around
   a quality gate, never raw templating.

---

## The 9 deliverables (all included)

| # | Deliverable | Where |
|---|---|---|
| 1 | Live-site inventory, audit & **migration plan** | [docs/01](docs/01-inventory-audit-migration.md) |
| 2 | **Full site map** & information architecture | [docs/02](docs/02-information-architecture.md) |
| 3 | **AEO strategy** + **schema architecture** | [docs/03](docs/03-aeo-and-schema.md) |
| 4 | **Programmatic content** engine | [docs/04](docs/04-programmatic-engine.md) |
| 5 | **Technical architecture** | [docs/05](docs/05-technical-architecture.md) |
| 6 | **Conversion** + **internal linking** + **data moat** | [docs/06](docs/06-conversion-linking-moat.md) |
| 7 | **Implementation roadmap** | [docs/07](docs/07-roadmap.md) |

Concrete starter artifacts already in this repo:
- `public/robots.txt` — corrected, AI-crawler-friendly (ship now).
- `content/_examples/programs.json` — structured program model (EEOICPA/OWCP/VA).
- `content/_examples/intersection-eeoicpa-wound-care.json` — an example reviewed
  programmatic page row (Program × Service).
- `content/_examples/glossary-white-card.jsonld` — copy-pasteable layered JSON-LD
  (DefinedTerm + FAQPage + Breadcrumb + Organization) for the citation-workhorse format.

---

## What the live site is today (inventory snapshot)

- **Platform:** Squarespace · **Host:** `www.alarahomecare.com` · 17 sitemap URLs.
- **Strong assets to preserve:** flagship EEOICPA page (`/white-card-home-health-las-vegas`,
  ~2,400w + 7 real FAQs), homepage with arch design, services copy, VA page, brand.
- **Problems to fix:** AI-bot blocking, 4 duplicate `-1` pages, thin OWCP page (~800w, 0
  FAQs), no per-service pages, stale VA copy, missing hospice / hospital-at-home / care-
  coordination / glossary / question layers.

Full detail + redirect map in [docs/01](docs/01-inventory-audit-migration.md).

---

## Architecture in one picture

```
                 Programs (EEOICPA · OWCP/FECA · Veterans · Medicare)  ─┐
Conditions (COPD · radiation illness · Parkinson's · heart failure…) ─┤
                 Services (skilled nursing · wound care · infusion…) ──┤
                                                                       ▼
   ┌──────────────── intersection engine (gated by SME review) ───────────────┐
   │  Program × Service   ·   Condition × Program   ·   Question × Program     │
   └───────────────────────────────────────────────────────────────────────────┘
                                       │
        AEO layer:  /glossary (DefinedTerm)  ·  /questions (FAQPage)  ·  FAQ hubs
                                       │
            Server-rendered layered JSON-LD on every page (citation-ready)
                                       │
              Trust-first conversion → patient + physician pathways
```

---

## Recommended immediate next step
Two tracks run in parallel (see [docs/07](docs/07-roadmap.md)):
- **Now, on the current site:** unblock AI crawlers, 301 the duplicates, add FAQ schema,
  refresh the VA page — wins that don't wait for the rebuild.
- **In parallel:** scaffold the Node/Express + SSG platform, extract brand tokens (incl. the
  arch asset) to parity, and migrate the EEOICPA flagship + homepage first.

> **Open questions for the founder** (don't block starting): does Alara offer Hospice /
> Hospital-at-Home today? Keep the proven flagship slug? Who is the named clinical reviewer
> for E-E-A-T? Big-bang vs. hybrid cutover? — listed in [docs/07](docs/07-roadmap.md).
