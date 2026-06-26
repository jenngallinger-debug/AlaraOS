# Phase 1 — Live-Site Inventory & Audit

> Grounded in a full crawl of `www.alarahomecare.com` (June 2026): sitemap + every
> content-bearing page read directly. Word counts are estimates from page text.

## 🔧 Live bugs found (fix this week — no rebuild needed)
- **`/community-resources` shows a placeholder phone "Call Alara at (702) 000-0000"** in the
  body. Real number is (702) 814-9630. Embarrassing on a trust page — fix now.
- **4 duplicate `-1` pages** in the sitemap (`/physicians-1`, `/get-a-white-card-1`,
  `/how-to-choose-1`, `/family-caregivers-1`) — duplicate-content dilution → 301 + de-index.
- **robots.txt blocks `ClaudeBot`/`GPTBot`/`Amazonbot`** — the site is opted out of AI
  citation. (Corrected file already drafted at `public/robots.txt`.)
- **Stale VA copy** ("enrolling… fall 2024"). **About page** confirms Alara IS a live VA CCN
  provider (Region 4 / TriWest) — so update the VA page from "waitlist" to active intake.

## Per-page inventory

### 1. `/home` — Homepage
- **Topic:** federal-program home health (EEOICPA/OWCP/VA), Las Vegas · **Primary entity:** Alara Home Care (MedicalOrganization)
- **Search intent:** brand/navigational + broad "home health Las Vegas" · **Commercial intent:** HIGH (intake)
- **Missing entities:** Nevada National Security Site, infusion therapy, care coordination, hospital-at-home
- **Missing FAQ:** none needed (hub) · **Missing schema:** full `MedicalOrganization`+`LocalBusiness`+`WebSite`/SearchAction graph
- **Verdict: KEEP** (add org schema, link to new clusters)

### 2. `/about` — About / Founder
- **Topic:** mission, who-served, founder · **Word count:** ~1,200–1,400 · **Primary entity:** Alara Home Care + Founder (Person)
- **Search intent:** trust/E-E-A-T · **Commercial intent:** MED
- **E-E-A-T present:** founder (20+ yrs healthcare exec, **unnamed**), DON reviews cases (**unnamed**), VA CCN Region 4 / TriWest
- **Missing entities:** named clinicians + credentials (RN/DON), licensure #, NPI, accreditation
- **Missing FAQ:** "Is Alara licensed/accredited?" · **Missing schema:** `AboutPage`, `Person` (founder + DON), `MedicalOrganization` w/ `employee`
- **Verdict: EXPAND** (add named, credentialed people — biggest E-E-A-T lever on the site)

### 3. `/contact`
- **Topic:** contact/intake · **Primary entity:** Alara Home Care · **Intent:** transactional · **Commercial:** HIGH
- **Missing schema:** `ContactPage`, `LocalBusiness` w/ hours/geo · **Verdict: KEEP** (wire to lead pipeline; route patient vs referrer)

### 4. `/white-card-home-health-las-vegas` — **EEOICPA FLAGSHIP**
- **Topic:** White Card home health coverage · **Word count:** ~2,200–2,400 · **Primary entity:** White Card / EEOICPA
- **Search intent:** informational→commercial ("does white card cover home health") · **Commercial intent:** VERY HIGH
- **Existing FAQs (7):** covers home health? / cost? / consequential condition? / Medicare combo? / caregiver training? / home mods? / travel reimb?
- **Missing entities:** DEEOIC, Special Exposure Cohort, Part B vs Part E, impairment evaluation, RECA (distinguish)
- **Missing FAQ:** "Which conditions are covered?", "How fast can home health start?", "Do I need a doctor's order?"
- **Missing schema:** `FAQPage` (the 7 FAQs are unmarked!), `MedicalWebPage`+`reviewedBy`, `Service`
- **Verdict: KEEP + become the EEOICPA pillar** (mark up FAQs immediately = fast AI/SEO win)

### 5. `/veterans-affairs` — VA CCN
- **Topic:** VA Community Care home health · **Word count:** ~1,250 · **Primary entity:** VA Community Care Network
- **Search intent:** informational + referrer · **Commercial intent:** HIGH · **FAQs:** 0
- **Missing entities:** TriWest, Region 4, PACT Act, VA referral/authorization, aid & attendance
- **Missing FAQ:** "Am I eligible for VA home care?", "Does the VA pay for home health?", "What is CCN?"
- **Missing schema:** `FAQPage`, `MedicalWebPage`, `Service` · **Verdict: EXPAND + de-stale** (activate intake)

### 6. `/community-resources`
- **Topic:** Southern NV resource directory (EEOICPA/veteran/senior) · **Word count:** ~2,200 · **Primary entity:** community resources (local)
- **Search intent:** informational/local · **Commercial intent:** LOW (but strong link-magnet + local trust)
- **Asset:** ~19 curated external links (Cold War Patriots, DOL Resource Center, VA SNHS, etc.) — real local-authority signal
- **Missing schema:** `ItemList`/`CollectionPage`, `BreadcrumbList` · **Fix:** the (702) 000-0000 bug
- **Verdict: KEEP + EXPAND into a structured, linkable local asset (moat)**

### 7. `/physicians` — Referrer pathway
- **Topic:** EEOICPA referral workflow for physicians · **Word count:** ~1,200 · **Primary entity:** physician referral
- **Search intent:** referrer/commercial · **Commercial intent:** VERY HIGH (referral source) · **FAQs:** 5
- **Detail:** 48-hr assessment, CPT 99080, Letter of Medical Necessity, 60-day exam window
- **Missing entities:** OWCP referral path, VA referral path (page is EEOICPA-only) · **Missing schema:** `FAQPage`, `MedicalWebPage`
- **Verdict: KEEP + EXPAND** (add OWCP & VA referral lanes; build dedicated `/refer` form). Normalize `/for-physicians`→`/physicians`.

### 8. `/switching` — Switch provider
- **Topic:** switching White Card home health agency · **Word count:** ~800 · **Primary entity:** provider switching · **FAQs:** 4
- **Search intent:** commercial-investigation (high patient-acquisition intent) · **Commercial intent:** VERY HIGH
- **Missing FAQ:** "How long does switching take?", "Will my nurse change?" · **Missing schema:** `FAQPage`, `HowTo`
- **Verdict: KEEP** (excellent bottom-funnel page; add schema, link from EEOICPA pillar)

### 9. `/how-to-choose` — "Seven Questions"
- **Topic:** how to choose a White Card agency · **Word count:** ~750 · **Primary entity:** agency selection
- **Search intent:** commercial-investigation · **Commercial intent:** HIGH · **Differentiator:** DOJ-settlement-history question
- **Missing schema:** `FAQPage` (turn 7 questions into Q&A), `Article`/`reviewedBy`
- **Verdict: KEEP + reformat** into AEO question/checklist content

### 10. `/family-caregivers` — Paid family caregiver
- **Topic:** get paid to care for family under EEOICPA (W-2) · **Word count:** ~800 · **Primary entity:** paid family caregiver program · **FAQs:** 4
- **Search intent:** high-intent commercial ("can I get paid to care for my parent") · **Commercial intent:** VERY HIGH (strong differentiator)
- **Missing entities:** consumer-directed care, EEOICPA in-home care benefit · **Missing schema:** `FAQPage`, `Service`
- **Verdict: KEEP + EXPAND** (one of the strongest patient-acquisition magnets on the site)

### 11. `/get-a-white-card` — Eligibility & apply
- **Topic:** how to get a White Card / EEOICPA eligibility · **Word count:** ~1,200 · **Primary entity:** EEOICPA application · **FAQs:** 4
- **Detail:** Part B ($150k + lifetime medical), Part E (up to $250k), EE-1/EE-2, DOL Resource Center (702) 697-0841, survivors, impairment eval
- **Search intent:** informational→commercial (very high) · **Commercial intent:** VERY HIGH
- **Missing entities:** SEC, covered facilities list, AWE, RECA vs EEOICPA · **Missing schema:** `FAQPage`, `HowTo`, `MedicalWebPage`
- **Verdict: KEEP + EXPAND into the EEOICPA-eligibility supporting pillar**

### 12. `/owcp-federal-workers` — OWCP/FECA ⚠️ thinnest priority page
- **Topic:** OWCP home health for federal workers · **Word count:** ~800 · **Primary entity:** OWCP/FECA · **FAQs:** 0
- **Search intent:** informational→commercial · **Commercial intent:** VERY HIGH · **Categories listed:** USPS, VA, fed LE, TSA, DoD civilians
- **Missing entities:** DFEC, OWCP-915, CA-16/CA-17, authorization, DCMWC (coal), Form OWCP-04, postal-worker specifics
- **Missing FAQ:** ALL — "Does OWCP cover home health?", "How do I qualify?", "Who pays?", "What's a CA-16?"
- **Missing schema:** `FAQPage`, `MedicalWebPage`, `Service` · **Verdict: EXPAND HEAVILY → OWCP pillar** (biggest underbuilt opportunity)

### 13–16. `/family-caregivers-1`, `/get-a-white-card-1`, `/how-to-choose-1`, `/physicians-1`
- Duplicate drafts. **Verdict: REMOVE / 301** to canonicals; drop from sitemap.

### 17. `/services` — Services overview
- **Topic:** skilled nursing, PT, OT, MSW, HHA (wound care, IV, disease mgmt inside SN) · **Primary entity:** home health services
- **Search intent:** informational/commercial · **Commercial intent:** HIGH
- **Missing entities:** infusion therapy, wound care, hospice, hospital-at-home, care coordination, targeted case management as **own pages**
- **Missing schema:** `Service`/`MedicalProcedure` per service · **Verdict: KEEP hub + SPLIT into per-service spokes**

## Summary recommendations
| Action | Pages |
|---|---|
| **KEEP** (as strong anchors) | /home, /contact, /white-card-home-health-las-vegas, /switching, /how-to-choose |
| **EXPAND** | /about (named clinicians), /owcp-federal-workers (heavily), /veterans-affairs, /family-caregivers, /get-a-white-card, /physicians, /community-resources, /services→split |
| **CONSOLIDATE** | /services into hub+spokes; physician referral lanes |
| **REMOVE / 301** | all 4 `-1` duplicates |

**Inventory verdict:** the site already has a *remarkably* strong EEOICPA content core (flagship + get-a-white-card + family-caregivers + switching + physicians + how-to-choose ≈ 7,000+ words of real, high-intent EEOICPA content). The gaps are: (1) zero schema markup on existing FAQs, (2) OWCP underbuilt, (3) no glossary/entity layer, (4) no per-service pages, (5) AI bots blocked, (6) unnamed clinicians. Phases 2–8 build on this core rather than replacing it.
