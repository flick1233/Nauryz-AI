#!/usr/bin/env node
// Always offline/dry-run. An inventory file is evidence to inspect, not permission to write.
const fs = require('node:fs');
const { planKnowledge } = require('../lib/knowledge-plan.cjs');
const [candidatesFile, inventoryFile] = process.argv.slice(2);
if (!candidatesFile) { console.error('Usage: node scripts/plan-knowledge.cjs candidates.json [inventory.json]'); process.exit(1); }
try {
  const candidates = JSON.parse(fs.readFileSync(candidatesFile, 'utf8'));
  const inventory = inventoryFile ? JSON.parse(fs.readFileSync(inventoryFile, 'utf8')) : [];
  if (!Array.isArray(candidates) || !Array.isArray(inventory)) throw new Error('Expected JSON arrays');
  // File presence does not prove it is a recent, complete production inventory.
  const plan = planKnowledge(candidates, inventory);
  console.log(JSON.stringify({ mode: 'dry-run', liveInventoryVerified: false, candidates: candidates.length, decisions: plan }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
