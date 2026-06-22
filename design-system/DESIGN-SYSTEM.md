# Alara Design System

Premium healthcare-authority design for Alara Home Care. Brand DNA preserved from
alarahomecare.com (warm cream · black · soft beige · muted brass · arches · quiet authority),
elevated toward an institutional luxury standard. **Live tokens:** `public/tokens.css` —
already applied to the running platform (`public/app.css`). Visual direction is rendered in
the homepage and component mockups delivered alongside this doc.

---

## 1 — Visual design direction

**One line:** *a luxury healthcare institution built for federal-benefit patients and complex
care at home.* Calm, exact, expensive, trustworthy. No hype, no exclamation points, no
stock-photo healthcare feeling, no SaaS-startup gloss.

**Reference standards → what we take from each**
| Reference | What Alara borrows |
|---|---|
| Uber | conversion discipline — one clear primary action per view, nothing aggressive |
| Ferrari | emotional presence through restraint; the brand is felt, not shouted |
| Porsche | strict hierarchy + quiet motion (220ms, no bounce); engineering precision |
| Apple | spacing as a feature; confident typography; say less |
| Mayo / Cleveland Clinic | clinical credibility, accessibility, sourced trust |

**The five rules that make it feel expensive**
1. **Restraint over decoration.** Hairlines (`1px #DCD2BF`), never drop-shadows. Flat warm surfaces.
2. **Editorial typography.** A serif display (Fraunces) for authority; a clean sans (Inter) for legible body. Big type, generous measure.
3. **Space is the luxury.** `--section-y` clamps 48–112px; long-form caps at ~760px.
4. **Brass is jewelry.** Gold/brass is an accent on keylines, eyebrows, and links — never a fill for large areas. **No blue, ever. No bright medical color.**
5. **The arch is the signature.** A repeated soft arch (top-rounded surfaces) carries the architectural DNA across hero art, cards, and section transitions.

**Never look like:** generic home-health agency, nursing-home site, Medicare brochure,
SaaS app, hospital template, or stock-photo healthcare.

---

## 2 — Design system tokens

Full set in [`public/tokens.css`](../public/tokens.css). Summary:

- **Color:** ink `#1A1714` · espresso `#2A2420` · muted `#6B6358` · gold `#A8842C` · brass
  `#C2A14E` · deep-brass `#8A6D24` · beige `#EAE0CE` · cream `#F6F1E7` · surface `#FCFAF4` ·
  hairline `#DCD2BF`.
- **Type:** display `Fraunces`, text `Inter`; scale 48 / 32 / 22 / 18 / 19 / 17 / 15 / 13 / 11px;
  line-height 1.7 body; weights 400/500 (600 display-only); eyebrow = 11px caps, `.2em` tracking.
- **Spacing:** 8pt scale (4→128); `--section-y` clamp(48,8vw,112); `--gutter` clamp(20,5vw,64);
  page max 1200, reading max 760.
- **Shape:** radius 2px (buttons/inputs — sharp = premium), 4px (cards), 140px (arch top corners).
- **Elevation:** none. **Motion:** ease `cubic-bezier(.22,.61,.36,1)`, 140/220/360ms; respects `prefers-reduced-motion`.

---

## 3 — Homepage layout  *(see rendered mockup)*

```
┌ HEADER  ALARA·HOME CARE   Programs Services Resources For-physicians About   (702)…  [Request care]
├ HERO (cream)  eyebrow: FEDERAL BENEFITS · SKILLED CARE AT HOME
│   H-display: "Skilled care at home, for the patients federal benefits were built to protect."
│   lead (nurse-owned, Southern NV, DON reviews every case)   [Find out if you qualify] [For physicians]
│   ▸ right: nested ARCH art (beige/surface/brass keyline), no stock photo
├ TRUST STRIP (ink)  Nurse-owned · DON reviews every case · EEOICPA · OWCP/FECA · VA CCN · 2-hr response
├ WHO WE SERVE  eyebrow + H2 "Three federal-benefit pathways"
│   [arched card] EEOICPA/White Card   [arched card] OWCP/Federal   [arched card] Veterans/VA CCN
├ WHAT WE DO (beige or ink band)  skilled nursing · wound care · infusion · therapy · aides · coordination
├ AUTHORITY  "Building the clearest federal-benefits resource in Southern Nevada" → Library/Glossary/FAQ
├ CONVERSION (quiet beige module)  "Not sure what you qualify for?" [Talk to a nurse]
└ FOOTER  NAP · hours · programs · resources · physicians · privacy
```
Communicates: nurse-owned · federal-benefit specialization · EEOICPA/White Card · OWCP ·
veterans · skilled care at home · authority resource. Schema: `MedicalOrganization`+`WebSite`.

---

## 4 — Program page layout  *(EEOICPA / OWCP / Veterans)*

```
PAGE-HEADER  eyebrow PROGRAM · H1 (program) · meta (who qualifies, one line) · [Find out if you qualify]
INTRO (prose, 1 short editorial para) + at-a-glance card (covered? cost? who? authorized by?)
SECTION "What's covered"   covered list as hairline rows / arched cards (services → links)
SECTION "Who qualifies"    plain steps; cites DOL/VA
SECTION "How it works"     numbered, calm (authorization path)
INLINE CONVERSION (quiet)  "Talk to a nurse about [program]"
RELATED  glossary terms · key questions · the other two programs
FAQ block (FAQPage schema)
CONVERSION module (ink)  patient + physician paths
```
Schema: `MedicalWebPage` + `Service` + `FAQPage` + `GovernmentService` ref.

---

## 5 — Long-form guide layout  *(editorial, not bloggy)*

```
PAGE-HEADER  eyebrow GUIDE · H1 · reviewedBy + lastReviewed line (E-E-A-T, visible)
2-COL on desktop:  [sticky table of contents]  |  [.prose measure 760px]
  prose: 19px body, serif H2s, brass blockquote, .callout boxes, source citations inline
  every ~2 sections: a quiet inline conversion or "related guide" rail
END  sources list · reviewer card · CONVERSION module · prev/next in cluster
```
Reading max 760px. Schema: `MedicalWebPage`/`Article` + `author`/`reviewedBy` + `citation`.

---

## 6 — Glossary page layout

```
GLOSSARY-TERM block (left brass rule)
  eyebrow GLOSSARY · DEFINED TERM
  glossary-term__definition (serif, 22px — the quotable answer, FIRST)
SECTION "In plain terms" (prose)
SECTION "Who it affects" (list)
SECTION "Related terms" (brass links → other glossary entries)
glossary-term__meta  Reviewed by [RN] · last reviewed · version · status · Sources (DOL/VA/CMS)
CONVERSION (quiet)  [Use the Benefit Navigator] [Talk to a nurse]
```
Definition-first for AI citation. Schema: `DefinedTerm`(+`DefinedTermSet`) + `MedicalWebPage` + `FAQPage`.

---

## 7 — FAQ page layout

```
PAGE-HEADER  eyebrow FAQ · H1 (topic) · lead
FAQ list (.faq)  each .faq__item:  __q (serif 18px, + brass plus-icon) / __a (answer, 60-word lead first)
  grouped by sub-topic with eyebrow dividers if long
CONVERSION module
```
Answer-first, one accepted answer each, source line. Schema: `FAQPage` (Question/Answer).

---

## 8 — Physician / referral page layout

```
PAGE-HEADER  eyebrow FOR PHYSICIANS · H1 "Your patients. Our paperwork." · [Refer a patient] [Fax order]
SECTION "What we do for your practice"  (assessment in 48h, documentation, CPT guidance, 60-day tracking)
SECTION "How to refer"  3 calm steps · fax/phone · 2-hour response promise (featured, not hyped)
REFERRAL FORM card  (patient + program lane: EEOICPA / OWCP / VA) — minimal fields, clinical tone
FAQ (physician-specific) · CONVERSION (referrer-targeted, ink)
```
Tone: peer-to-peer, exact. Schema: `MedicalWebPage` + `FAQPage`.

---

## 9 — Mobile navigation

- **Top bar:** wordmark left · tap-to-call brass icon + a single `☰` menu right. No floating buttons, ever.
- **Drawer (full-screen, cream):** Home · Programs (accordion → EEOICPA/OWCP/Veterans) · Services
  (accordion → 6 services) · Resources (Library/Glossary/FAQs/Community) · For Physicians · About · Contact.
- **Standing footer-bar (in flow, not fixed-floating):** `[Find out if you qualify]` primary +
  tap-to-call — appears at natural section ends, not as a sticky pill.
- Accordions, 48px tap targets, 17px+ type, brass active state. Drawer closes on selection.

---

## 10 — Conversion modules  *(calm, clinical, never salesy)*

| Module | Use | Look |
|---|---|---|
| **Quiet inline** (beige) | mid-page on programs/guides | "Not sure what you qualify for?" + [Talk to a nurse] |
| **Anchor** (ink) | end of every page | dual path: patient `Find out if you qualify` + physician `Refer a patient` |
| **Tap-to-call** | mobile, header + standing bar | brass-keyline button, real `tel:` |
| **Eligibility nudge** | glossary/FAQ/answer pages | "See if this applies to you" → Benefit Navigator |
| **Referral form** | physician pages | minimal, program-laned, 2-hr response promise |

Rules: one primary action per view; verbs are calm ("Talk to a nurse," not "Get help now!");
no urgency tactics, no exclamation points; reassurance copy ("no cost, about ten minutes").

---

## 11 — Component library

Implemented in `tokens.css` (selectors in parentheses):
- **Buttons** (`.btn--primary/secondary/tertiary/call/on-dark`) — ink / hairline-outline / brass-text / tap-to-call.
- **Cards** (`.card`, `.card__arch`, `.card__title`) — arched-top service card, hairline, one idea each.
- **Page header** (`.page-header`) — eyebrow + serif H1 + meta + primary CTA.
- **Content block** (`.prose`, `.callout`, brass `blockquote`) — editorial long-form.
- **FAQ** (`.faq`, `.faq__item`, `.faq__q`, `.faq__a`).
- **Glossary** (`.glossary-term`, `.glossary-term__definition`, `.glossary-term__meta`).
- **Conversion** (`.convert`, `.convert--quiet`) — ink + quiet-beige variants.
- **Trust strip** (`.trust-strip`).
- **Sections** (`.section`, `.section--dark`, `.section--beige`), **container**, **eyebrow**, **display**, **lead**, **measure**.

---

## 12 — Implementation plan

**Phase 1 — Foundation (done / in place)**
- ✅ `tokens.css` authored; ✅ applied to the running platform via `app.css`; ✅ verified live
  (cream bg, Fraunces/Inter loaded, no errors). Load Fraunces + Inter via `<link>` (self-host for prod perf).

**Phase 2 — Core templates (wk 1–3)**
- Build the page-type templates above as server-rendered partials (homepage, program, guide,
  glossary, FAQ, physician). Each consumes the content model; emits layered JSON-LD (see schema doc).
- Replace the homepage dashboard with the institutional hero + arch system from the mockup.

**Phase 3 — Component hardening (wk 3–5)**
- Accessibility pass: WCAG 2.2 AA contrast on cream/ink/brass pairs, 48px targets, focus-visible
  rings (brass), keyboard nav, reduced-motion (already tokenized). Senior-readability QA at 17px base.
- Mobile nav drawer + standing (non-floating) conversion bar.

**Phase 4 — Brand fidelity + polish (wk 5–6)**
- Drop in exact brand hex + the live site's actual typefaces if they differ from this refined
  interpretation (tokens are the single switch — change once, propagates everywhere).
- Arch-motif art system (SVG) for hero + section transitions; image treatment guidelines
  (warm duotone, never bright stock).
- Perf: self-hosted fonts, `font-display: swap`, critical CSS inline, AVIF imagery.

**Guardrail:** every new page composes existing tokens/components — no one-off styles, no
Squarespace-style layout drift. If a value isn't in `tokens.css`, it doesn't ship.
