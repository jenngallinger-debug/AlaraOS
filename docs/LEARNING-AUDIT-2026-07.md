# Alara Learning Experience Audit
**Auditor lens:** Julie Dirksen (learning design), not marketing.
**Standard:** every learning section must leave the reader more capable than when they arrived — path recognition, progressive understanding, reduced cognitive load, decision readiness, obvious next action.
**Date:** 2026-07 · **Surfaces audited:** learn.html, qualify.html (Navigator), white-card.html, white-card-denied.html, survivor-benefits.html, owcp.html, reca.html, veterans.html

---

## Verdict in one paragraph

The writing is genuinely good — plain, specific, sourced, and almost entirely free of healthcare-marketing sludge (zero banned phrases across every page; one near-miss construction, flagged below). Where this learning experience fails is **not voice — it is architecture.** Three structural problems suppress reader capability: (1) **no path-triage** at the top of the learning experience, so a first-time visitor who doesn't already know whether they're an EEOICPA / OWCP / VA / RECA person has to self-sort by reading four separate pages; (2) a **sequence break on the flagship White Card page**, which teaches optimization (missed benefits, consequential conditions, form OWCP-957) *before* it teaches what the White Card actually is; and (3) **acronym overload** — the site introduces ~20 acronyms (EEOICPA, DEEOIC, DOL, NIOSH, SEC, OWCP, FECA, DFEC, WCMBP, Acentra, EN-28, OWCP-957, CA-1/CA-2, EE-1/2/3, CCN, TriWest…), several used before they're defined. Fix those three and the CTA misalignment (below) and the site genuinely replaces the first phone call.

---

## Grades (0–10)

| Surface | Recogn. | Progressive | Cog. load | Decision | Depth | Voice | Next-step |
|---|---|---|---|---|---|---|---|
| Learn hub | 6 | 6 | 5 | 5 | 8 | 9 | 5 |
| Benefit Navigator | 9 | 9 | 8 | 8 | 7 | 9 | 6 |
| White Card (flagship) | 6 | 4 | 4 | 6 | 9 | 8 | 6 |
| White Card Denied (guide) | 9 | 9 | 6 | 8 | 8 | 8 | 6 |
| Survivor Benefits (guide) | 9 | 9 | 7 | 8 | 8 | 8 | 6 |
| OWCP | 8 | 8 | 6 | 8 | 8 | 9 | 6 |
| RECA | 8 | 8 | 7 | 7 | 7 | 9 | 6 |
| Veterans | 6 | 5 | 6 | 4 | 4 | 8 | 5 |

---

## Cross-cutting findings (fix these once, help every page)

**X1 — No "which path is mine?" triage anywhere except the Navigator, and the Navigator is a separate destination.**
The Learn hub opens as a *library* ("Federal Benefits Library… the terms that matter"). That is the wrong first job. A visitor's first question is not "define EEOICPA" — it is *"am I even in the right place, and which of these programs is me?"* The learning experience answers that only if the visitor happens to click through to the Navigator. **Add a static path-router at the top of Learn** (and ideally a compact version on the home and programs pages): five plain rows — *Worked at the Test Site / a DOE site / a weapons plant → White Card. Injured as a federal or postal worker → OWCP. Veteran → VA Community Care. Got sick from radiation / uranium → RECA. Not sure → Navigator.* This is the single highest-leverage capability fix on the site.

**X2 — Acronym load is the top cognitive-load defect, and expansions are inconsistent.**
Worst offender is white-card.html, which uses **DEEOIC, OWCP-957, EN-28, Acentra, WCMBP, Part B/Part E, EE-1/EE-2** — several with no first-use expansion. "Special Exposure Cohort (SEC)" is used in the Denied guide with only a partial inline gloss. The reader is asked to hold a dozen proper nouns before they have a mental model to hang them on. **Fixes:** (a) expand every acronym on first use, every page; (b) add a persistent "cast of characters" mini-table (Claims Examiner / Nurse Case Manager / Authorized Representative / Resource Center / DEEOIC / Acentra — who they are, what they decide) reused across White Card, OWCP, Denied, Survivor; (c) never introduce a form number (OWCP-957, EE-2, EN-28, CA-1) without one clause saying what it does.

**X3 — The flagship White Card page has a progressive-understanding break and serves two learners at once.**
Current order: hero ($400k) → quick check → **#missed "benefits most people never claim"** → #covers → #worth → **#picture "what the White Card actually is"** → #consequential → #file "don't have one yet". The ground-floor definition (#picture, "here it is in three facts") sits at position 6, *after* advanced optimization content. And the page is built mostly for people who **already hold a card**, with the "don't have one yet" path buried near the end — even though a large share of arrivals are pre-card. You cannot teach the advanced move before the concept. **Fix:** move #picture ("what the White Card actually is") and a one-line eligibility statement to immediately after the hero; split the two audiences explicitly ("Already have a card → maximize it" vs "Think you might qualify → start a case review") near the top; keep the excellent missed-benefits and consequential-conditions material, but *after* the base model is set.

**X4 — CTAs still default to "call us," which contradicts the new strategy.**
Nearly every learning page closes on a phone call: Learn hub "Have a nurse call you"; Navigator's one-next-step "Have a nurse call you → begin.html"; RECA "Talk to a nurse"; Veterans "One call and we take it from there / Have a nurse call you"; White Card wc-contact "have a nurse call you"; both guides "have a nurse walk you through it / Or call." The site now has a **case-review tool** and a **referral flow** — those, not a call, should be the primary next action aligned to the reader's learning state. A reader who just learned they likely qualify for the White Card should land on **"Start a case review,"** not a phone number. Phone stays as the quiet fallback. This is the biggest *action-clarity* fix and it's already half-built.

**X5 — One near-banned reassurance construction appears 3×.**
"You do not have to do this alone" / "You do not have to figure this out alone" (white-card #file, Denied §4, Survivor §4). This is the vague-reassurance move the voice rules forbid. The fix is free: the sentence already carries the concrete half — *"and you never pay anyone a percentage."* Cut the reassurance clause, keep the fact.

**X6 — Missing the single most useful teaching asset: a program-comparison table.**
Nowhere can a reader compare White Card vs OWCP vs VA vs RECA vs Medicare side by side. That comparison is exactly the decision they arrive to make, and right now it requires reading four pages. Build it once (below) and embed on Learn + programs.

---

## Per-page audit

### 1. LEARN HUB — learn.html

**A. Current job:** A "Federal Benefits Library" — a guides grid over a program-grouped glossary of 12 terms, each with short definition + plain-language + who-it-affects + source.
**B. Correct job:** First, **route** the visitor to their program in one screen. Then teach the terms of *that* program. Recognition before vocabulary.
**C. Grades:** Recognition 6 · Progressive 6 · Cog. load 5 · Decision 5 · Depth 8 · Voice 9 · Next-step 5.
**D. Diagnosis:** The content is strong but mis-sequenced for a stranger. "Most families never claim the full scope of what they have earned" is a good hook, but the very next thing is a glossary. The reader has not yet been told which family of benefits is theirs, so they can't know which terms to read. The glossary grouping (EEOICPA / OWCP / VA / Clinical) is good and doing quiet triage work — but it's below the guides grid and unlabeled as a router. Next step is a phone call, not a self-serve action.
**E. Keep / Cut / Move / Add**
- **Keep:** the grouped glossary (strong), the guide cards, the "reviewed by a nurse + source" pattern.
- **Cut:** CTA "Have a nurse call you" as the primary close.
- **Move:** the program groups' *lead lines* up into a top-of-page router.
- **Add:** a 5-row "Which of these is you?" triage block at the very top; a program-comparison table; a case-review / Navigator primary CTA.
**F. Recommended sequence:** (1) Hook → (2) "Which of these is you?" router (5 rows, each links to that program's page) → (3) comparison table → (4) guides grid → (5) glossary grouped by program → (6) primary CTA: *See what applies (Navigator)* / *Start a case review*, phone as fallback.
**G. Rewrite (top of page, new router):**
> **Start here: which of these is you?**
> - *You (or a family member) worked at the Nevada Test Site, a DOE site, or an atomic-weapons plant, in any job.* → **The White Card (EEOICPA)**
> - *You were injured or made ill working for the federal government or the Postal Service.* → **OWCP / FECA**
> - *You're a veteran who needs care at home.* → **VA Community Care**
> - *Radiation or uranium work made you sick.* → **RECA**
> - *Not sure?* → **Take the 1-minute Navigator.**
**H. Missing assets:** path-router; program-comparison table; acronym key.

---

### 2. BENEFIT NAVIGATOR — qualify.html

**A. Current job:** A tap-based reasoner: situation → program → care type → visible reasoning → a "picture" of what generally applies, what confirms it, what's easy to miss, and one next step.
**B. Correct job:** Same — and this is the best-designed learning object on the site. Its only real gap is the closing action.
**C. Grades:** Recognition 9 · Progressive 9 · Cog. load 8 · Decision 8 · Depth 7 · Voice 9 · Next-step 6.
**D. Diagnosis:** Excellent instructional design: "Which of these sounds most like you?" is exactly the right first question; the visible-reasoning chips lower load and build trust; "what confirms it / what would tell us" is real decision-readiness teaching. Two weaknesses: (1) the **one next step ends in "Have a nurse call you,"** even when the strongest result is EEOICPA — where the aligned action is now a **case review**; (2) depth on "what would tell us" is thin for the *possible* tier — the reader learns a path exists but not precisely what evidence flips it to confirmed.
**E. Keep / Cut / Move / Add**
- **Keep:** everything about the flow, the chips, the tiered "generally covered / worth asking about."
- **Cut:** default "Have a nurse call you" as the single next step for EEOICPA-strong results.
- **Add:** result-specific self-serve CTA — EEOICPA → *Start a case review*; OWCP → *what to ask your physician/OWCP*; VA → *what to ask your VA team*; plus phone fallback.
**F. Sequence:** unchanged; only swap the terminal CTA to match the strongest program.
**G. Rewrite (one-next-step, EEOICPA-strong):**
> **Your one next step.** You worked where the White Card was written for. Start a case review: a nurse reads your worksite, your work, and your illness together and tells you plainly whether the card can be opened — then points you to the free help to file and provides the care it covers. *[Start a case review →]* · *Prefer to talk it through? Call (702) 814-9630.*
**H. Missing assets:** an inline "what evidence confirms each path" mini-list for the *possible* tier.

---

### 3. WHITE CARD — white-card.html (flagship; biggest opportunity)

**A. Current job:** A comprehensive holder-oriented guide: hero value → quick check → missed benefits → what it covers → what it's worth → what it actually is → consequential conditions → how to get one → Medicare → scope → FAQ.
**B. Correct job:** Teach, in order: *what the White Card is → am I / is my family member eligible → what it covers and is worth → (for holders) the benefits you're missing → how to start (case review) or how to file.* One base model, then optimization.
**C. Grades:** Recognition 6 · Progressive 4 · Cog. load 4 · Decision 6 · Depth 9 · Voice 8 · Next-step 6.
**D. Diagnosis:** The *material* is the best on the site — specific, dollar-anchored, genuinely useful ("home health is not only for after a hospital stay," the OWCP-957 self-serve instruction, consequential conditions). But the **learning order is inverted** and the **acronym load is unmanaged.** A pre-card visitor meets "form OWCP-957," "DEEOIC," "EN-28," "Acentra," "Part B / Part E," and "$400,000" before they are ever told, plainly, *what the White Card is and whether they qualify.* The definitional #picture section — "here it is in three facts" — is buried at position 6. The page's aside admits it's "for people who already have a White Card," yet it's the top organic landing page for the term, so most readers won't have one. Two learners, one undifferentiated scroll.
**E. Keep / Cut / Move / Add**
- **Keep:** #missed (superb self-serve teaching), #worth cards, #consequential, #covers, the honest #scope boundary, the FAQ.
- **Cut:** "You do not have to do this alone" (§#file) → keep only "you never pay anyone a percentage." Trim first-use acronyms or expand them.
- **Move:** #picture ("what the White Card actually is") + a one-sentence eligibility test to **immediately after the hero**; move #file ("don't have one yet") up into an explicit audience fork near the top.
- **Add:** an audience selector under the hero ("Already have a card" vs "Think you or a family member might qualify"); expand DEEOIC/EN-28/OWCP-957/Acentra on first use; link the illustrative estimate (nevada-test-site) from #worth more prominently.
**F. Recommended sequence:** (1) Hero → (2) **What the White Card actually is** (3 facts) + **one-line eligibility test** → (3) audience fork: *Have a card → maximize it* / *Might qualify → start a case review* → (4) What it covers at home → (5) What it can be worth → (6) The benefits most people never claim (holders) → (7) Consequential conditions → (8) Don't have one yet / how to start → (9) Medicare → (10) Scope → (11) FAQ.
**G. Rewrite (new #2, placed right after hero):**
> **What the White Card actually is — in three facts.**
> 1. **EEOICPA** (the Energy Employees Occupational Illness Compensation Program Act) is the federal law that pays people who got sick from work at the Nevada Test Site, a DOE site, or an atomic-weapons plant. It provides two separate things: **cash compensation** and **medical care for life.**
> 2. **The White Card** is proof you've been approved for the medical side. It works like an insurance card — but no copays, no deductibles, no limits on covered care. The Department of Labor pays the provider directly; you never see a bill.
> 3. **You may qualify if** you (or a family member) worked at one of those sites *in any job* — trades, security, cleaning, office, cafeteria, not only the scientists — and later became ill. Whether the illness is covered is the one thing to check next.
**H. Missing assets:** eligibility "one-line test" box; audience fork; acronym key; a stacked worked-example of how $150k / up-to-$250k / $2,500-per-1% / survivor amounts combine (currently only the nevada-test-site estimate does this — surface it here).

---

### 4. WHITE CARD DENIED — white-card-denied.html (guide)

**A/B. Job:** Teach a denied claimant that denial is not final, why it happens, the concrete routes to reopen, and where to get free help. It does this well.
**C. Grades:** Recognition 9 · Progressive 9 · Cog. load 6 · Decision 8 · Depth 8 · Voice 8 · Next-step 6.
**D. Diagnosis:** Textbook progressive sequence (why denied → why it may succeed now → what you can do → where to get help → where Alara fits). Two fixes: **"Special Exposure Cohort"** is used repeatedly with only a partial gloss — define it crisply on first use ("a group of workers the government has ruled qualify more easily based on where and when they worked — no need to prove each illness individually"). And **"You do not have to figure this out alone"** → cut, keep "you never pay a percentage." Close offers Navigator + call; add case review.
**E. Keep:** the whole sequence and the 60-day/reconsideration/reopen specifics. **Cut:** the reassurance clause. **Add:** SEC definition at first use; case-review CTA.
**F. Sequence:** unchanged — it's right.
**G. Rewrite (first use of SEC, §2):** "…approved new **Special Exposure Cohorts** — groups of workers the government has ruled qualify more easily because of *where and when* they worked, without having to prove the illness came from the job case by case."
**H. Missing assets:** a small "which route fits which denial" table (recommended vs final decision → objection window vs reconsideration vs reopen).

---

### 5. SURVIVOR BENEFITS — survivor-benefits.html (guide)

**A/B. Job:** Teach a survivor they may be owed compensation even if the worker never filed, who qualifies, what it pays, how to file. Does it well.
**C. Grades:** Recognition 9 · Progressive 9 · Cog. load 7 · Decision 8 · Depth 8 · Voice 8 · Next-step 6.
**D. Diagnosis:** Strong. Priority-order list (spouse → children → parents/grandchildren/grandparents) is exactly the clarity a grieving family needs. Fixes: **"You do not have to do this alone"** → cut, keep the percentage fact. The **EE-2 / EE-3** forms are named without a one-clause "what it is" (EE-2 = the survivor claim; EE-3 = the employment record) — add it. Close: Navigator + call; add case review where a living family member may also need care.
**E. Keep:** priority list, the $150k / up-to-$125k cards, "the worker does not need to have filed." **Cut:** reassurance clause. **Add:** one-clause form glosses; case-review link.
**F. Sequence:** unchanged.
**H. Missing assets:** a tiny "who can file, in what order" diagram (already near-tabular in prose — make it a real list/table).

---

### 6. OWCP — owcp.html

**A/B. Job:** Teach an accepted-claim federal/postal worker that home health is covered, how authorization actually works, who's who, and what Alara takes off their hands. Strong.
**C. Grades:** Recognition 8 · Progressive 8 · Cog. load 6 · Decision 8 · Depth 8 · Voice 9 · Next-step 6.
**D. Diagnosis:** Very good. The "Who is who in your claim" definition rows (Claims Examiner / Nurse Case Manager / Treating physician / Where Alara fits) are a model — this pattern should be **reused on White Card**, which lacks it. "Where it breaks" and "What Alara owns" dark panels teach the failure mode concretely. Fixes: **FECA / DFEC / CA-1 / CA-2** — expand on first use (CA-1 = traumatic injury claim; CA-2 = occupational disease claim). Next-step defaults to call; route to referral (for providers) and start-of-care (for accepted claims).
**E. Keep:** who's-who rows, the two dark panels, the "not established yet is a different path" honesty. **Add:** first-use expansions; self-serve CTA.
**H. Missing assets:** the shared "cast of characters" table (portable from here).

---

### 7. RECA — reca.html

**A/B. Job:** Teach that RECA reopened, the 2027 deadline is hard, who the three covered groups are, and — critically — that RECA pays cash but **not** care, which is where the White Card and Alara come in. Tight and effective.
**C. Grades:** Recognition 8 · Progressive 8 · Cog. load 7 · Decision 7 · Depth 7 · Voice 9 · Next-step 6.
**D. Diagnosis:** The best-structured program page: deadline urgency up front, three clean group cards, and the "RECA is the money, the White Card is the care" turn is the exact teaching move that connects a stranger's situation to Alara honestly. Gaps: "covered cancer / covered area / covered illness" are used without telling the reader **how to check** what's covered for *them* (only a justice.gov link) — add one line on where the covered-conditions/ZIP lists live. Close is "Talk to a nurse" — for uranium workers, the aligned action is the White Card case review.
**E. Keep:** the deadline framing, three-group cards, the cash-vs-care turn. **Add:** "how to check if your cancer/area is covered" line; case-review CTA for the uranium-worker → White Card bridge.
**H. Missing assets:** a one-line "is my illness/area covered? check here" pointer; the RECA→White Card bridge as a tiny 3-step flow.

---

### 8. VETERANS — veterans.html (weakest learning surface)

**A. Current job:** Half a thin veteran-facing "what the VA covers" list, half a provider-facing "how to refer to Alara" block.
**B. Correct job:** Teach a *veteran* whether VA Community Care can bring skilled care home, **who qualifies and how eligibility is decided** (distance/wait standards), what to ask their VA team, and — honestly — whether Alara can serve them *yet.*
**C. Grades:** Recognition 6 · Progressive 5 · Cog. load 6 · Decision 4 · Depth 4 · Voice 8 · Next-step 5.
**D. Diagnosis:** This page under-teaches the veteran and over-serves the referrer. The veteran learns *what* is covered but not *whether they're eligible*, how Community Care authorization is triggered, or what to ask. **Honesty gap:** "Alara is enrolling as a VA Community Care Network provider" — *enrolling* means **not yet enrolled**; a veteran reading this can't actually start care with Alara today, and the page never says so plainly. That's a decision-readiness failure: the reader can't tell what they can actually do now. Next step defaults to "call."
**E. Keep:** the provider referral steps (move to their own clearly-labeled block), the covered-care list. **Cut:** "One call and we take it from there" as the close. **Add:** a veteran-facing eligibility explainer (VA enrollment + the drive-time/wait-time Community Care standards, in plain terms), "what to ask your VA care team," and a plain status line on Alara's enrollment ("We're completing VA Community Care enrollment for Region 4. If you're a veteran who needs care now, here's what to do in the meantime.").
**F. Sequence:** (1) Can the VA bring care home? → (2) Do you qualify for Community Care? (plain-language standards) → (3) What to ask your VA team → (4) Where Alara is today (enrollment status, honest) → (5) For providers: how to refer.
**H. Missing assets:** eligibility explainer; "what to ask your VA team" checklist; honest enrollment-status line.

---

## Missing teaching assets (consolidated, priority order)

1. **Program-comparison table** (highest value) — embed on Learn + programs. Columns: *Who it's for · What triggers it · What it pays (cash) · What it covers at home · Who files the claim · Your cost · Deadline.* Rows: White Card (EEOICPA) · OWCP/FECA · VA Community Care · RECA · Medicare.
2. **"Which of these is you?" path-router** — top of Learn (and compact on home/programs).
3. **Acronym key + first-use expansions** — sitewide; especially White Card.
4. **"Cast of characters" table** — Claims Examiner / Nurse Case Manager / Authorized Representative / Resource Center / DEEOIC / Acentra: who they are, what they decide, what Alara does with them. Portable from OWCP; add to White Card.
5. **White Card eligibility "one-line test" + audience fork** (have a card vs might qualify).
6. **Stacked compensation worked-example** on White Card (how the four figures combine), surfacing the existing nevada-test-site estimate.
7. **Denial-route table** (recommended vs final decision → which action).
8. **Veterans eligibility explainer + "what to ask your VA team" checklist.**

---

## Prioritized fix list (tied to "the website replaces the call")

**P0 — capability + strategy, do first**
- Add the **path-router** to Learn (X1). Reader can self-identify in one screen.
- Reorder **White Card**: definition + eligibility right after hero; audience fork (X3).
- Swap **CTAs from "call us" to case review / referral / start-of-care** on Navigator result, White Card, Learn, RECA, guides (X4). Phone becomes fallback.
- Build the **program-comparison table** (asset #1).

**P1 — cognitive load + honesty**
- Expand acronyms on first use; add acronym key + cast-of-characters table (X2).
- Define **Special Exposure Cohort** and the **EE-/CA-/OWCP-957/EN-28** forms at first use.
- Cut the 3× **"you do not have to do this alone"** reassurance; keep the percentage fact (X5).
- Fix **Veterans**: eligibility teaching + honest enrollment status.

**P2 — depth polish**
- Navigator: per-path "what confirms it" for the *possible* tier.
- White Card: stacked comp worked-example; link the illustrative estimate from #worth.
- Denial-route table; survivor "who files, in order" as a real list.

---

*Note: this is an audit artifact, not brand canon. It recommends changes to existing pages; it does not create new benefit facts. All benefit figures referenced here trace to the existing pages and data/programs.json.*
