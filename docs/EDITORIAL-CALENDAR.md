# Alara Editorial Calendar — Articles for SEO / AEO
**Status:** 30 articles live at `/articles/` (launched 2026-07). 20 queued below.
**Cadence:** release 2 per week (Tue/Thu). Queue dates assume a 2026-07-07 start; shift as needed.
**Format standard (locked by the first 30):** one real question per article · sourced to DOL/DOJ/VA/CMS · reviewed-by-RN byline · FAQ block + FAQPage JSON-LD + Article JSON-LD · internal links to the guides and tools · CTA aligned to the reader's state (case review / referral / Navigator) · phone as quiet fallback. Voice rules per CLAUDE.md (no "plainly", no carry/hold metaphors, never disparage calling or town halls). Cost phrasing: "no cost to you". Run `node scripts/check-content.mjs` before shipping.

## Live (30) — published 2026-07
Start here: choosing-a-white-card-home-health-agency · who-owns-your-home-health-agency · how-white-card-billing-works · dol-las-vegas-resource-center · who-decides-my-eeoicpa-claim
White Card & EEOICPA: what-does-the-white-card-cover-at-home · eeoicpa-part-b-vs-part-e · what-is-a-special-exposure-cohort · which-illnesses-qualify-eeoicpa · how-long-does-eeoicpa-take · denied-eeoicpa-claim-what-now · eeoicpa-survivor-benefits-explained
Money families miss: white-card-travel-reimbursement · what-is-a-consequential-condition · impairment-rating-explained · get-paid-to-care-for-a-family-member · white-card-and-medicare-together · reca-deadline-december-2027
Care & hours: how-to-get-more-home-health-hours · what-is-a-letter-of-medical-necessity · wound-care-at-home-white-card · hospital-discharge-home-health · switching-home-health-agencies · home-health-vs-home-care
Nevada: nevada-test-site-worker-benefits · tonopah-yucca-mountain-doe-workers
Other programs: owcp-feca-home-health-federal-workers · va-community-care-home-health · medicare-home-health-basics
Flagship: choosing-a-white-card-home-health-agency (the industry-integrity piece; DOJ-sourced, settlement-safe language)

## Queued (20) — 2/week
| # | Date | Working title / slug | Target query | Notes |
|---|---|---|---|---|
| 31 | Jul 7 | eeoicpa-forms-ee1-ee2-ee3-explained | "form EE-1 EE-2 EE-3" | One-clause job of each form; link Resource Center |
| 32 | Jul 9 | dose-reconstruction-explained | "NIOSH dose reconstruction how long" | Pair with SEC article |
| 33 | Jul 14 | chronic-beryllium-disease-benefits | "chronic beryllium disease compensation" | Part B criteria |
| 34 | Jul 16 | silicosis-eeoicpa-benefits | "silicosis DOE workers compensation" | Tunnel/underground workers |
| 35 | Jul 21 | copd-toxic-exposure-part-e | "COPD DOE worker Part E" | Part E non-cancer path |
| 36 | Jul 23 | wage-loss-compensation-part-e | "EEOICPA wage loss" | The thin-content topic nobody explains |
| 37 | Jul 28 | home-safety-modifications-white-card | "White Card grab bars ramps" | DME/mods coverage |
| 38 | Jul 30 | oxygen-dme-white-card | "White Card oxygen equipment" | DME workflow |
| 39 | Aug 4 | what-is-acentra-wcmbp | "Acentra WCMBP provider portal" | Also serves physicians |
| 40 | Aug 6 | physician-guide-ee17b-lmn | "EE-17B physician" | For doctors; pairs with refer.html |
| 41 | Aug 11 | eeoicpa-vs-reca-differences | "EEOICPA vs RECA" | Comparison query |
| 42 | Aug 13 | downwinders-nevada-benefits | "downwinder compensation Nevada" | RECA group 1 |
| 43 | Aug 18 | uranium-workers-reca-white-card | "uranium miner benefits" | RECA→White Card bridge |
| 44 | Aug 20 | atomic-veterans-benefits | "atomic veterans compensation" | Onsite participants + VA overlap |
| 45 | Aug 25 | caring-for-a-parent-checklist-lv | "caring for aging parent Las Vegas" | Local caregiver SEO |
| 46 | Aug 27 | what-is-a-plan-of-care | "home health plan of care" | Clinical explainer |
| 47 | Sep 1 | infusion-therapy-at-home | "IV infusion at home covered" | Service depth |
| 48 | Sep 3 | fall-prevention-home-health | "fall prevention elderly home" | Clinical + AlaraOS early-catch angle |
| 49 | Sep 8 | medicare-advantage-vs-white-card | "Medicare Advantage White Card" | Common confusion |
| 50 | Sep 10 | pahrump-nye-county-home-health | "home health Pahrump NV" | Local: Test Site's county |

## Standing notes
- **AEO reality check:** staging (alarahc.com) is noindex until production cutover — the library builds now, ranks after launch. Sitemap.xml + production robots go in the cutover PR.
- The flagship integrity article must always track the public record precisely: settlements "resolve allegations," DOJ links live, no adjectives. Update it if new DOJ/OIG actions publish.
- Every new article: add a card to `articles.html` (regenerate the index) and cross-link from at least one guide.
