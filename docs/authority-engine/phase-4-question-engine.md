# Phase 4 — The Question Engine

> Goal restated: **patients, not traffic.** A question that produces one White Card home-health
> patient is worth more than 10,000 visits on "what is a federal employee." So every question is
> scored on **patient-acquisition priority first**, then AEO/SEO value.
> Structured bank: `content/data/questions.csv` (expandable to 500+ via the patterns below).

## Scoring model (the 4 attributes the brief asked for)

| Attribute | Values | Meaning |
|---|---|---|
| **intent** | `transactional` · `commercial-investigation` · `informational` · `navigational` | what the asker wants to *do* |
| **difficulty** | `low` · `med` · `high` | how hard to rank/own. **Low = under-served niche = grab now.** Most EEOICPA/OWCP queries are LOW difficulty (almost no authoritative competition). |
| **authority_opp** | `high` · `med` · `low` | chance to become *the* cited source (AEO). High where answers are scattered/absent. |
| **patient_priority** | `P1` · `P2` · `P3` | **P1** = asker is a likely patient/caregiver/referrer ready to act · **P2** = mid-funnel, qualifying · **P3** = top-funnel/traffic |

**Build order = P1 first.** A P1+low-difficulty+high-authority question is a "drop everything" page.

## The 12 clusters (brief's groupings)
EEOICPA · White Card · DOE Workers · OWCP · FECA · VA Benefits · Home Health · Wound Care ·
Infusion Therapy · Skilled Nursing · Veterans · Southern Nevada.

## The patient-acquisition signal (how we tell P1 from P3)
A question is **P1** when the asker is plausibly *the patient, their family, or their referrer*
and the answer leads to "call Alara." Tells:
- First-person + action: "**Can I get** paid to care for my husband?", "**How do I switch** agencies?"
- Coverage-for-my-situation: "Does the White Card cover **my** wound care at home?"
- Local + service: "home wound care **Las Vegas**", "OWCP home health **near me**"
- Referrer phrasing: "how to refer a White Card patient", "EEOICPA home health order"
P3 = definitional/academic ("what year did EEOICPA pass") — good for authority/links, not patients.

## Top 25 patient-generating questions (build these pages first)
*(all P1; nearly all LOW difficulty / HIGH authority opportunity — the fast money)*
1. Does the White Card cover home health care? → `/white-card-home-health-las-vegas`
2. Can I get paid to care for my family member with a White Card? → `/family-caregivers`
3. How do I switch my White Card home health agency? → `/switching`
4. Does EEOICPA cover wound care at home? → `/eeoicpa-wound-care`
5. Does EEOICPA cover home infusion / IV therapy? → `/eeoicpa-infusion-therapy`
6. How do I get an EEOICPA White Card in Las Vegas? → `/get-a-white-card`
7. Do I pay anything for White Card home health? → `/white-card-home-health-las-vegas`
8. Does OWCP cover home health care? → `/owcp-home-health`
9. Can postal workers get home health through OWCP? → `/owcp-postal-workers`
10. Does the VA pay for home health care? → `/va-home-health-eligibility`
11. Am I eligible for VA home health in Las Vegas? → `/va-home-health-eligibility`
12. Can I have the White Card and Medicare at the same time? → `/white-card-and-medicare`
13. What home health does the White Card cover for Nevada Test Site workers? → `/eeoicpa-for-nevada-test-site-workers`
14. How fast can White Card home health start? → flagship FAQ
15. Does EEOICPA cover a consequential condition's wound care? → `/eeoicpa-consequential-conditions`
16. How does a doctor refer a White Card patient for home health? → `/physicians`
17. Can I have EEOICPA and VA benefits together? → `/can-i-have-eeoicpa-and-va-benefits`
18. Who qualifies for an EEOICPA White Card? → `/get-a-white-card`
19. Does OWCP cover skilled nursing at home? → `/owcp-skilled-nursing`
20. What's the difference between EEOICPA and OWCP? → `/eeoicpa-vs-owcp`
21. Does the White Card cover caregiver training? → flagship FAQ
22. Can a survivor get EEOICPA benefits? → `/get-a-white-card`
23. Does EEOICPA cover home health for COPD? → `/copd-and-eeoicpa`
24. How much does EEOICPA pay? → `/get-a-white-card`
25. Does the VA cover home wound care for veterans? → `/veterans-wound-care`

## Expansion patterns (mechanical path to 500+, still high quality)
Generate the long tail by crossing the graph (Phase 2), then SME-review before publishing:
- **Coverage:** `Does {program} cover {service}?` × {EEOICPA, White Card, OWCP, FECA, VA, Medicare} × {home health, wound care, infusion, skilled nursing, PT, OT, HHA, caregiver, hospice} → ~54
- **Eligibility:** `How do I qualify for {program}?` / `Who qualifies for {program/benefit}?`
- **Process:** `How do I {apply for / switch / refer for} {program/service}?`
- **Cost:** `Do I pay anything for {service} under {program}?` / `Is {service} free with {program}?`
- **Condition×Program:** `Does {program} cover home health for {condition}?` × 10 conditions × 4 programs → ~40
- **Comparison:** `{program A} vs {program B}` / `Can I have {A} and {B}?`
- **Local:** `{service/program} home health in {Las Vegas/Henderson/Clark County}` → ~30
- **Forms/admin:** `What is form {EE-1/EE-2/CA-16/OWCP-915}?`
Each generated question inherits a default destination from the matrix; SME confirms truth +
patient_priority before it becomes a page or pillar-FAQ entry.

## How questions become pages (routing)
- **P1 + standalone demand** → its own `/questions/` page **or** the matching cluster page's hero answer.
- **P2/long-tail** → an entry in the relevant **pillar FAQ block** (FAQPage schema) — not a thin standalone page.
- **P3** → glossary or guide; supports authority/links, light CTA.
This keeps the site from spawning thousands of thin pages (YMYL-safe — see Phase 5).
