# 07 — Implementation Roadmap

Sequenced so that **value ships before the rebuild finishes** and **nothing of existing
value is lost**. Phases 0–1 deliver wins on the *current* Squarespace site while the new
platform is built in parallel.

## Phase 0 — Capture & quick wins (Week 1–2) — *do on current site now*
- [x] Full live-site inventory + audit (`docs/01`). ✅ done
- [ ] **Unblock AI crawlers** — apply the corrected `robots.txt` intent on Squarespace
      (platform settings / support) so Claude/GPT/Perplexity bots can read the site. *Highest leverage.*
- [ ] 301 the duplicate `-1` pages → canonicals; remove from sitemap.
- [ ] Add FAQ schema (via Squarespace code injection) to the 7 existing EEOICPA FAQs.
- [ ] Refresh stale VA "fall 2024" copy to current enrollment status.
- [ ] Stand up Search Console + analytics baseline; export/backup all content + assets.

## Phase 1 — Foundation of the new platform (Week 2–5)
- [ ] Scaffold Node/Express + SSG build (`05` repo shape).
- [ ] Extract brand tokens from current site (palette, type scale, **arch SVG/asset**) →
      design-system parity.
- [ ] Build page-type templates + the schema renderer (`lib/schema.js`); wire CI validation.
- [ ] Migrate the flagship EEOICPA hub + homepage to pixel/visual parity.
- [ ] Implement the 301 redirect map.
- [ ] Build `/request-care` + `/refer-a-patient` endpoints → lead pipeline.

## Phase 2 — Pillars + AEO core (Week 5–9)
- [ ] Build all program pillars: EEOICPA (migrate+expand), **OWCP (expand heavily)**, VA.
- [ ] Split `/services` into per-service pages (incl. wound care, infusion as own pages).
- [ ] Launch `/glossary/` with the seed entity set (DefinedTerm schema).
- [ ] Launch `/questions/` seeded from the 7 live FAQs + the brief's target questions.
- [ ] Add Conditions pillar with the first ~8 condition pages.
- [ ] Internal-linking engine + breadcrumbs live; orphan check in CI.

## Phase 3 — Programmatic engine (Week 9–14)
- [ ] Build the content-model → page generator + the editorial review workflow (`04`).
- [ ] Ship the first ~30–50 **reviewed** intersection pages (Program×Service, Condition×Program).
- [ ] Stand up the intake-question → content pipeline (moat flywheel).
- [ ] Add Care Coordination, and confirm/scope Hospice + Hospital-at-Home pages.

## Phase 4 — Local + authority expansion (Week 14+)
- [ ] Location pages (Las Vegas, Henderson, North Las Vegas, Clark County) + LocalBusiness schema.
- [ ] Community resource directory as a linkable asset (`/resources/`).
- [ ] Cornerstone guides (EEOICPA / OWCP complete guides) for links + citations.
- [ ] Citation-tracking dashboard; quarterly SME re-review cadence.

## Cutover (between Phase 2 and 3, when parity verified)
- [ ] Visual parity sign-off → flip DNS (or finish hybrid section migration).
- [ ] Submit new segmented sitemap; monitor Search Console 30/60/90 days.

## Success metrics
- **AEO:** # of target questions where Alara is cited by ChatGPT/Claude/Perplexity/AI
  Overviews; referral sessions from AI domains.
- **SEO:** rankings for EEOICPA / White Card / OWCP / VA home-health terms; indexed
  authoritative pages; Core Web Vitals all green.
- **Conversion:** qualified patient + physician referral volume; call-click + form rates.
- **Moat:** size of reviewed glossary/question/intersection corpus; freshness (% reviewed
  in last 90 days).

## Open items needing founder/SME input (not blockers to start)
1. Does Alara currently offer **Hospice** and **Hospital-at-Home**? (Build only if real.)
2. Keep flagship slug `/white-card-home-health-las-vegas` vs. move to `/programs/eeoicpa/`?
   (Recommendation: keep it.)
3. Named clinical reviewer(s) for `reviewedBy` E-E-A-T fields.
4. Big-bang cutover vs. hybrid section-by-section migration? (Recommendation: hybrid.)
5. AI **training** opt-in/out stance (citation/retrieval bots are unblocked regardless).
