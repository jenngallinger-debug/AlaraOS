# AlaraOS — Core Spine

This document describes the current architecture of AlaraOS. It derives from and must
conform to the [Alara Constitution](../CONSTITUTION.md). The Constitution defines enduring
commitments; this document describes one architecture for fulfilling them. Architectural
evolution is expected. Constitutional amendment is exceptional.

## Conformance to the Constitution
The supreme, frozen law is the **[Alara Constitution](../CONSTITUTION.md)** — five enduring
commitments: Human Primacy, Accountability, Authority & Consent, Human Sovereignty, and
Integrity. This document is one architecture for fulfilling them and must conform to them.
When constitutional commitments appear to be in tension, **Organizational Judgment** (below)
exists to reconcile them while preserving every commitment to the greatest extent possible.

Operative engineering gate — the **Decision Filter**, an architectural instrument that
operationalizes the commitments of the Alara Constitution. Its specific questions may evolve
as the architecture matures, but it must always faithfully express the constitutional
commitments it serves. Every feature, screen, automation, agent, report, integration, or
surface must answer all five:
1. Which life event does this improve?
2. Which promise does it fulfill?
3. Which uncertainty does it eliminate?
4. Which human burden does it remove?
5. How does it improve outcomes?

If it cannot answer all five, it does not belong in Alara.

## Reality Graph
Canonical truth substrate. Owns identity, canonical objects, relationships, events,
observations, promises, journeys, knowledge, and external references.

## Reality Understanding
Synthesis capability. Reads the Reality Graph and synthesizes Reality Models. Owns no
canonical truth.

## Reality Model
Synthesized, regenerable understanding of a subject's reality. Owns no canonical state.
Always regenerable from the Reality Graph.

## Reality Lenses
Reading facets of Reality Understanding. Benefit, risk, opportunity, eligibility,
journey, promise, financial, operational, clinical, growth, reputation, and future
readings over a Reality Model. **Lenses read; they do not decide.**

## Operating Cycle
Perceive → Understand → Judge → Orchestrate → Act → Communicate → Verify → Learn.

## Organizational Judgment Model
Many contributors produce readings. The organization produces one judgment.
Contributors are **Actors**. Their outputs are **readings**. Safety and continuity gate.
Humans decide consequential, low-confidence, irreversible, rights-bearing, clinical,
legal, ethical, and financial decisions.

## Experience Contract
The **why**. Defines the stakeholder need, the intended experience, the evidence of
fulfillment, and the failure signature.

## Four Capabilities
**Engage, Deliver, Sustain, Assure.** Defined in [`capabilities.md`](capabilities.md).

## Experience Surfaces
**PEL / OEL** are surfaces where stakeholders experience the Operating Cycle. They are
**not** architectural layers.
