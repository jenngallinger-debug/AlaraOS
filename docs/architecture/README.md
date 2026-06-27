# AlaraOS — Architecture Reference (Bridge Packet)

> **Status: Architecture discovery is CLOSED.**
>
> These documents are *implementation-facing references* that summarize the frozen
> architecture already ratified (Notion / chat). **They are not new architecture.**
> No concept here may be invented, extended, split, merged, or reinterpreted during
> implementation.
>
> **Implementation must follow these docs.** If repo docs and code conflict, stop and
> report. **Any architecture change requires an Amendment Packet** — stop implementation,
> cite the contradicting architectural statement, prove the issue is not resolvable
> through engineering, and propose the smallest possible amendment.

## Documents in this packet
- [`core.md`](core.md) — the core spine: Constitution, Reality Graph, Reality
  Understanding, Reality Model, Reality Lenses, Operating Cycle, Organizational
  Judgment Model, Experience Contract, the Four Capabilities, Experience Surfaces.
- [`capabilities.md`](capabilities.md) — Engage · Deliver · Sustain · Assure.
- [`implementation-pins.md`](implementation-pins.md) — non-negotiable implementation constraints.
- [`engineering-rules.md`](engineering-rules.md) — how engineering proceeds against this architecture.

## Implementation order (build in this dependency order)
1. Permission Gate
2. Reality Graph
3. Reality Understanding
4. Reality Model
5. Judgment Engine
6. Operating Cycle Runtime
7. Experience Contract Engine
8. Engage / Deliver / Sustain / Assure
9. Experience Surfaces

Do not implement ahead of this order. Do not implement the prior `ops/` package
("the old ops architecture") as a substitute for any layer above; it predates this
architecture and is not authoritative for it.
