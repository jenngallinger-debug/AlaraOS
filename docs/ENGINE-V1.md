# AlaraOS Engine V1 — the LMN/renewal engine with human checkpoints
**July 2026.** Build #1 from `ALARAOS-WORKFLOW-INVENTORY.md`, implementing the
step-level assignments in `ALARAOS-HUMAN-BOUNDARY.md`. Running code, in this
repo, deployed with the website (one Render service).

## The idea in one sentence
Workflows run on the engine until they hit a step only a human may do — then
the engine creates a **prompt** (everything it prepared + the exact input it
needs back + a running SLA clock), a person answers it in the staff console,
and the engine takes the input and continues.

```
engine prepares  →  human acts  →  engine records and follows up
```

## What V1 contains

| Piece | File | What it does |
|---|---|---|
| Workflow core | `engine/core.js` | Case store (JSON on disk), append-only journal per case (the audit trail), the step runner, human prompts as first-class objects, input validation against the declared schema, SLA clocks with breach detection, the work queue |
| Workflows | `engine/workflows.js` | `intake`, `lmn`, `renewal` (below) + the pre-reader + the LMN drafter + `tick()` (time-based work) |
| Staff console | `engine/web.js` | `/os` work queue · `/os/case/ID` case view with the prompt form and journal · `POST /os/complete` |
| Wiring | `server.js` | `/os` routes mounted; **every `/api/submit` conversion becomes an engine case** |

## The three workflows

**`intake`** — a website conversion (case review / referral / call-back) arrives:
1. E: case created, journaled, **pre-read runs** — worksite/employer text matched
   against the covered-facility list (NTS/NNSS, Tonopah, CNTA, Yucca Mountain,
   REECo/EG&G/Bechtel/Wackenhut…), plus flags: survivor language, existing-card
   language, hours language, switching language.
2. **H (nurse, 1-hour clock): read + callback.** The prompt shows the raw
   submission, the pre-read, and takes: `disposition` (open-lmn-case /
   refer-resource-center / not-a-fit / need-more-info), patient, phone, notes.
3. E: routes on the disposition — `open-lmn-case` spawns the LMN case
   automatically, carrying everything forward.

**`lmn`** — the referral engine (C1/C2/C5–C7):
1. E: **drafts the LMN** (EE-17A/EE-17B-shaped) from case facts.
2. **H (nurse): review** — fills conditions, care type, hours/days, clinical
   basis, physician; `approve` or `rework` (rework re-drafts and re-prompts).
3. E: marks sent to the physician, starts the signature clock (5 business days).
4. **H (coordinator): record the signature** — or `declined` + reason, which
   loops the case back to nurse review **with the physician's objection in the
   brief**.
5. E: marks submitted for authorization, starts the tracking clock.
6. **H (coordinator): record the authorization** — auth #, start/end dates,
   hours/days. These numbers drive everything downstream.
7. E: activates the case and **schedules the renewal countdown at T-45 days
   before expiry**.

**`renewal`** — nobody remembers renewals; the engine does:
- `tick()` (runs on every console load; cron-able) finds active cases whose
  countdown has arrived and **spawns a renewal LMN case by itself**, prefilled
  with the prior authorization, hours, physician, and clinical basis. It lands
  at nurse review like any other case. Idempotent — never spawns twice.

## How humans are prompted (the checkpoint contract)
Every human step declares:
- **role** (nurse / coordinator) — who the prompt is for
- **title** carrying the boundary reason (JUD / TRU / LIC) — the console teaches the model
- **brief** — everything the engine assembled; a human never starts from a blank page
- **inputs** — the exact schema; the engine validates and rejects anything else
- **slaHours** — the clock; breaches surface at the top of the queue

## Running it
- Set `ENGINE_KEY` in the environment (Render → Environment). Without it, `/os`
  is a 404 and no engine cases are created — the engine is fully opt-in.
- Open `https://alarahc.com/os?key=<ENGINE_KEY>` — the key sets a cookie;
  after that `/os` works bare. Every page is `noindex, no-store`.
- Data lives in `data/engine/` (gitignored). **Render's disk is ephemeral** —
  fine for the pilot; a persistent disk or managed Postgres is the first V2
  infrastructure change before real patient volume.

## Verified (July 2026)
- 29-assertion lifecycle test: intake → nurse disposition → LMN spawn → rework
  loop → physician-decline loop → signature → authorization → activation →
  tick-spawned renewal (prefilled, idempotent) → queue and journal integrity.
- HTTP: `/os` 403 without key, 200 with; website submission → case in queue;
  cookie auth persists; full prompt round-trip through the real form.

## Honest V1 boundaries (what V2 adds)
1. **The LMN drafts from intake + nurse-entered facts**, not yet from visit
   data — the EMR/visit-record integration is the website's full promise and
   V2's core.
2. Storage is JSON-on-disk, single-process. Right for a pilot; needs a real
   database + persistent disk before volume.
3. No user accounts/roles yet — one shared key. Per-person logins (and with
   them, "who did what" beyond the journal's free-text `by`) come with V2.
4. Notifications are pull (the queue), not push — email/SMS nudges for new
   prompts and breached clocks are a small V2 addition (the SendGrid channel
   already exists).
5. B4 (benefit-maximization screen), D6 (proactive monitoring), and the rest
   of the inventory build on this same checkpoint pattern — new workflows are
   a `defineWorkflow()` call, not new architecture.
6. SEC/facility notes in the pre-reader are hints for the nurse, never
   determinations — verify class specifics before relying on them.
