# AlaraOS — Federal Benefits Intelligence Platform

A running MVP of the platform that helps everyone in the federal healthcare-benefits ecosystem
(EEOICPA / DOE / Nevada Test Site / federal & postal workers, veterans, families, physicians,
Resource Centers, representatives, case managers) understand and reach the home-health benefits
they may already have. **It helps these participants — it does not replace them.**

Full design across all 8 objectives: **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## What's live (verified)
- **Knowledge graph** — 57 entities, 24 relationships → `/graph`, `/api/graph`
- **Content OS** — data-driven glossary with layered JSON-LD → `/glossary`
- **Navigation layer + Benefit Navigator tool** — 28-node decision tree, 15 answer cards → `/navigator`
- **Trust infrastructure** — reviewer / version / status / citations on every entry → `/trust`
- **Data moat** — anonymous navigation analytics → `POST /api/event` → `data/analytics.log`
- **AI visibility** — server-rendered HTML + JSON-LD on every page; `knowsAbout` org node

## Run
```bash
# Production (canonical, zero dependencies)
cd alaraos && npm start          # → http://localhost:3000  (Node; deploys to Render)

# Dev-preview (no Node runtime needed — same data + assets)
python3 alaraos/preview_server.py   # → http://localhost:3000

# Pre-flight data integrity check (0 errors expected)
python3 alaraos/scripts/validate_data.py
```

## Layout
```
alaraos/
  server.js              production Node server (canonical)
  preview_server.py      Python dev-preview adapter (parity; for runtime-free verification)
  package.json
  lib/        content.js · schema.js · render.js
  data/       glossary.json · navigator.json · analytics.log (generated)
  public/     app.css · navigator.js
  scripts/    validate_data.py
  ARCHITECTURE.md
content/data/knowledge-graph.json   ← shared graph (platform source of truth)
```

> YMYL note: every benefits statement is framed as "generally covered when authorized," cites a
> primary authority (DOL/VA/CMS), and requires a named clinician reviewer before `status: published`.
> The reviewer fields currently read `TODO` — assign a credentialed RN/DON before going live.
