#!/usr/bin/env node
// Drift guard for the content source of truth (data/programs.json).
//
// Fails when a surface re-introduces a fact that is supposed to live only in
// data/. Today it enforces two things that already drifted in production:
//   1. the cost phrasing — only the canonical phrase is allowed
//   2. the phone numbers — only numbers declared in data/programs.json
//
// Run: node scripts/check-content.mjs   (exit 1 on any violation)

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(ROOT, 'data/programs.json'), 'utf8'));

// Surfaces that render to users. The Python server is included because it is
// what alarahc.com serves today.
const SURFACES = [
  ...readdirSync(join(ROOT, 'public')).filter(f => f.endsWith('.html')).map(f => 'public/' + f),
  'preview_server.py',
];

// Retired cost phrasings. The canonical phrasing (data.constants.costPhrase,
// "no cost to you") is the truthful approved way to say it. These read cheap
// and were explicitly killed.
const BANNED_COST = [
  'pay nothing',
  'most patients pay nothing',
  '$0 out-of-pocket',
];

// Allowed phone numbers = every number declared in the source of truth.
const allowedPhones = new Set();
const c = data.contacts || {};
for (const k of Object.keys(c)) if (c[k] && c[k].phone) allowedPhones.add(c[k].phone);

const PHONE_RE = /\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4}/g;

const violations = [];

for (const rel of SURFACES) {
  let text;
  try { text = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
  const lower = text.toLowerCase();

  for (const phrase of BANNED_COST) {
    let i = lower.indexOf(phrase.toLowerCase());
    while (i !== -1) {
      const line = text.slice(0, i).split('\n').length;
      violations.push(`${rel}:${line}  retired cost phrasing: "${phrase}"`);
      i = lower.indexOf(phrase.toLowerCase(), i + 1);
    }
  }

  for (const m of text.matchAll(PHONE_RE)) {
    const norm = m[0].replace(/[ .-]/g, m2 => m2); // keep as written for the message
    const digits = m[0].replace(/\D/g, '');
    const known = [...allowedPhones].some(p => p.replace(/\D/g, '') === digits);
    if (!known) {
      const line = text.slice(0, m.index).split('\n').length;
      violations.push(`${rel}:${line}  unknown phone number: "${m[0]}" (not in data/programs.json contacts)`);
    }
  }
}

if (violations.length) {
  console.error(`\nContent drift check FAILED — ${violations.length} violation(s):\n`);
  for (const v of violations) console.error('  ' + v);
  console.error(`\nCanonical cost phrasing: "${data.constants.costPhrase}". Fix in data/programs.json, not in markup.\n`);
  process.exit(1);
}

console.log(`Content drift check passed. ${SURFACES.length} surfaces, canonical cost phrasing "${data.constants.costPhrase}", ${allowedPhones.size} known phone numbers.`);
