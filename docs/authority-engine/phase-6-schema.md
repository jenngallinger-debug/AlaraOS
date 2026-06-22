# Phase 6 — Schema Architecture

> Strategy: one **global organization graph** (the `#organization` node) referenced by every
> page; **page-level types** describe each page and link back via `@id`. Server-rendered,
> templated from the content model, validated in CI. This is the machine-readable spine that
> lets AI engines resolve "who is the authoritative provider for X in Las Vegas" to Alara.

## Layering rules
1. Every page includes the global `#organization` node (or references it by `@id`).
2. Page-type schema (below) is added per template (Phase 5).
3. `BreadcrumbList` on every page.
4. YMYL pages add `reviewedBy` (named clinician) + `lastReviewed` + `citation`.
5. One `@graph` array per page; nodes connected by `@id` — never duplicate the org block, reference it.

---

## 1. Global — MedicalOrganization + LocalBusiness (site-wide, every page)
```json
{
  "@context": "https://schema.org",
  "@type": ["MedicalOrganization", "HomeHealthCare", "LocalBusiness"],
  "@id": "https://www.alarahomecare.com/#organization",
  "name": "Alara Home Care",
  "url": "https://www.alarahomecare.com/",
  "telephone": "+1-702-814-9630",
  "email": "info@alarahomecare.com",
  "faxNumber": "+1-725-210-8285",
  "address": { "@type": "PostalAddress", "addressLocality": "Las Vegas", "addressRegion": "NV", "addressCountry": "US" },
  "areaServed": ["Las Vegas NV", "Henderson NV", "North Las Vegas NV", "Clark County NV", "Southern Nevada"],
  "medicalSpecialty": ["Wound Care", "Infusion Therapy", "Skilled Nursing", "Physical Therapy", "Occupational Therapy"],
  "availableService": [
    { "@type": "MedicalProcedure", "name": "Skilled Nursing" },
    { "@type": "MedicalTherapy", "name": "Home Wound Care" },
    { "@type": "MedicalTherapy", "name": "Home Infusion Therapy" }
  ],
  "openingHoursSpecification": { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"], "opens": "08:00", "closes": "17:00" },
  "sameAs": ["GBP_URL", "FACEBOOK_URL", "LINKEDIN_URL"],
  "knowsAbout": ["EEOICPA", "White Card benefits", "OWCP", "FECA", "VA Community Care Network", "home health"]
}
```
> `knowsAbout` explicitly declares topical authority — a direct AEO signal.

## 2. WebSite (homepage)
```json
{ "@type": "WebSite", "@id": "https://www.alarahomecare.com/#website",
  "url": "https://www.alarahomecare.com/", "name": "Alara Home Care",
  "publisher": { "@id": "https://www.alarahomecare.com/#organization" },
  "potentialAction": { "@type": "SearchAction", "target": "https://www.alarahomecare.com/?q={query}", "query-input": "required name=query" } }
```

## 3. FAQPage (flagship, benefit, service, question pages)
```json
{ "@type": "FAQPage",
  "mainEntity": [
    { "@type": "Question", "name": "Does the White Card cover home health care?",
      "acceptedAnswer": { "@type": "Answer",
        "text": "Yes. The EEOICPA White Card covers physician-ordered home health — skilled nursing, wound care, therapy, and home health aide services — at no out-of-pocket cost for approved beneficiaries." } }
  ] }
```
> **Quick win:** the flagship page already has 7 written FAQs with zero markup. Adding this
> alone is one of the fastest AI/SEO gains available.

## 4. DefinedTerm + DefinedTermSet (glossary — the citation workhorse)
```json
{ "@type": "DefinedTerm",
  "@id": "https://www.alarahomecare.com/glossary/white-card/#term",
  "name": "White Card",
  "description": "A White Card is the EEOICPA medical benefits card that lets approved Department of Energy and Nevada Test Site workers receive covered care — including home health — at no out-of-pocket cost.",
  "inDefinedTermSet": { "@type": "DefinedTermSet", "@id": "https://www.alarahomecare.com/glossary/#set", "name": "Alara Federal Benefits & Home Health Glossary" } }
```
Full layered example (DefinedTerm + FAQPage + Breadcrumb + Org): `content/_examples/glossary-white-card.jsonld`.

## 5. Service / MedicalProcedure / MedicalTherapy (service pages)
```json
{ "@type": "MedicalTherapy", "@id": "https://www.alarahomecare.com/services/wound-care/#service",
  "name": "Home Wound Care",
  "description": "Nurse-led skilled wound care delivered at home across Clark County, including assessment, dressing changes, infection monitoring, and advanced wound therapy.",
  "provider": { "@id": "https://www.alarahomecare.com/#organization" },
  "relevantSpecialty": "Wound Care",
  "areaServed": "Clark County NV" }
```

## 6. MedicalCondition (condition pages)
```json
{ "@type": "MedicalCondition", "@id": "https://www.alarahomecare.com/conditions/chronic-beryllium-disease/#condition",
  "name": "Chronic Beryllium Disease",
  "associatedAnatomy": { "@type": "AnatomicalStructure", "name": "Lungs" },
  "possibleTreatment": [ { "@id": "https://www.alarahomecare.com/services/skilled-nursing/#service" } ],
  "epidemiology": "Associated with beryllium exposure among Department of Energy / nuclear-weapons workers." }
```

## 7. Article / MedicalWebPage (guides, benefit pages — carries E-E-A-T)
```json
{ "@type": "MedicalWebPage", "@id": "https://www.alarahomecare.com/eeoicpa-home-health/#webpage",
  "name": "Does EEOICPA Cover Home Health Care?",
  "lastReviewed": "2026-06-22",
  "reviewedBy": { "@type": "Person", "name": "TODO Reviewer Name, RN", "jobTitle": "Director of Nursing", "worksFor": { "@id": "https://www.alarahomecare.com/#organization" } },
  "author": { "@type": "Person", "name": "TODO Author" },
  "citation": "https://www.dol.gov/agencies/owcp/energy",
  "about": { "@type": "MedicalAudience", "audienceType": "EEOICPA beneficiaries" } }
```
> `reviewedBy` with a **named, credentialed** person is the single biggest YMYL E-E-A-T upgrade.
> (Current site names no clinicians — fix on `/about` first.)

## 8. BreadcrumbList (every page)
```json
{ "@type": "BreadcrumbList", "itemListElement": [
  { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.alarahomecare.com/" },
  { "@type": "ListItem", "position": 2, "name": "EEOICPA", "item": "https://www.alarahomecare.com/eeoicpa/" },
  { "@type": "ListItem", "position": 3, "name": "Home Health", "item": "https://www.alarahomecare.com/eeoicpa-home-health/" } ] }
```

## 9. GovernmentService (program glossary pages — ties Alara's content to the official program)
```json
{ "@type": "GovernmentService", "name": "EEOICPA",
  "serviceOperator": { "@type": "GovernmentOrganization", "name": "U.S. Department of Labor, DEEOIC" },
  "serviceType": "Occupational illness compensation and medical benefits" }
```

## Schema → page-type matrix
| Page type | Schema stack |
|---|---|
| Homepage | MedicalOrganization + LocalBusiness + WebSite |
| Glossary | DefinedTerm + DefinedTermSet + MedicalWebPage + (FAQPage) + Breadcrumb |
| Question | FAQPage / QAPage + Breadcrumb + org ref |
| Benefit | MedicalWebPage + Service + FAQPage + GovernmentService ref + Breadcrumb |
| Service | Service/MedicalProcedure/MedicalTherapy + FAQPage + Breadcrumb |
| Condition | MedicalCondition + FAQPage + Breadcrumb |
| Comparison | MedicalWebPage + FAQPage + DefinedTerm refs + Breadcrumb |
| Location | LocalBusiness + MedicalWebPage + FAQPage + Breadcrumb |
| Guide/Article | MedicalWebPage/Article + author/reviewedBy + Breadcrumb |

## CI validation
`scripts/validate-schema.js` runs every page's `@graph` through schema validation + Google
Rich Results expectations on each build; invalid markup **fails the build**. No page ships
with broken or unreviewed (`reviewedBy: TODO`) schema in production.
