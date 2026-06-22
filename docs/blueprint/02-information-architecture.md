# 02 — Information Architecture & Full Site Map

> Goal: a scalable taxonomy where every page belongs to a cluster, every cluster has a
> pillar, and every pillar earns links + conversions. Designed for SEO, AEO, and humans.

## Design principles
1. **Hub-and-spoke.** Each top-level section is a *pillar* (broad authority page) with
   *spokes* (specific pages) linking up to it and across to siblings.
2. **One entity per URL.** Wound care, infusion, EEOICPA, OWCP, VA each get a clean,
   memorable, durable slug. No combined dumping-ground pages.
3. **Intersection pages are first-class.** Program × Service, Condition × Program, and
   Question × Program live in predictable, crawlable directories (powers `04`).
4. **Local is layered in, not bolted on.** Las Vegas / Clark County signals live at the
   template level, plus dedicated geo pages.

## Top-level navigation (preserve current header; extend it)
`Home · Conditions · Programs & Benefits · Services · For Patients & Families ·
For Physicians · Resources · About · Request Care`

(Current nav — Home/About/Services/Veterans/White Card/OWCP/Physicians/Community
Resources/Contact — maps cleanly into this; "White Card" + "OWCP" + "Veterans" become
children of **Programs & Benefits**.)

## Full site map (canonical taxonomy)

```
/                                   Homepage (preserve arch design)
/about                              + team bios, licensure, credentials (E-E-A-T)
/contact
/request-care                       primary patient intake
/refer-a-patient                    primary physician/referrer intake

/programs/                          ── PILLAR: Programs & Benefits
  /programs/eeoicpa/                EEOICPA hub  (← /white-card-home-health-las-vegas 301s in OR becomes child)
    /programs/eeoicpa/white-card/           "What the White Card covers"
    /programs/eeoicpa/get-a-white-card/     eligibility + apply (← /get-a-white-card)
    /programs/eeoicpa/consequential-conditions/
    /programs/eeoicpa/covered-conditions/   (SEC-8 / Special Exposure Cohort, etc.)
    /programs/eeoicpa/with-medicare/
  /programs/owcp/                   OWCP/FECA hub  (← /owcp-federal-workers — EXPAND)
    /programs/owcp/federal-workers/
    /programs/owcp/postal-workers/          (USPS-specific — high intent)
    /programs/owcp/how-to-qualify/
    /programs/owcp/covered-services/
  /programs/veterans/               VA CCN hub  (← /veterans-affairs)
    /programs/veterans/community-care-network/
    /programs/veterans/eligibility/
  /programs/medicare/               Medicare home health (coordination)

/conditions/                        ── PILLAR: Conditions
  /conditions/copd/
  /conditions/chronic-radiation-illness/
  /conditions/chronic-beryllium-disease/
  /conditions/heart-failure/
  /conditions/diabetes/
  /conditions/parkinsons/
  /conditions/stroke-recovery/
  /conditions/cancer/
  /conditions/chronic-kidney-disease/
  /conditions/wound-related-conditions/
  /conditions/complex-chronic-conditions/   (cluster pillar)

/services/                          ── PILLAR: Services  (split current /services)
  /services/skilled-nursing/
  /services/wound-care/
  /services/infusion-therapy/               (IV therapy — own page)
  /services/physical-therapy/
  /services/occupational-therapy/
  /services/home-health-aide/
  /services/medical-social-work/
  /services/targeted-case-management/
  /services/care-coordination/              (NEW — brief priority)
  /services/hospice/                        (NEW — brief priority; confirm offered)
  /services/hospital-at-home/               (NEW — brief priority; confirm offered)

/programs-services/                 ── PROGRAMMATIC: Program × Service (see 04)
  /programs-services/eeoicpa-wound-care/
  /programs-services/eeoicpa-infusion-therapy/
  /programs-services/owcp-home-health/
  /programs-services/owcp-skilled-nursing/
  /programs-services/veterans-physical-therapy/      …(matrix)

/conditions-programs/               ── PROGRAMMATIC: Condition × Program (see 04)
  /conditions-programs/copd-eeoicpa/
  /conditions-programs/radiation-illness-eeoicpa/
  /conditions-programs/parkinsons-veterans/
  /conditions-programs/heart-failure-owcp/           …(matrix)

/questions/                         ── AEO: Question hub (see 03)
  /questions/what-is-a-white-card/
  /questions/how-do-i-qualify-for-eeoicpa/
  /questions/does-owcp-cover-home-health/
  /questions/can-veterans-receive-home-health/
  /questions/eeoicpa-vs-owcp/
  /questions/does-eeoicpa-cover-wound-care/
  /questions/can-owcp-pay-for-infusion-therapy/      …(scales with engine)

/glossary/                          ── AEO: entity definitions (see 03)
  /glossary/white-card/
  /glossary/eeoicpa/
  /glossary/owcp/
  /glossary/feca/
  /glossary/consequential-condition/
  /glossary/special-exposure-cohort/
  /glossary/community-care-network/
  /glossary/skilled-nursing/    …(one per entity)

/guides/                            ── Long-form resources (link magnets / moat)
  /guides/eeoicpa-home-health-complete-guide/
  /guides/owcp-home-health-complete-guide/
  /guides/choosing-a-home-health-agency/   (← /how-to-choose)
  /guides/switching-home-health-providers/ (← /switching)
  /guides/family-caregiver-handbook/       (← /family-caregivers)

/resources/                         ── Community + downloadable assets
  /resources/community/              (← /community-resources — expand into moat asset)
  /resources/las-vegas/              local resource directory (linkable)
  /resources/forms/                  intake/referral forms

/physicians/                        ── PILLAR: For Physicians  (← /physicians)
  /physicians/refer/                 referral workflow
  /physicians/what-to-expect/

/locations/                         ── Local SEO layer
  /locations/las-vegas/
  /locations/henderson/
  /locations/north-las-vegas/
  /locations/clark-county/
```

## Navigation & crawl rules
- **Breadcrumbs everywhere** (`Home › Programs › EEOICPA › White Card`) with Breadcrumb schema.
- **Pillar pages link down** to every spoke; **spokes link up** to pillar + sideways to 2–4 siblings.
- **Intersection pages link to all three parents** (the program, the service/condition, and
  the relevant question) — this is what makes the programmatic layer earn its keep.
- **HTML sitemap** at `/sitemap` for users + machine `sitemap.xml` segmented by section.
- Max depth 3 clicks from home to any page.

## Mapping table — old → new (redirect spec)
| Old URL | New canonical | Action |
|---|---|---|
| `/white-card-home-health-las-vegas` | keep, or `/programs/eeoicpa/white-card/` | **Keep slug** (high equity) OR 301 with care |
| `/owcp-federal-workers` | `/programs/owcp/` | 301 + expand |
| `/veterans-affairs` | `/programs/veterans/` | 301 |
| `/services` | `/services/` (hub) | keep; split spokes |
| `/get-a-white-card` | `/programs/eeoicpa/get-a-white-card/` | 301 |
| `/how-to-choose` | `/guides/choosing-a-home-health-agency/` | 301 |
| `/switching` | `/guides/switching-home-health-providers/` | 301 |
| `/family-caregivers` | `/guides/family-caregiver-handbook/` | 301 |
| `/community-resources` | `/resources/community/` | 301 |
| `/*-1` duplicates | respective canonical | 301, drop from sitemap |

> Decision flag for founder: keep the proven `/white-card-home-health-las-vegas` slug as the
> EEOICPA flagship (lowest risk, it already ranks), and nest the *new* sub-pages under
> `/programs/eeoicpa/`. Recommended: **keep the flagship slug.**
