# 01 — Live-Site Inventory, Audit & Migration Plan

> Source of truth: crawl of `alarahomecare.com` sitemap + page fetches, June 2026.
> Everything below is grounded in the **actual** live site, not assumptions.

---

## A. Current-state inventory (what actually exists)

**Platform:** Squarespace. **Canonical host:** `www.alarahomecare.com`.
**Business reality (important):** This is a **Las Vegas / Clark County, Nevada** nurse-led
home health agency — not a national brand. Geography is central to its SEO and schema.

**Positioning (verbatim from homepage):** "Specialized Skilled Home Health for Complex
Patients on Federal Programs." Differentiators: nurse-led, locally owned, Director of
Nursing reviews all cases, "zero tolerance for authorization gaps," "care over charting,"
AI-assisted documentation, 2-hour referral response guarantee.

**Contact / NAP:** (702) 814-9630 · info@alarahomecare.com · referrals@alarahomecare.com ·
fax (725) 210-8285 · Mon–Fri 8a–5p PT, 24/7 clinical escalation · Clark County + Southern NV.

### Page inventory (17 URLs in sitemap)

| # | URL | Purpose | Est. depth | Verdict |
|---|-----|---------|-----------|---------|
| 1 | `/home` | Homepage | rich | **Migrate as-is** (preserve arch design, palette, type) |
| 2 | `/about` | Brand/trust | — | Migrate + add E-E-A-T (bios, licensure, credentials) |
| 3 | `/contact` | Contact + form | — | Migrate; wire to new lead pipeline |
| 4 | `/white-card-home-health-las-vegas` | **EEOICPA money page** | ~2,200–2,400w, 7 FAQs | **Flagship — migrate, expand into a hub** |
| 5 | `/veterans-affairs` | VA CCN | ~1,250w | Migrate + refresh (stale "fall 2024" enrollment copy) |
| 6 | `/community-resources` | Local resource links | — | Migrate; expand into a linkable asset (moat) |
| 7 | `/physicians` | Referrer pathway | — | Migrate + build dedicated referral UX |
| 8 | `/switching` | Switch-provider guide | — | Migrate; fold under EEOICPA/OWCP clusters |
| 9 | `/how-to-choose` | Decision guide | — | Migrate; convert to AEO comparison content |
| 10 | `/family-caregivers` | Caregiver guide | — | Migrate; expand into resource cluster |
| 11 | `/get-a-white-card` | Eligibility/apply | — | Migrate; expand into step-by-step structured guide |
| 12 | `/owcp-federal-workers` | **OWCP/FECA page** | ~800w, **0 FAQs** | **Migrate + heavily expand** (thinnest priority page) |
| 13 | `/family-caregivers-1` | Duplicate | thin | **Consolidate / 301 → #10** |
| 14 | `/get-a-white-card-1` | Duplicate | thin | **Consolidate / 301 → #11** |
| 15 | `/how-to-choose-1` | Duplicate | thin | **Consolidate / 301 → #9** |
| 16 | `/physicians-1` | Duplicate | thin | **Consolidate / 301 → #7** |
| 17 | `/services` | Services overview | rich | Migrate; split into per-service pages |

### Content already harvested (reuse, don't recreate)

**Services (real):** Skilled nursing (incl. **wound care, IV/infusion therapy**, med
management, post-surgical, disease mgmt for COPD/CHF/diabetes/cancer/CKD/stroke/chronic
pain), Physical Therapy, Occupational Therapy, Medical Social Work (benefits navigation),
Home Health Aide. **Targeted Case Management** appears on the homepage.

**Existing EEOICPA FAQs (already written — migrate + mark up with FAQ schema):**
1. Does the White Card cover home health care?
2. Do I pay anything for White Card home health services?
3. What is a consequential condition under EEOICPA?
4. Can I use the White Card and Medicare at the same time?
5. Does the White Card cover caregiver training?
6. Does EEOICPA cover home safety modifications?
7. Can I get reimbursed for travel to doctor appointments?

These 7 are gold — they're real question-shaped content. They become the seed of the
EEOICPA **question cluster** (see `03-aeo-and-schema.md`).

---

## B. Audit findings (ranked by leverage)

### 🔴 Critical — fix first
1. **robots.txt blocks AI crawlers.** Current file disallows `ClaudeBot`, `GPTBot`,
   `Amazonbot`. The site's stated #1 goal is AI citation authority; it is currently
   opted out. **Fix shipped:** `public/robots.txt`. (On Squarespace, this requires a
   platform-level change or the planned migration — see note below.)
2. **Duplicate `-1` pages** (`/physicians-1`, `/get-a-white-card-1`, `/how-to-choose-1`,
   `/family-caregivers-1`). Duplicate/thin content dilutes ranking signals. 301 to canonicals.
3. **YMYL compliance exposure.** Federal-benefits + healthcare claims ("zero cost,"
   coverage assertions) are "Your Money or Your Life" content. Every benefits claim needs
   a cited authority (DOL/DEEOIC, OWCP, VA) and a clinical/legal reviewer. This constrains
   the programmatic engine (see `04`).

### 🟠 High
4. **OWCP page is thin (~800w, 0 FAQs)** vs. the EEOICPA page (~2,400w, 7 FAQs). OWCP/FECA
   is a top-tier target keyword set with no competitor owning it. Underbuilt.
5. **VA page is stale** ("currently enrolling… fall 2024"). Update enrollment status; if
   live, convert waitlist CTAs to active intake.
6. **No per-service pages.** `/services` is one combined page. Wound care, infusion, skilled
   nursing, PT, OT each deserve their own indexable, schema-rich page.
7. **Missing whole verticals from the brief:** Hospice, Hospital-at-Home, Infusion (as its
   own page), Care Coordination hub, Complex Chronic Conditions hub — not present yet.
8. **Inconsistent internal link targets** (e.g. `/physicians` vs `/for-physicians` seen in
   page links). Audit and normalize during migration.

### 🟡 Medium
9. Geo/local signals can be strengthened: LocalBusiness/MedicalOrganization schema, GBP
   alignment, Clark County/neighborhood landing pages.
10. No glossary / entity-definition layer yet (key for AEO — see `03`).

---

## C. Migration plan (preserve value, lose nothing)

**Guiding rule:** *Preserve every URL's equity.* Nothing 404s; everything either migrates
1:1 or 301-redirects to a stronger canonical.

**Phase 0 — Safety net (before any rebuild)**
- Full export/backup of Squarespace content + images.
- Freeze a snapshot of current metadata, titles, and the sitemap (done — see this doc).
- Stand up analytics + Search Console baseline (rankings, impressions, top queries) so
  migration impact is measurable.

**Phase 1 — URL & redirect map**
- Keep these slugs (strong equity): `/white-card-home-health-las-vegas`, `/veterans-affairs`,
  `/owcp-federal-workers`, `/services`, `/physicians`, `/about`, `/contact`.
- 301s: `*-1` duplicates → canonicals; normalize `/for-physicians` → `/physicians`.
- New canonical taxonomy (see `02`) is **additive** — old URLs redirect into it, they
  don't disappear.

**Phase 2 — Content migration & enrichment**
- Migrate verbatim where strong (EEOICPA hub, services copy, FAQs).
- Expand the thin pages (OWCP, per-service splits).
- Re-mark-up everything with schema (FAQ, MedicalWebPage, Service) — see `03`.

**Phase 3 — Brand parity QA**
- Pixel-parity pass: arch design elements, palette, type hierarchy, calm/clinical feel.
- Side-by-side visual diff old vs new before cutover.

**Phase 4 — Cutover**
- DNS / hosting switch (or hybrid — see `05`), submit new sitemap, monitor Search Console
  for crawl errors and ranking deltas for 30/60/90 days.

**Squarespace caveat:** Squarespace gives limited control over `robots.txt`, server-side
schema, and redirect logic. This is the core argument for the Node/Render rebuild in `05`.
Until cutover, apply what Squarespace allows (page-level SEO fields, code injection for
JSON-LD, 301s via URL mappings) as interim wins.
