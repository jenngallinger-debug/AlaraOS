# AlaraOS — Core Spine

Implementation-facing summary of the frozen core. The definitions below are
authoritative **as written**; do not extend, narrow, or reinterpret them.

## Constitution
The ratified **Build Constitution** and **Alara Decision Filter** are the supreme law
of the system: architecture serves the Constitution, implementation serves the
architecture. Every capability, cycle instance, and surface exists to honor it.

Operative engineering gate — the **Alara Decision Filter**. Every feature, screen,
automation, agent, report, integration, or surface must answer all five:
1. Which life event does this improve?
2. Which promise does it fulfill?
3. Which uncertainty does it eliminate?
4. Which human burden does it remove?
5. How does it improve outcomes?

If it cannot answer all five, it does not belong in Alara.

> Bridge note: the Constitution's canonical full text is **not yet in-repo**; it lives
> in the ratified document (Notion / chat) and in project memory. See the bridge-report
> gaps. It is referenced here, not reinterpreted.

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
