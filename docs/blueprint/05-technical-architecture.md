# 05 — Technical Architecture

> Constraints from the brief: prefer Render + Node + Express, static generation where
> appropriate, fast loads, schema-rich, structured content models, avoid unnecessary
> complexity. Hard requirement: preserve the existing visual brand (arch elements, palette,
> type) and lose no SEO equity.

## Recommended stack (matches the brief, no over-engineering)

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Node 20 + Express** | brief preference; simple, well-understood |
| Rendering | **Static-first (SSG) + SSR fallback** | content is mostly stable → pre-render to HTML for speed + perfect crawlability; SSR only for dynamic bits |
| Templating | **Eta/EJS or Nunjucks** server-side | deterministic HTML + JSON-LD from the content model; no client framework needed for content pages |
| Content model | **Flat JSON/MDX in repo, OR DB + admin** | start file-based (`/content`), graduate intersections to a DB/Airtable-backed editorial workflow as volume grows |
| Build | Node build script → static `/dist` | renders every content row to HTML + JSON-LD, builds segmented sitemaps |
| Hosting | **Render** (static site + optional web service) | brief preference; CDN, easy deploys, cheap |
| Forms/leads | Express endpoint → CRM/email + spam protection | replaces Squarespace form; feeds the lead pipeline (`06`) |
| Search (later) | client-side index (e.g. Pagefind) | no heavy infra for site search |

**Why not a heavy CMS/Next.js/headless-commerce stack?** The content is structured and
mostly static. SSG from a typed content model gives the fastest pages, the cleanest
server-rendered schema, and the lowest operating complexity — which is exactly what AEO and
Core Web Vitals reward. Add complexity only when a real need appears (e.g. logged-in
referral portal).

## Why move off Squarespace at all?
Squarespace can't deliver the three things the strategy depends on:
1. **Full `robots.txt` / crawler control** (the AI-bot unblock).
2. **Server-rendered, templated JSON-LD at scale** (programmatic schema).
3. **A content model + generation pipeline** (the programmatic engine).
It's good at none of these and great at none of the brief's goals. So: rebuild on Node/Render.

## Migration risk controls (this is the scary part — de-risk it)
- **Preserve URLs / 301 map** from `02` — zero orphaned equity.
- **Visual parity first:** rebuild the homepage (arch elements, palette, type) to pixel
  parity and get founder sign-off *before* cutover. Extract exact colors, fonts, and the
  arch SVG/asset from the current site during migration.
- **Hybrid option (lower risk):** run the new Node app on a subdomain or path, migrate
  section-by-section, then flip DNS once parity + redirects are verified. Recommended if
  the team wants to de-risk a big-bang cutover.
- **Search Console diffing** for 90 days post-cutover.

## Repository shape (this project)
```
alara-platform/
  public/            static assets, robots.txt (shipped), favicons, brand assets
  content/           structured content model (the source of truth)
    programs.json    services.json  conditions.json
    intersections/   one row per approved programmatic page
    questions/  glossary/  pages/   (mdx/json)
    _examples/       (already scaffolded)
  templates/         server-side templates (page types → HTML + JSON-LD)
  lib/               renderers: schema.js (JSON-LD), sitemap.js, links.js (internal links)
  scripts/           build.js (SSG), validate-schema.js (CI), redirects.js
  server.js          Express app (SSR fallback, /request-care + /refer endpoints)
  dist/              build output (deployed to Render)
  docs/              this blueprint
```

## Performance & Core Web Vitals (table stakes for SEO + AEO)
- Pre-rendered HTML, critical CSS inlined, fonts `font-display: swap` + preloaded.
- Responsive images (AVIF/WebP, width-sized), lazy-load below the fold.
- No render-blocking JS on content pages; ship near-zero client JS.
- Target: LCP < 2.0s, CLS < 0.05, INP < 200ms on 4G mobile.

## Schema & quality in CI
- `scripts/validate-schema.js` runs every page's JSON-LD through schema validation on each
  build; build fails on invalid markup.
- Linkcheck (no broken internal links), redirect-map test, sitemap completeness check.

## Accessibility & trust
- WCAG 2.2 AA (this audience skews older / disabled veterans + ill workers — non-optional).
- Visible NAP, licensure, privacy. HTTPS, HSTS. Form spam protection (honeypot + rate limit).
