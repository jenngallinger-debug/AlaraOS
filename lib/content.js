'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..');               // alaraos/
const PLATFORM = path.join(APP, '..');                // alara-platform/

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error('[content] could not read', p, '-', e.message); return fallback; }
}

// Knowledge graph is shared at the platform level (single source of truth, Phase 2).
const graph = readJSON(path.join(APP, 'content', 'data', 'knowledge-graph.json'), { nodes: [], edges: [] });
const glossary = readJSON(path.join(APP, 'data', 'glossary.json'), []);
const navigator = readJSON(path.join(APP, 'data', 'navigator.json'), {});

const glossaryBySlug = Object.create(null);
for (const t of glossary) glossaryBySlug[t.slug] = t;

const nodeById = Object.create(null);
for (const n of graph.nodes) nodeById[n.id] = n;

// Graph helpers -------------------------------------------------------------
function edgesFrom(id) { return graph.edges.filter(e => e.from === id); }
function edgesTo(id) { return graph.edges.filter(e => e.to === id); }
function relatedNodeIds(id) {
  const ids = new Set();
  for (const e of graph.edges) {
    if (e.from === id) ids.add(e.to);
    if (e.to === id) ids.add(e.from);
  }
  return [...ids];
}

function getTerm(slug) { return glossaryBySlug[slug]; }
function navNode(id) { return navigator[id]; }

// Simple counts for the home/dashboard view
function stats() {
  return {
    entities: graph.nodes.length,
    relationships: graph.edges.length,
    glossaryTerms: glossary.length,
    navigatorNodes: Object.keys(navigator).filter(k => k !== '_comment').length,
    answers: Object.values(navigator).filter(n => n && n.type === 'answer').length
  };
}

module.exports = {
  graph, glossary, navigator, glossaryBySlug, nodeById,
  edgesFrom, edgesTo, relatedNodeIds, getTerm, navNode, stats, PLATFORM, APP
};
