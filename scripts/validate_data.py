#!/usr/bin/env python3
"""AlaraOS data integrity check (runtime-agnostic).
Validates the data the server depends on so broken links/dead-ends are caught
before the app runs. The production CI validator (schema JSON-LD) runs under Node;
this is a fast pre-flight that works anywhere Python exists."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
PLATFORM = os.path.dirname(APP)

def load(p):
    with open(p) as f:
        return json.load(f)

glossary = load(os.path.join(APP, "data", "glossary.json"))
nav = load(os.path.join(APP, "data", "navigator.json"))
graph = load(os.path.join(APP, "content", "data", "knowledge-graph.json"))

errors, warnings = [], []
gslugs = {t["slug"] for t in glossary}
nav_nodes = {k: v for k, v in nav.items() if k != "_comment"}
node_ids = {n["id"] for n in graph["nodes"]}

# 1) Navigator: every option.next resolves; answers are well-formed
for nid, node in nav_nodes.items():
    if node.get("id") != nid:
        warnings.append(f"navigator: node '{nid}' has mismatched inner id '{node.get('id')}'")
    t = node.get("type")
    if t == "branch":
        if not node.get("options"):
            errors.append(f"navigator: branch '{nid}' has no options")
        for o in node.get("options", []):
            if o.get("next") not in nav_nodes:
                errors.append(f"navigator: '{nid}' option '{o.get('label')}' -> missing node '{o.get('next')}'")
    elif t == "answer":
        for req in ("title", "answer", "source"):
            if not node.get(req):
                errors.append(f"navigator: answer '{nid}' missing '{req}'")
        if node.get("term") and node["term"] not in gslugs:
            warnings.append(f"navigator: answer '{nid}' term '{node['term']}' not in glossary (link will 404)")
    else:
        errors.append(f"navigator: node '{nid}' has unknown type '{t}'")

# 2) Reachability from 'start'
seen, stack = set(), ["start"]
while stack:
    cur = stack.pop()
    if cur in seen or cur not in nav_nodes:
        continue
    seen.add(cur)
    for o in nav_nodes[cur].get("options", []):
        stack.append(o.get("next"))
unreached = set(nav_nodes) - seen
if unreached:
    warnings.append(f"navigator: {len(unreached)} node(s) unreachable from start: {sorted(unreached)}")

# 3) Glossary: related slugs (warn-only; some point to planned terms)
planned = set()
for t in glossary:
    for r in t.get("related", []):
        if r not in gslugs:
            planned.add(r)
    for req in ("shortDefinition", "plain", "sources", "reviewer", "lastReviewed", "version", "status"):
        if not t.get(req):
            errors.append(f"glossary: '{t['slug']}' missing '{req}'")

# 4) Knowledge graph: edges reference real nodes
for e in graph["edges"]:
    if e["from"] not in node_ids:
        errors.append(f"graph: edge from unknown node '{e['from']}'")
    if e["to"] not in node_ids:
        errors.append(f"graph: edge to unknown node '{e['to']}'")

print(f"glossary terms : {len(glossary)}")
print(f"navigator nodes: {len(nav_nodes)}  (answers: {sum(1 for n in nav_nodes.values() if n.get('type')=='answer')}, reachable: {len(seen)})")
print(f"graph nodes    : {len(node_ids)}   edges: {len(graph['edges'])}")
if planned:
    print(f"planned glossary terms referenced but not yet written ({len(planned)}): {sorted(planned)}")
print()
for w in warnings:
    print("WARN:", w)
for e in errors:
    print("ERROR:", e)
print()
print(f"RESULT: {len(errors)} error(s), {len(warnings)} warning(s)")
sys.exit(1 if errors else 0)
