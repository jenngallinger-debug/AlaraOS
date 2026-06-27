# AlaraOS — Identity Resolution — Implementation Spec

> **Status: SPEC ONLY. No code. No runtime change.** This document maps the frozen
> architecture to buildable engineering decisions for Identity Resolution
> (implementation pin #12: *"Identity Resolution requires its own implementation spec
> before production use."*). It is the input to a future, separately-approved build.
> Numeric thresholds and any new object type are **open decisions to be ratified
> before implementation** (an Amendment Packet if a new primitive is required).
>
> **Revision 2 (post-review).** Closes the four review blockers: (1) commits v1 to a
> **merge-aware read** propagation model — no physical re-pointing (§6.1); (2) scopes v1
> matching to **external-reference-first**, demographic matching deferred behind a safe
> candidate-query/index (§4.1); (3) replaces the `DataIntegrityFact` reuse with a **new
> identity-conflict fact + identity-review policy on a new, always-registered ruleset**
> (§5); (4) adds the merge-aware / concurrency / partial-failure **test cases** (§10) and
> a consolidated **open-decisions** section (§13).

---

## 1. Purpose

Identity Resolution is the process that, given a **person-bearing input** (a referral,
an Automynd observation, a portal submission, etc.), decides whether it refers to:

- **an existing Person** → return that Person's canonical identity, or
- **a new Person** → create a new canonical Person, or
- **an unresolved candidate** → emit a review-required record for a human to decide.

**Person identity is canonical and stable** — an Alara UUID that never changes once
assigned. **External identifiers are NOT identity.** Resolution decides *which* canonical
Person an input maps to; it never lets an external ID, demographic value, or source
system become the identity.

> **Naming note / key mapping (open decision).** The repo has no `Person` object type
> today; the canonical person-bearing type is **`Patient`** (`shared/types.ts`
> `OBJECT_TYPES`), with `Stakeholder`/`WorkforceMember` also person-bearing. **For the
> first implementation, "Person" maps to `Patient`.** Whether to introduce a unifying
> `Person` object type is an **open decision** — it adds a primitive and therefore
> requires an Amendment Packet; it is **out of scope** for this spec, which deliberately
> resolves over the existing `Patient` object + `external_references` + events.

---

## 2. Canonical principles

1. **Person is an Object** with independent identity across time (BD-013 Objecthood; an Alara UUID).
2. **Identifiers are references, not identity.** External IDs live in `external_references`, never as PK/FK or identity (existing External Reference Boundary).
3. **Automynd / VA / OWCP / payer IDs are External References** (`{ system, extType, value }`), resolved via the existing `ObjectGraphRepository.findByExternalReference`.
4. **Demographics are evidence, not identity.** Name/DOB/phone/etc. inform a match decision; they do not *become* the Person.
5. **Identity Resolution never hard-merges destructively.** A merge supersedes (archives) one record toward a surviving canonical Person; both records are retained.
6. **Merge is propagated by reading, not by rewriting.** v1 never physically re-points external references, relationship edges, or any other subject-keyed data; instead every subject-keyed read resolves `subjectId` through identity resolution first, so a read for a merged-away id returns the survivor's data (§6.1).
7. **Ambiguous or high-risk matches require human review** — surfaced as `REQUIRE_HUMAN` through the existing RulesEngine mechanism (§5), never auto-resolved.
8. **Merge/split actions are canonical Events** appended to the append-only event log (existing `EventStore`); they are the source of truth for the resolution decision.
9. **Every decision is auditable and reversible in record.** The event/audit log is append-only and immutable; a wrong merge is corrected by a *new* corrective `split` event, never by deleting history. (Reversible in *record*; real-world consequence reversal is a separate operational concern.)

---

## 3. Inputs

The resolution candidate input (`IdentityCandidateInput`, provisional):

| Field | Notes |
|---|---|
| `tenantId` | required; resolution is always tenant-scoped |
| `sourceSystem` | e.g. `Automynd`, `VA`, `OWCP`, `portal`, `manual` |
| `externalReferences` | `[{ system, extType, value }]` — 0..n; the strongest deterministic signal |
| `name` | structured where possible (given/family); free-form tolerated |
| `dob` | ISO date if present |
| `phone`, `email`, `address` | normalized before comparison |
| `ssnLast4` | only if already present in the input; never solicited here |
| `programIdentifiers` | e.g. White Card / claim numbers (themselves External References) |
| `relationshipContext` | referral source, care-team hints, family/guardian context |
| `referralMetadata` | provenance (who/what/when produced this input) |
| `existingCandidates` | optional pre-fetched candidate Persons (else the engine looks them up) |

**Any field may be absent.** Absence is handled explicitly (it lowers evidence; it must
not silently default to a match). Normalization (case, whitespace, phone/E.164,
date parsing, nickname expansion) is a defined pre-step and is itself evidence-affecting.

---

## 4. Matching model

**Evidence categories** (each contributes to, but none alone forces, a classification):

| Category | Source | Strength |
|---|---|---|
| Exact external-reference match | `findByExternalReference(tenant, system, extType, value)` | strongest deterministic signal |
| Strong demographic match | name + DOB (+ corroborating phone/email/address) | strong |
| Weak demographic match | partial/normalized demographics only | weak |
| Conflicting evidence | e.g. same external ID but mismatched DOB, or matching name with divergent DOB | **negative / review** |
| Relationship/context match | shared care-team / referral / program context | corroborating |
| Source-system confidence | per-source reliability of the supplied data | modifier |

**Output classification** (`IdentityResolutionOutcome`, provisional):

- `MATCH` — resolves to exactly one existing Person with sufficient, non-conflicting evidence.
- `NO_MATCH` — no candidate clears the bar → create a new Person.
- `POSSIBLE_MATCH_REVIEW_REQUIRED` — one or more plausible candidates with insufficient or conflicting evidence → human review (§5).
- `INSUFFICIENT_EVIDENCE` — too little input to decide safely → do not create or merge silently; hold as an unresolved candidate / request more data.

**Thresholds.** This spec does **not** hardcode numeric thresholds (the repo has no
existing scoring threshold to inherit). The classifier is defined structurally:
deterministic external-reference match dominates; demographic strength + conflict +
source confidence feed a classification function whose **cut points are configurable
engineering parameters to be ratified before implementation** (e.g. `config.identity.*`).
First implementation is **deterministic** (rules over evidence categories), not ML (§11).

### 4.1 v1 implementation scope — external-reference-first

The Object Graph currently exposes only `getById` + `findByExternalReference`; object
`attributes` is opaque JSONB with **no by-attribute / by-type query and no demographic
index**. There is therefore **no safe query path for demographic candidate lookup
today**. v1 scope is constrained accordingly:

- **Exact external-reference match is the v1 automatic `MATCH`** — resolved via the
  existing `findByExternalReference`.
- **Absence of an exact external reference never triggers a broad demographic
  auto-merge.** With no external-ref match, v1 takes `NO_MATCH` → create (or
  `INSUFFICIENT_EVIDENCE` when even the input is too thin to create safely).
- **Demographic fields are still collected as evidence** (and recorded per §7), and are
  used to *flag conflicts* on an external-ref match (e.g. ext-ref match + DOB mismatch →
  review), but they do **not** drive positive matching in v1.
- **Demographic matching may only produce *review candidates* (`POSSIBLE_MATCH_REVIEW_REQUIRED`),
  and only once an explicit deterministic, normalized candidate-query/index exists.**
  Until that query/index is built and ratified, demographic candidate *generation* is
  out of scope.
- **No production auto-merge on demographics in v1**, under any threshold.

If a later phase keeps demographic matching, it **must** first add a deterministic,
normalized candidate-query/index (an engineering decision in §13) — demographic matching
must never run over an unindexed `attributes` scan.

---

## 5. Human review gate

Human review is **mandatory** when any of the following holds — and is expressed as a
`REQUIRE_HUMAN` decision through the **existing RulesEngine `REQUIRE_HUMAN` mechanism**
(the same mechanism the Organizational Judgment Model uses for consequential/
irreversible/rights-bearing/PHI decisions):

- **Conflicting strong evidence** (e.g. exact external-ref match but DOB mismatch → `ID_COLLISION` / `DOB_MISMATCH`).
- **Multiple plausible candidates** for one input.
- **PHI-bearing merge risk** — any merge that would combine two records holding protected health information.
- **Low confidence** (below the ratified `MATCH` cut point but above `NO_MATCH`).
- **Cross-system identity conflict** (two source systems assert different identities).
- **Any merge that would combine protected records** — never automatic.

Auto-resolution is permitted **only** for `MATCH` (clean, non-conflicting, single
candidate) and `NO_MATCH` (clean create). Everything else routes to a human via the
review queue (§6/§9). This ties Identity Resolution to the frozen rule: *humans decide
consequential, low-confidence, irreversible, rights-bearing, clinical, legal, ethical,
and financial decisions.*

### 5.1 Do not reuse the data-integrity fact shape

The existing `DataIntegrityFact` models a **single object's external-vs-Alara field
divergence** (`{ conflictType, externalSystem, objectId, field, externalValue,
alaraValue }`). It **cannot represent a two-candidate identity conflict** (no candidate
set, no evidence, no PHI-risk indicator). Identity review therefore **reuses the
`REQUIRE_HUMAN` mechanism only** — *not* the `DataIntegrityFact` type, *not* the
`DataIntegrityFlagged` event, *not* `ruleset.data.integrity`. The build must add, as
engineering work (§13):

- **A new identity-conflict fact** (`IdentityConflictFact`, provisional) carrying:
  - `subjectInput` — the normalized candidate input under resolution;
  - `candidateSet` — the candidate Person ids considered;
  - `evidenceConsidered` — evidence per category (§4);
  - `conflictingEvidence` — the specific evidence in conflict;
  - `reasonCodes` — machine-readable why-review codes;
  - `proposedClassification` — the engine's pre-review outcome;
  - `confidence` — confidence in the proposed classification;
  - `phiRisk` — indicator that the action would combine/expose protected health information.
- **A new identity-review policy module** that maps an `IdentityConflictFact` to
  `ALLOW` / `REQUIRE_HUMAN` (and `DENY` where applicable) — identity authority lives in
  this policy, never in the engine or a handler.
- **A new identity-review ruleset** (`ruleset.identity.review`, provisional) that the
  policy registers against.

**The identity-review policy must be registered for its ruleset at startup.** The
RulesEngine **default-ALLOWs when no policy is registered for a ruleSet**, so an
unregistered identity-review ruleset would fail *open* — the policy must always be
present for the gate to fail closed (the same failure-closed discipline as the consent
authority policy).

---

## 6. Canonical operations

All operations are canonical (object + append-only events; existing
`ObjectCommandHandler` + `EventStore`). Proposed new event types (to be added to
`EVENT_TYPES` at build time — an implementation step, not new architecture):

| Operation | Effect | Event(s) |
|---|---|---|
| **Create Person** | new `Patient` with a fresh Alara UUID | `ObjectCreated` (existing) |
| **Link External Reference** | attach `{system, extType, value}` to a Person | `ExternalReferenceAdded` (existing) |
| **Mark candidate as possible match** | record an unresolved review item | `IdentityReviewRequested` (new) |
| **Record human decision** | a reviewer's accept/reject/merge/split choice | `IdentityDecisionRecorded` (new) |
| **Merge Person records** | designate a **surviving** Person; mark the other `archived` (retained, not deleted); record the merge link. **No data is physically moved** (§6.1) | `PersonMerged { survivingId, mergedId, evidence, actor }` (new) + `ObjectStateTransitioned` (existing, to `archived`) |
| **Split / unlink** | corrective separation of a wrong merge | `PersonSplit { fromId, restoredId, reason, actor }` (new) |

**Destructive merge/delete is forbidden.** The event log and audit log are append-only
(enforced by existing invariants); a merge never erases the merged record's history,
and a split never deletes — it appends a corrective event. The surviving Person is the
single canonical identity going forward; the archived record remains resolvable for audit.

### 6.1 Merge propagation model (v1 decision: merge-aware reads)

**v1 propagates a merge by reading, not by rewriting.** When two `Patient` records merge,
the only state change is: the merged-away `Patient` transitions to `archived`, and a
`PersonMerged { survivingId, mergedId, … }` event records the link. Concretely, v1:

- performs **no destructive merge/delete**;
- performs **no physical transfer of external references** (the `external_references`
  table supports only add/upsert/read — there is **no removal or transfer mechanism and
  no `ExternalReferenceRemoved` event** — so refs stay on the archived record);
- performs **no cross-store subject rewrites** (relationships, consent, projections,
  knowledge, workforce, organizational-brain, and any other subject-keyed store are left
  untouched);
- keeps the **merged-away `Patient` retained/archived**, never deleted;
- keeps the **survivor `Patient` canonical** going forward.

Instead, **all subject-keyed reads must resolve `subjectId` through identity resolution
before querying**, following any `PersonMerged` link to the survivor:

- a read issued for a **merged-away id resolves to the survivor**;
- this keeps **consent, participation, relationships, projections, knowledge, and
  permission** data from *silently disappearing* after a merge — they are reached through
  the survivor's canonical id rather than re-homed;
- it equally prevents the inverse catastrophe: because nothing is rewritten, a wrong
  merge is undone by a `PersonSplit` with **no data to un-rewrite**.

**Why merge-aware reads (not physical re-pointing) in v1:**

1. **No removal/transfer primitive exists** — external references can only be added/read;
   physically moving them would require new, unbuilt machinery and would mutate history.
2. **`subjectId` spans many stores** — re-pointing would mean fan-out writes into every
   subject-keyed store, multiplying write surfaces and risking partial/torn merges.
3. **Append-only + PHI safety** — reading-through is consistent with the append-only
   invariant (no history rewrite) and is the safe direction for PHI: a merged-away id
   yields the survivor's authorized data, never a stale or cross-contaminated slice.

**Build implication (not built here):** a single **merge-aware subject resolver**
(`resolveCanonicalSubject(tenantId, subjectId) → survivorId`) must sit in front of
subject-keyed reads (including the Permission Gate's data sources, `ConsentRepository`,
participation/relationship reads, and projections). The Permission Gate's *logic* is
unchanged; only the resolution of the subject id upstream of it is added. This resolver
interface is an engineering decision in §13.

---

## 7. State and audit

Every resolution **must record** (as canonical events on a resolution stream, plus a
review record where applicable):

- the **source input** (normalized) and its provenance;
- the **candidate set** considered;
- the **evidence** evaluated (per category, with the External References and demographic comparisons used);
- the **classification** (`MATCH` / `NO_MATCH` / `POSSIBLE_MATCH_REVIEW_REQUIRED` / `INSUFFICIENT_EVIDENCE`);
- **confidence and machine-readable reason codes** (why this outcome);
- the **actor or system** that made the decision;
- the **human reviewer** (if a review occurred) and their decision;
- the resulting **canonical Event(s)** (create / link / merge / split / review-requested / decision-recorded).

**The Reality Graph (object graph + event log) remains the source of truth.** Any
projection/queue is derived and rebuildable; the canonical decision lives in the events.

---

## 8. Failure modes (mitigation *class*, not technique)

| Failure | Required mitigation class |
|---|---|
| Duplicate Person created | Pre-create resolution lookup via `findByExternalReference` (v1 external-ref-first, §4.1) before any `Create Person`; duplicate-prevention check is mandatory in intake (§12 phase 7). Concurrent intake of the same external reference must not create two Patients (§10). |
| Two real people merged | Merge gated by `REQUIRE_HUMAN` on any conflict/PHI risk; merges are non-destructive + reversible by `PersonSplit`. |
| External ID reused by source system | Treat exact external-ref match with conflicting demographics as `ID_COLLISION` → review, never silent match. |
| Missing DOB/name | `INSUFFICIENT_EVIDENCE`; do not create/merge silently; hold or request more data. |
| Typo / nickname | Normalization + weak-match handling → at most `POSSIBLE_MATCH_REVIEW_REQUIRED`, not auto-merge. |
| Address change | Address is corroborating, not decisive; a changed address alone never forces non-match or merge. |
| Guardian/family confused as subject | Relationship/context evidence + review; consent/participation already distinguish subject vs representative — identity must not collapse them. |
| Stale external reference | Provenance + source-system confidence; conflicting stale ref → review. |
| Malicious / fraudulent input | No auto-merge on conflict; review gate + audit trail; fail closed on ambiguity. |

---

## 9. Interfaces (provisional names — greenfield)

- **`IdentityResolutionEngine`** — `resolve(input): IdentityResolutionResult` (classification + chosen/created Person + emitted events). Deterministic; delegates the human-review decision to the RulesEngine (does not decide consequential merges itself).
- **`IdentityResolutionRepository`** — candidate lookup by external reference and by normalized demographics; reads the object graph (does not own identity logic).
- **`IdentityReviewQueue`** (or equivalent review *record*) — durable, canonical record of `POSSIBLE_MATCH_REVIEW_REQUIRED` items awaiting a human decision; reuses the event/object pattern.
- **`CanonicalSubjectResolver`** (provisional) — `resolveCanonicalSubject(tenantId, subjectId) → survivorId`; the **merge-aware subject resolver** (§6.1) that subject-keyed reads call before querying so a merged-away id resolves to the survivor. Reads `PersonMerged` links; owns no matching logic.
- **Dependencies (existing):** `ObjectGraphRepository` (`findByExternalReference`, `getById`, `create`, `addExternalReference`), `ObjectCommandHandler`, `EventStore`, `RulesEngine` (+ the **new** identity-review policy module/ruleset from §5.1 — *not* the data-integrity policy).
- **External-reference lookup:** `findByExternalReference(tenant, system, extType, value)` (existing) is the deterministic match primitive — **the v1 match path** (§4.1).
- **Optional `IdentityMatcher`/`Scorer`** — pluggable evidence scorer; first implementation is deterministic/rule-based (no ML). Demographic candidate generation requires a new candidate-query/index first (§4.1, §13).

---

## 10. Testing requirements (before implementation is accepted)

1. Exact external-reference match → `MATCH` to the existing Person.
2. No external reference, in v1 → `NO_MATCH`/`INSUFFICIENT_EVIDENCE` (no demographic auto-match, §4.1). *Later phase only,* with the candidate-query/index enabled: strong demographic match → `POSSIBLE_MATCH_REVIEW_REQUIRED` (review candidate), never an automatic `MATCH`.
3. Conflicting demographics (e.g. ext-ref match + DOB mismatch) → `POSSIBLE_MATCH_REVIEW_REQUIRED` (`ID_COLLISION`/`DOB_MISMATCH`).
4. Multiple plausible candidates → review required.
5. Missing data → `INSUFFICIENT_EVIDENCE` (no create/merge).
6. External-reference collision (same ext-ref, different person evidence) → review, no silent match.
7. Duplicate prevention → resolving the same person twice does not create two Persons.
8. Merge creates a canonical `PersonMerged` audit event; merged record is `archived`, not deleted.
9. Split creates a corrective `PersonSplit` event; history intact.
10. Human-review-required cases route to the review queue and do not auto-resolve.
11. Malicious/fraudulent input does **not** auto-merge.
12. **Deterministic output for the same input** (same evidence → same classification).

**Merge-aware read / concurrency / failure tests (added in Revision 2):**

13. **Merge-aware read** — after a merge, a read issued for the **merged-away id resolves to the survivor** (`CanonicalSubjectResolver`, §6.1).
14. **Consent read for a merged-away id uses the survivor** — consent recorded under the merged-away id remains reachable via the survivor; none silently disappears.
15. **Participation / relationship read for a merged-away id uses the survivor.**
16. **Candidate already merged-away resolves to the survivor** — resolving to a candidate that is itself archived/merged returns the survivor, never the archived record or `NO_MATCH`.
17. **Concurrent intake of the same external reference does not create a duplicate `Patient`** (relies on the version-gated write path).
18. **Deterministic candidate ordering** — candidate-set order is fixed, so test 12 holds even when multiple candidates exist.
19. **Partial merge failure leaves no unreadable or cross-contaminated state** — a merge interrupted mid-way (its events being atomic) never yields a half-archived/half-canonical Patient; reads stay consistent.
20. **`INSUFFICIENT_EVIDENCE` intake behavior is explicit and tested** — the defined intake outcome for `INSUFFICIENT_EVIDENCE` (per the §13 engineering decision) is exercised, not left implicit.

---

## 11. Non-goals

- **No biometric identity.**
- **No irreversible destructive merge** (merges are non-destructive + corrective-split-reversible).
- **No external ID as canonical identity.**
- **No automatic merge across high-risk PHI conflict** (always human-gated).
- **No production ML matcher required for the first implementation** (deterministic, rules-based).

---

## 12. Build sequence recommendation

1. **Repository / candidate lookup (external-ref-first)** — `IdentityResolutionRepository` over `findByExternalReference` (read-only). Demographic candidate lookup is **deferred** until a deterministic normalized candidate-query/index exists (§4.1).
2. **Deterministic matcher** — exact external-ref → `MATCH`; ext-ref + conflicting demographics → review; no ext-ref → `NO_MATCH`/`INSUFFICIENT_EVIDENCE`. Thresholds as ratified config; no demographic auto-merge.
3. **Review-required classification** — emit `POSSIBLE_MATCH_REVIEW_REQUIRED` / `INSUFFICIENT_EVIDENCE`; add the **new** `IdentityConflictFact` + identity-review policy on the **always-registered** `ruleset.identity.review` (§5.1); wire `REQUIRE_HUMAN`.
4. **External-reference linking** — `Link External Reference` on `MATCH`.
5. **Merge/split event model + merge-aware reads** — add `PersonMerged`/`PersonSplit`/`IdentityDecisionRecorded`/`IdentityReviewRequested` event types; non-destructive merge (archive merged-away, no physical re-pointing); introduce the `CanonicalSubjectResolver` and route subject-keyed reads through it (§6.1).
6. **Human review queue** — durable canonical review record + decision recording.
7. **Integration into intake/referral flow** — `IntakeOrchestrator` calls Identity Resolution **before** creating a `Patient` (today `intake-orchestrator/index.ts` always creates one); resolve-or-create + duplicate prevention + defined `INSUFFICIENT_EVIDENCE` behavior.

Each phase ships with the relevant tests from §10 and passes `npm run verify`.

---

## 13. Open decisions (grouped)

Separated by kind; none of these blocks the v1 *architecture*, but the engineering and
configuration items must be settled as part of their build phase.

### 13.1 Architecture decisions still open
- Whether to introduce a generalized **`Person` object type** later (vs resolving over `Patient`) — a new primitive, requires an **Amendment Packet** (pin #9).
- Whether the **review queue** is a canonical **Object** (new object type) or a **rebuildable projection** over the resolution event stream.

### 13.2 Engineering decisions before implementation
- Final **event type names** (`PersonMerged` / `PersonSplit` / `IdentityReviewRequested` / `IdentityDecisionRecorded`) added to `EVENT_TYPES`.
- The **`IdentityConflictFact` shape** (§5.1).
- The **identity-review policy module** and **`ruleset.identity.review`** (always-registered, fail-closed).
- The **`CanonicalSubjectResolver` interface** (merge-aware subject resolution, §6.1) and the read sites it fronts.
- The **external-reference candidate lookup** implementation (v1 path).
- The **demographic query/index** — *only if* demographic matching is included in a later phase (deterministic + normalized; never an unindexed scan).
- The defined **`INSUFFICIENT_EVIDENCE` intake behavior** (what intake does when identity can't be resolved or safely created).

### 13.3 Configuration decisions
- Match **thresholds** / cut points (`config.identity.*`).
- **Source-system confidence weights**.
- **Normalization rules** (case/whitespace, phone E.164, date parsing, nickname tables).
