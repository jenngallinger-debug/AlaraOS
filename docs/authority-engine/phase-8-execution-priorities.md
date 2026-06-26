# Phase 8 — Execution Priorities

> Every recommendation scored. Scale 1–5 (5 = highest impact / **lowest** effort).
> **PAI** = Patient-Acquisition Impact (the north star) · **AEO** · **SEO** · **Effort**
> (5 = trivial). Sorted by a patient-weighted score: `PAI×2 + AEO + SEO + Effort`.

## Master priority table

| # | Recommendation | PAI | AEO | SEO | Effort | Score | Phase |
|---|---|:--:|:--:|:--:|:--:|:--:|---|
| 1 | **Unblock AI crawlers** (robots.txt) | 4 | 5 | 3 | 5 | 21 | P7 |
| 2 | **Mark up the ~30 existing FAQs** (FAQPage schema) | 4 | 5 | 4 | 4 | 21 | P6 |
| 3 | **Fix live bugs** ((702)000-0000; 301 the `-1` dupes) | 3 | 2 | 4 | 5 | 17 | P1 |
| 4 | **Name credentialed clinicians** on /about + reviewedBy | 4 | 4 | 3 | 4 | 19 | P6 |
| 5 | **De-stale + activate VA page** (waitlist→intake) | 5 | 2 | 2 | 4 | 18 | P1/3 |
| 6 | **Expand OWCP into a full pillar** (biggest gap) | 5 | 4 | 4 | 2 | 20 | P3 |
| 7 | **Ship glossary v1** (~10 top DefinedTerm pages) | 3 | 5 | 4 | 3 | 18 | P3/6 |
| 8 | **Split /services into per-service pages** (wound, infusion…) | 4 | 4 | 4 | 3 | 19 | P3 |
| 9 | **Build the P1 question pages** (top 25, Phase 4) | 5 | 4 | 4 | 3 | 21 | P4 |
| 10 | **Comparison pages** (EEOICPA vs OWCP, vs RECA, +Medicare, +VA) | 3 | 5 | 4 | 3 | 18 | P3/5 |
| 11 | **Expand /family-caregivers** (paid-caregiver magnet) | 5 | 3 | 3 | 4 | 20 | P3 |
| 12 | **Dedicated /refer flow** for physicians (3 program lanes) | 5 | 2 | 2 | 3 | 17 | P3 |
| 13 | **Condition×Program intersection pages** (reviewed) | 4 | 4 | 4 | 2 | 18 | P5 |
| 14 | **Structure /community-resources** (ItemList, link-magnet) | 2 | 3 | 4 | 3 | 14 | P3 |
| 15 | **Location pages** (LV, Henderson, N.LV, Clark County) | 3 | 3 | 4 | 3 | 16 | P3 |
| 16 | **Migrate off Squarespace** → Node/Render (enables 1,2,schema-at-scale) | 3 | 4 | 4 | 1 | 15 | tech |
| 17 | **Federal Home-Health Benefits Guide** (flagship citable asset) | 3 | 5 | 4 | 1 | 16 | P7 |
| 18 | **Monthly citation audits** (P1 × 4 engines) | 2 | 4 | 1 | 3 | 12 | P7 |
| 19 | **Intake-question → content pipeline** (moat flywheel) | 3 | 5 | 3 | 2 | 16 | P7 |

**Read:** items 1, 2, 9 are the highest patient-weighted scores *and* fast — do them first.
Item 6 (OWCP) and 11 (family caregivers) are the biggest patient unlocks. Item 16 (migration)
is high-value but slow; it *enables* the at-scale items, so start it in parallel, don't wait.

## Next 30 days — "fast citations + fix what's broken"
*(most doable on the current Squarespace site — no rebuild required)*
1. Apply the AI-crawler-friendly robots.txt (or platform request). **[#1]**
2. Add FAQPage schema (code injection) to all ~30 existing FAQs. **[#2]**
3. Fix the (702) 000-0000 bug; 301 the four `-1` duplicates; drop from sitemap. **[#3]**
4. Update the VA page from "fall 2024 waitlist" to active intake. **[#5]**
5. Add 2–3 named, credentialed clinicians (RN/DON) to /about + reviewer bylines. **[#4]**
6. Publish the **top 10 glossary pages** (white-card, eeoicpa, owcp, feca, white-card+home-health,
   consequential-condition, ccn, triwest, special-exposure-cohort, impairment-evaluation). **[#7]**
7. Publish the **top 10 P1 question** answers (Phase 4 list). **[#9]**
8. Stand up Search Console baseline + start the citation-audit log.
> *Outcome:* AI engines can finally read the site, the strongest existing content gets
> structured, and the first new citable pages ship — without waiting on the rebuild.

## Next 90 days — "build the pillars + the platform"
1. Scaffold Node/Express + SSG on Render; migrate flagship EEOICPA + homepage to parity; ship
   the 301 map. **[#16]**
2. **Expand OWCP into the full pillar** (9 pages, Cluster 2) — the biggest patient gap. **[#6]**
3. Split `/services` into per-service pages; build wound-care + infusion sub-pillars. **[#8]**
4. Complete the glossary (~32 DefinedTerm pages). **[#7]**
5. Expand `/family-caregivers` + build the dedicated `/refer` flow (3 lanes). **[#11, #12]**
6. Ship 6 comparison/coordination pages. **[#10]**
7. Build the Conditions pillar (~10 condition pages). **[#13 setup]**
8. Begin **monthly citation audits**; structure `/community-resources`. **[#18, #14]**
> *Outcome:* OWCP authority established, full entity/glossary layer live, conversion paths
> (patient + caregiver + referrer) sharp, platform able to render schema at scale.

## Next 12 months — "own the category + compound the moat"
1. Scale **reviewed** intersection pages (Program×Service, Condition×Program) — Phase 5 waves 3–4. **[#13]**
2. Publish the **Federal Home-Health Benefits Guide** as the canonical cited reference. **[#17]**
3. Stand up the **intake-question → content pipeline** (anonymized) — the self-feeding moat. **[#19]**
4. Build location pages + local link-building (Cold War Patriots, veteran orgs, local press). **[#15]**
5. Confirm + build Hospice / Hospital-at-Home / Care-Coordination clusters if Alara offers them.
6. Quarterly SME re-review of all YMYL pages (keep `lastReviewed` fresh).
7. Expand the national federal-benefits authority layer (beyond Las Vegas) once local is owned.
> *Outcome:* Alara is the cited source for federal-benefits home health across all four AI
> engines, ranks for the core terms, and runs a compounding content flywheel competitors
> can't cheaply match.

## The one-sentence sequencing rule
**Unblock the bots and mark up what already exists (week 1) → build the OWCP pillar, glossary,
and P1 question/service pages (quarter 1) → scale reviewed intersection content + proprietary
research (year 1).** Patient-first at every step; the gate (SME review) is never skipped.

## Open inputs needed from founder/SME (don't block the 30-day list)
- Named clinical reviewer(s) + credentials for E-E-A-T / `reviewedBy`.
- Does Alara offer Hospice / Hospital-at-Home today? (build only if real)
- Confirm OWCP/VA coverage specifics per service before those pages publish (gate truthfulness).
- Squarespace vs. Node migration go-ahead (recommended: hybrid, build in parallel).
