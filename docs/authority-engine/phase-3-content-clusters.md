# Phase 3 — Content Cluster Architecture

> The build spec. Every page below has: **intent**, **target entities**, **internal links**,
> **schema**, **conversion**. ⭐ = exists today (migrate/expand). ➕ = new.
> Hub-and-spoke: spokes link up to pillar + sideways to 2–4 siblings; intersection pages link
> to all parents. Conversion key: **P**=patient ("free 10-min eligibility call"), **R**=referrer
> ("refer a patient / 2-hr response"), **C**=caregiver, **L**=learn (soft asset).

---

## CLUSTER 1 — EEOICPA (the flagship pillar)

**Pillar:** `/eeoicpa` ➕ (new clean pillar) — or keep `/white-card-home-health-las-vegas` ⭐ as flagship and treat `/eeoicpa` as the broader hub.
- *Intent:* informational→commercial · *Entities:* EEOICPA, White Card, DOE Worker, DEEOIC · *Schema:* MedicalWebPage+FAQPage+Service · *Links:* ↓ all supporting · *Conversion:* P+R

| Page | Intent | Target entities | Schema | Conv |
|---|---|---|---|---|
| `/what-is-eeoicpa` ➕ | inform | EEOICPA, DEEOIC, Part B/E | DefinedTerm+FAQPage | L→P |
| `/white-card-home-health-las-vegas` ⭐ | commercial | White Card, home health | FAQPage(7!)+Service | P |
| `/get-a-white-card` ⭐ | commercial | application, EE-1/EE-2, survivor | HowTo+FAQPage | P |
| `/eeoicpa-covered-services` ➕ | inform | covered services, Part B medical | Service+FAQPage | P |
| `/eeoicpa-home-health` ➕ | commercial | home health coverage | MedicalWebPage+FAQPage | P |
| `/eeoicpa-wound-care` ➕ | commercial | wound care coverage | Service+FAQPage | P+R |
| `/eeoicpa-infusion-therapy` ➕ | commercial | infusion/IV coverage | Service+FAQPage | P+R |
| `/eeoicpa-caregiver-services` ⭐(=family-caregivers) | high-intent | paid family caregiver | Service+FAQPage | C |
| `/eeoicpa-benefits-nevada` ➕ | local | NTS, NNSS, Clark County | MedicalWebPage | P |
| `/eeoicpa-consequential-conditions` ➕ | inform | consequential condition | DefinedTerm+FAQPage | P |
| `/eeoicpa-covered-conditions` ➕ | inform | SEC, beryllium, radiation | MedicalCondition list | P |
| `/eeoicpa-faq` ➕ | inform | (all) | FAQPage | P |
| `/switching` ⭐ | bottom-funnel | provider switching | HowTo+FAQPage | P |
| `/how-to-choose` ⭐ | investigation | agency selection | FAQPage+Article | P |
| `/physicians` ⭐ | referrer | referral, CPT 99080, LMN | FAQPage+MedicalWebPage | R |

**Internal-link rule for cluster:** flagship links down to all; each supporting links up to `/eeoicpa` + to `/white-card-home-health-las-vegas` + to the matching glossary term.

---

## CLUSTER 2 — OWCP / FECA (biggest growth opportunity — currently 1 thin page)

**Pillar:** `/owcp` ➕ (expand from `/owcp-federal-workers` ⭐)
- *Intent:* informational→commercial · *Entities:* OWCP, FECA, DFEC, Federal/Postal Worker · *Schema:* MedicalWebPage+FAQPage+Service · *Conversion:* P+R

| Page | Intent | Target entities | Schema | Conv |
|---|---|---|---|---|
| `/what-is-owcp` ➕ | inform | OWCP, FECA, DFEC | DefinedTerm+FAQPage | L→P |
| `/owcp-home-health` ➕ | commercial | home health coverage | MedicalWebPage+FAQPage | P |
| `/owcp-postal-workers` ➕ | commercial | USPS, FECA | MedicalWebPage+FAQPage | P |
| `/owcp-how-to-qualify` ➕ | commercial | authorization, CA-16/CA-17 | HowTo+FAQPage | P |
| `/owcp-covered-services` ➕ | inform | covered services, OWCP-915 | Service+FAQPage | P |
| `/owcp-skilled-nursing` ➕ | commercial | skilled nursing | Service+FAQPage | P+R |
| `/owcp-wound-care` ➕ | commercial | wound care | Service+FAQPage | P+R |
| `/owcp-faq` ➕ | inform | (all) | FAQPage | P |
| `/owcp-for-physicians` ➕ | referrer | OWCP referral path | FAQPage | R |

---

## CLUSTER 3 — Veterans / VA Community Care

**Pillar:** `/veterans-affairs` ⭐ (de-stale, expand, add FAQs)
- *Entities:* VA CCN, TriWest, Region 4, Veteran, PACT Act · *Schema:* MedicalWebPage+FAQPage+Service · *Conversion:* P+R

| Page | Intent | Entities | Schema | Conv |
|---|---|---|---|---|
| `/va-home-health-eligibility` ➕ | commercial | CCN eligibility, referral | HowTo+FAQPage | P |
| `/va-community-care-network` ➕ | inform | CCN, TriWest | DefinedTerm+FAQPage | L |
| `/veterans-wound-care` ➕ | commercial | wound care | Service+FAQPage | P+R |
| `/veterans-physical-therapy` ➕ | commercial | PT | Service+FAQPage | P+R |
| `/va-aid-and-attendance` ➕ | inform | Aid & Attendance | DefinedTerm+FAQPage | L→P |
| `/veterans-faq` ➕ | inform | (all) | FAQPage | P |

---

## CLUSTER 4 — Services (split `/services` ⭐ into spokes; promote wound care + infusion to sub-pillars)

**Pillar:** `/services` ⭐ (hub)

| Page | Intent | Entities | Schema | Conv |
|---|---|---|---|---|
| `/services/skilled-nursing` ➕ | commercial | skilled nursing, RN | MedicalProcedure | P+R |
| `/services/wound-care` ➕ **(sub-pillar)** | commercial | wound care, chronic wounds | MedicalTherapy+FAQPage | P+R |
| `/services/infusion-therapy` ➕ **(sub-pillar)** | commercial | IV/infusion | MedicalTherapy+FAQPage | P+R |
| `/services/physical-therapy` ➕ | commercial | PT | MedicalTherapy | P+R |
| `/services/occupational-therapy` ➕ | commercial | OT | MedicalTherapy | P+R |
| `/services/home-health-aide` ➕ | commercial | HHA, ADLs | Service | P |
| `/services/medical-social-work` ➕ | inform | MSW, benefits nav | Service | P |
| `/services/care-coordination` ➕ | inform | care coordination | Service | R |
| `/services/hospice` ➕ | commercial | hospice *(confirm offered)* | MedicalBusiness | P |
| `/services/hospital-at-home` ➕ | commercial | hospital-at-home *(confirm)* | MedicalBusiness | P+R |

---

## CLUSTER 5 — Conditions (clinical layer; each links to treating service + covering program)

**Pillar:** `/conditions` ➕
Pages (each `MedicalCondition` + FAQPage, conversion P): `/conditions/chronic-beryllium-disease`,
`/conditions/chronic-radiation-illness`, `/conditions/copd`, `/conditions/heart-failure`,
`/conditions/diabetes`, `/conditions/chronic-kidney-disease`, `/conditions/stroke-recovery`,
`/conditions/parkinsons`, `/conditions/cancer`, `/conditions/chronic-wounds`.
- Each condition page links → its service(s) + its program(s) + relevant intersection pages.

---

## CLUSTER 6 — Glossary (AEO citation workhorse — one entity per page)

**Set:** `/glossary` ➕ (`DefinedTermSet`). Each page = `DefinedTerm`+`MedicalWebPage`+`FAQPage`, opens with a 2–3 sentence quotable definition, cites DOL/VA, conversion L→P.
Seed terms: white-card, eeoicpa, deeoic, eeoicpa-part-b, eeoicpa-part-e, special-exposure-cohort,
consequential-condition, impairment-evaluation, reca, atomic-weapons-employer, doe-worker,
nuclear-worker, nevada-national-security-site, owcp, feca, dfec, dcmwc, ca-16, owcp-authorization,
va-community-care, community-care-network, triwest, pact-act, aid-and-attendance,
medicare-home-health, skilled-nursing, wound-care, infusion-therapy, care-coordination,
home-health-aide, hospital-at-home, eeoicpa-survivor. *(~32 to start; expand from the graph.)*

---

## CLUSTER 7 — Question hub (AEO — see Phase 4 for the 500)

**Set:** `/questions` ➕. Each = one URL per real question, `FAQPage`/`QAPage`, inverted-pyramid
(direct 40–60w answer first), cites authority, conversion P. These roll up into the relevant
pillar's FAQ block. Top patient-acquisition questions get standalone pages; the long tail lives
in pillar FAQ sections. Destinations are assigned in `content/data/questions.csv`.

---

## CLUSTER 8 — Intersection pages (the programmatic layer — Phase 5 generates these)

Each links to **all three parents** (program pillar + service/condition page + matching question), conversion P+R, schema `MedicalWebPage`+`Service`+`FAQPage`.

**Program × Service:** `/eeoicpa-wound-care`, `/eeoicpa-infusion-therapy`, `/owcp-home-health`,
`/owcp-skilled-nursing`, `/veterans-physical-therapy`, `/veterans-wound-care`… *(start ~15 true cells)*

**Condition × Program:** `/copd-and-owcp`, `/chronic-radiation-illness-eeoicpa`,
`/heart-failure-owcp`, `/parkinsons-veterans`, `/chronic-beryllium-disease-eeoicpa`… *(start ~10)*

**Comparison / coordination:** `/eeoicpa-vs-va-benefits` ➕, `/eeoicpa-and-triwest` ➕,
`/can-i-have-eeoicpa-and-va-benefits` ➕, `/eeoicpa-vs-owcp` ➕, `/white-card-and-medicare` ➕,
`/eeoicpa-vs-reca` ➕. *(comparison pages punch above their weight in AI citations)*

**Program × Geography:** `/eeoicpa-for-nevada-test-site-workers` ➕, `/eeoicpa-benefits-nevada` ➕,
`/owcp-home-health-las-vegas` ➕, `/va-home-health-las-vegas` ➕.

---

## CLUSTER 9 — Local / geography

**Pillar:** `/locations` ➕ → `/locations/las-vegas`, `/locations/henderson`,
`/locations/north-las-vegas`, `/locations/clark-county`. Each `LocalBusiness` w/ specific
`areaServed`, links to all program pillars, conversion P. Plus `/resources/` ⭐ (from
community-resources) as a `CollectionPage` link-magnet (fix the phone bug).

---

## Linking architecture summary
```
            ┌──────────── /glossary (entities) ────────────┐  (linked on first mention everywhere)
            │                                               │
/eeoicpa ─┬─ supporting ─┬─ intersection ─┬─ /questions ─── pillar FAQ rollups
/owcp ────┤              │                │
/va ──────┤   services ──┘   conditions ──┘
/services ┘        (each spoke ↑pillar  ↔siblings  →matching question/glossary)
```
**CI guardrail:** build fails if any page has < 2 internal inlinks (no orphans) or an entity
mention without its glossary link.
