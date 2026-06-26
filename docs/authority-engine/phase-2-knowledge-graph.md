# Phase 2 — The Alara Knowledge Graph

> The entity model the whole platform is built on. Every page, FAQ, glossary term, and
> JSON-LD `@id` references nodes here. Owning a *topic* means owning its *entities* and the
> relationships between them — that is what AI engines reason over when they decide whom to cite.
> Machine-readable version: `content/data/knowledge-graph.json`.

## The five domains

```
ALARA KNOWLEDGE GRAPH
├── 1. PROGRAMS (federal benefits)        ← the moat
├── 2. BENEFICIARIES (who qualifies)      ← the audience
├── 3. SERVICES (care delivered)          ← the offering
├── 4. CONDITIONS (why care is needed)    ← the clinical layer
└── 5. GEOGRAPHY (where)                  ← local authority
```

---

## 1. PROGRAMS

### EEOICPA  *(top-level program entity — the crown)*
- **Children:** White Card · Part B · Part E · Impairment Evaluation · Consequential Condition
  · Special Exposure Cohort (SEC) · Covered Conditions
- **Administered by:** DOL → **DEEOIC** (Division of Energy Employees Occupational Illness Compensation)
- **Related (distinguish, don't conflate):** RECA (Radiation Exposure Compensation Act) · OWCP · VA benefits
- **Key facts to own:** Part B = $150k + lifetime medical; Part E = up to $250k (wage loss/impairment);
  forms EE-1 (worker) / EE-2 (survivor); DOL Las Vegas Resource Center (702) 697-0841
- **Pages:** `/eeoicpa` (pillar) · `/white-card-home-health-las-vegas` · `/get-a-white-card` · `/glossary/*`

### OWCP / FECA  *(top-level program entity — most underbuilt opportunity)*
- **Children:** FECA · **DFEC** (Div. Federal Employees' Compensation) · **DCMWC** (Coal — Black Lung)
  · Authorization · forms (CA-16, CA-17, OWCP-915, OWCP-04)
- **Administered by:** DOL → OWCP
- **Related:** Federal Worker · Postal Worker · EEOICPA (sibling DOL program) · state workers' comp
- **Pages:** `/owcp` (pillar) · `/owcp-federal-workers` · `/owcp/postal-workers`

### VA Community Care  *(top-level program entity)*
- **Children:** Community Care Network (CCN) · **TriWest** · **Region 4** · Authorization/Referral
  · PACT Act · Aid & Attendance (related VA benefit)
- **Administered by:** Dept. of Veterans Affairs (Alara = confirmed CCN provider, Region 4 / TriWest)
- **Related:** Veteran · VA Southern Nevada Healthcare System
- **Pages:** `/veterans-affairs` (pillar) · `/glossary/community-care-network`

### Medicare *(coordination entity — supports "can I have both")*
- **Related:** White Card (coordinates, doesn't cancel) · Home Health benefit
- **Pages:** intersection/comparison pages

---

## 2. BENEFICIARIES (audience entities)

| Entity | Parent | Qualifies via | Pages |
|---|---|---|---|
| **DOE Worker** | Nuclear Worker | EEOICPA | `/glossary/doe-worker`, condition×program |
| **Nuclear Worker** | Federal-adjacent | EEOICPA / RECA | glossary, pillar |
| **Atomic Weapons Employer (AWE) worker** | Nuclear Worker | EEOICPA | glossary |
| **Nevada Test Site worker** | DOE Worker | EEOICPA (SEC) | `/eeoicpa-for-nevada-test-site-workers` |
| **Federal Worker** | — | OWCP/FECA | `/owcp-federal-workers` |
| **Postal Worker (USPS)** | Federal Worker | OWCP/FECA | `/owcp/postal-workers` |
| **Veteran** | — | VA CCN | `/veterans-affairs` |
| **Survivor** | (of worker) | EEOICPA EE-2 | `/get-a-white-card`, FAQ |
| **Senior / family** | — | Medicare / private | services pages |

---

## 3. SERVICES (offering entities)

```
Home Health (parent)
├── Skilled Nursing ── Wound Care, Infusion/IV Therapy, Medication Mgmt, Post-Surgical, Disease Mgmt
├── Physical Therapy
├── Occupational Therapy
├── Medical Social Work ── Benefits Navigation
├── Home Health Aide
├── Targeted Case Management
├── Care Coordination
├── Paid Family Caregiver (EEOICPA)        ← differentiator
├── Hospice                                ← confirm offered
└── Hospital-at-Home                       ← confirm offered
```
- **Wound Care** + **Infusion Therapy** are promoted to **own pillar pages** (high-value, own search demand).
- Each service maps to schema `Service` / `MedicalProcedure` / `MedicalTherapy`.

---

## 4. CONDITIONS (clinical entities)

| Condition | Strongest program link | Schema |
|---|---|---|
| Chronic Beryllium Disease | EEOICPA | `MedicalCondition` |
| Chronic Radiation Illness / radiogenic cancers | EEOICPA | `MedicalCondition` |
| Silicosis / Asbestosis | EEOICPA | `MedicalCondition` |
| Cancer (various) | EEOICPA / VA | `MedicalCondition` |
| COPD | OWCP / VA / Medicare | `MedicalCondition` |
| Heart Failure (CHF) | OWCP / VA | `MedicalCondition` |
| Diabetes | all | `MedicalCondition` |
| Chronic Kidney Disease | all | `MedicalCondition` |
| Stroke recovery | VA / Medicare | `MedicalCondition` |
| Parkinson's | VA (Agent Orange) / Medicare | `MedicalCondition` |
| Chronic / non-healing wounds | all → Wound Care | `MedicalCondition` |

Each condition node connects to: the **service** that treats it + the **program** that covers it →
this is the engine for Condition × Program intersection pages (Phase 3/5).

---

## 5. GEOGRAPHY (local-authority entities)
Las Vegas · Henderson · North Las Vegas · **Clark County** · Southern Nevada ·
**Nevada Test Site / Nevada National Security Site (NNSS)** (also a beneficiary-origin entity) ·
DOL Las Vegas Resource Center · VA Southern Nevada Healthcare System.

---

## Relationship types (edges) used across the graph
- `administeredBy` (program → agency)
- `qualifiesFor` (beneficiary → program)
- `covers` (program → service)  ← the spine of intersection pages
- `treats` (service → condition)
- `causedBy` / `associatedWith` (condition → exposure/beneficiary)
- `coordinatesWith` (program ↔ program: White Card ↔ Medicare; EEOICPA ↔ VA)
- `locatedIn` / `serves` (org → geography)
- `definedBy` (entity → glossary page)

## Schema-graph mapping (how entities become JSON-LD `@id`s)
| Graph node type | schema.org type | `@id` pattern |
|---|---|---|
| Organization | `MedicalOrganization`+`LocalBusiness` | `/#organization` |
| Program | `DefinedTerm` (+ `GovernmentService`) | `/glossary/{program}#term` |
| Beneficiary class | `DefinedTerm` / `Audience` | `/glossary/{x}#term` |
| Service | `Service` / `MedicalProcedure` / `MedicalTherapy` | `/services/{x}#service` |
| Condition | `MedicalCondition` | `/conditions/{x}#condition` |
| Geography | `Place` / `City` / `AdministrativeArea` | `/locations/{x}#place` |

> **Why this matters for AEO:** when an AI engine answers "Does EEOICPA cover home wound care
> in Las Vegas?" it traverses *exactly* these edges (EEOICPA →covers→ Wound Care →treats→
> chronic wounds, served in →Clark County by →Alara). A site that encodes these relationships
> explicitly (in copy + JSON-LD) is the one the model can safely cite.
