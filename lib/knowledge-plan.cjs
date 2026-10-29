const { createHash } = require('node:crypto');
const normalized = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const fingerprint = text => createHash('sha256').update(normalized(text)).digest('hex');
const words = text => new Set(normalized(text).match(/[\p{L}\p{N}]+/gu) || []);
function overlap(a, b) {
  const left = words(a), right = words(b);
  if (!left.size || !right.size) return 0;
  let common = 0; for (const token of left) if (right.has(token)) common++;
  return common / Math.min(left.size, right.size);
}
function validateCandidate(candidate) {
  const errors = [];
  if (!candidate || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(candidate.id || '')) errors.push('stable id required');
  if (typeof candidate?.disease !== 'string' || !candidate.disease.trim()) errors.push('canonical disease required');
  if (typeof candidate?.content !== 'string' || candidate.content.trim().length < 100 || candidate.content.length > 1200) errors.push('summary must be 100–1200 characters');
  if (!Array.isArray(candidate?.synonyms) || candidate.synonyms.some(s => typeof s !== 'string')) errors.push('synonyms required');
  const source = candidate?.source;
  if (!source?.id || !source?.title || !source?.version || !source?.license) errors.push('source id/title/version/license required');
  try { if (new URL(source?.url).protocol !== 'https:') throw Error(); } catch { errors.push('HTTPS source URL required'); }
  if (source?.rightsStatus !== 'cleared' || source?.reviewStatus !== 'verified' || !/^\d{4}-\d{2}-\d{2}$/.test(source?.reviewedAt || '')) errors.push('rights and evidence review required');
  return errors;
}

// A plan only. No database writes, downloads or paid embedding calls.
function planKnowledge(candidates, inventory, { liveInventoryVerified = false } = {}) {
  const staged = new Set();
  return candidates.map(candidate => {
    const errors = validateCandidate(candidate);
    const base = { id: candidate?.id, disease: candidate?.disease, source: candidate?.source, contentHash: fingerprint(candidate?.content) };
    if (errors.length) return { ...base, decision: 'blocked', reasons: errors };
    if (staged.has(base.contentHash)) return { ...base, decision: 'skip', reasons: ['identical staged content'] };
    staged.add(base.contentHash);
    if (!liveInventoryVerified) return { ...base, decision: 'blocked', reasons: ['live knowledge inventory not verified'] };
    const exact = inventory.find(row => fingerprint(row.content || row.text) === base.contentHash);
    if (exact) return { ...base, decision: 'skip', reasons: ['identical existing content'], existingId: exact.chunk_id || exact.id };
    const sameSource = inventory.find(row => (row.source_url || row.source?.url) === candidate.source.url);
    if (sameSource) return { ...base, decision: 'update-review', reasons: ['source already exists; compare version and coverage manually'], existingId: sameSource.chunk_id || sameSource.id };
    const names = [candidate.disease, ...candidate.synonyms].map(normalized).filter(Boolean);
    const related = inventory.find(row => names.some(name => normalized([row.disease, row.topic, row.content || row.text].join(' ')).includes(name)) || overlap(candidate.content, row.content || row.text) >= 0.8);
    if (related) return { ...base, decision: 'conflict-review', reasons: ['existing disease or overlapping coverage; verify useful new evidence'], existingId: related.chunk_id || related.id };
    return { ...base, decision: 'add-review', reasons: ['no exact or lexical overlap found; semantic and veterinary review still required'] };
  });
}
module.exports = { planKnowledge, validateCandidate, fingerprint };
