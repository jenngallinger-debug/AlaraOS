# AlaraOS — Engineering Rules

- Do not invent architecture.
- Do not implement a concept not defined in this packet.
- If repo docs and code conflict, **stop and report**.
- If implementation pressure suggests an architectural change, **stop and produce an
  Amendment Packet**.
- If the issue can be resolved as engineering, **continue**.
- **Code is now the red team.**

## References
- Build order: [`README.md`](README.md).
- Core spine: [`core.md`](core.md).
- Capabilities: [`capabilities.md`](capabilities.md).
- Implementation pins: [`implementation-pins.md`](implementation-pins.md).

## Amendment Packet (when blocked)
1. Stop immediately.
2. Explain exactly where implementation became impossible.
3. Cite the specific architectural statement creating the contradiction.
4. Prove why the issue cannot be resolved through engineering.
5. Produce the smallest possible amendment.
