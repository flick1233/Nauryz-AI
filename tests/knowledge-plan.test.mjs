import test from 'node:test';
import assert from 'node:assert/strict';
import knowledge from '../lib/knowledge-plan.cjs';
const { planKnowledge } = knowledge;
const candidate = { id: 'poultry-condition', disease: 'Disease example', synonyms: ['Alternative name'], content: 'A veterinary summary of symptoms and red flags with supportive care and diagnostic confirmation requirements. No definitive diagnosis or drug dosage.', source: { id: 'book', title: 'Test source', url: 'https://example.org/guide', version: '1', license: 'test fixture', rightsStatus: 'cleared', reviewStatus: 'verified', reviewedAt: '2026-10-29' } };
test('knowledge import is blocked without verified live inventory or evidence review', () => {
  assert.equal(planKnowledge([candidate], [])[0].decision, 'blocked');
  assert.equal(planKnowledge([{ ...candidate, source: { ...candidate.source, rightsStatus: 'unknown' } }], [], { liveInventoryVerified: true })[0].decision, 'blocked');
});
test('identical existing or staged content is skipped regardless of title and spacing', () => {
  const existing = [{ chunk_id: 'old', content: candidate.content.toUpperCase() }];
  assert.equal(planKnowledge([candidate], existing, { liveInventoryVerified: true })[0].decision, 'skip');
  assert.equal(planKnowledge([candidate, candidate], [])[1].decision, 'skip');
});
test('source revisions and disease synonyms require review; no blind overwrite', () => {
  assert.equal(planKnowledge([candidate], [{ source_url: candidate.source.url, content: 'old' }], { liveInventoryVerified: true })[0].decision, 'update-review');
  assert.equal(planKnowledge([candidate], [{ topic: 'Alternative name', content: 'old' }], { liveInventoryVerified: true })[0].decision, 'conflict-review');
  assert.equal(planKnowledge([candidate], [], { liveInventoryVerified: true })[0].decision, 'add-review');
});
