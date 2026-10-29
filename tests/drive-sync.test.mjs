import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chunkText, downloadPdf, isCurrent, listDriveFiles, PIPELINE_VERSION, syncFile, MAX_PDF_BYTES } from '../lib/drive-sync.ts';
import embeddings from '../lib/embeddings.cjs';
import { extractPdfText } from '../lib/pdf.ts';

const { getEmbeddings, EMBEDDING_DIMENSIONS } = embeddings;
const file = { id: 'abcdefgh-long-drive-id', name: 'Құс шаруашылығы.pdf', modifiedTime: '2026-10-29T10:00:00.000Z' };
const text = 'Құс шаруашылығы. Poultry feeding and disease prevention. '.repeat(80) + 'END_OF_DOCUMENT';
const vector = Array(384).fill(0.1);
const current = { modified_time: file.modifiedTime, source_name: file.name, pipeline_version: PIPELINE_VERSION };

test('embedding batches use one model/dimension and restore API index order', async () => {
  let payload;
  const result = await getEmbeddings(['query', 'document'], 'test-key', async (_url, init) => {
    payload = JSON.parse(init.body);
    return Response.json({ data: [{ index: 1, embedding: Array(384).fill(2) }, { index: 0, embedding: vector }] });
  });
  assert.equal(payload.model, 'text-embedding-3-small');
  assert.equal(payload.dimensions, EMBEDDING_DIMENSIONS);
  assert.equal(result[0][0], 0.1);
  assert.equal(result[1][0], 2);
});

test('embedding failures, missing results and invalid vectors cannot reach storage', async () => {
  for (const response of [
    new Response('private upstream details', { status: 429 }),
    Response.json({ data: [] }),
    Response.json({ data: [{ index: 0, embedding: [1, 2] }] }),
    Response.json({ data: [{ index: 0, embedding: Array(384).fill(0) }] }),
    Response.json({ data: [{ index: 2, embedding: vector }] }),
  ]) {
    await assert.rejects(getEmbeddings(['text'], 'test-key', async () => response), error => !error.message.includes('private upstream'));
  }
});

test('chunking preserves long paragraphs, document tail and Kazakh letters', () => {
  const chunks = chunkText(text, file);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.content.length <= 1500));
  assert.ok(chunks[0].content.includes('Құс'));
  assert.ok(chunks.at(-1).content.endsWith('END_OF_DOCUMENT'));
  // Every normalized character is represented; overlap can be removed without gaps.
  let rebuilt = chunks[0].content;
  for (const chunk of chunks.slice(1)) rebuilt += chunk.content.slice(150);
  assert.equal(rebuilt, text.replace(/\s+/g, ' ').trim());
  assert.ok(chunks[0].chunk_id.startsWith(`drive_${createHash('sha256').update(file.id).digest('hex')}_`));
  assert.notEqual(chunks[0].chunk_id, chunkText(text, { ...file, id: 'abcdefgh-other-file' })[0].chunk_id);
});

test('empty/scanned PDFs and oversized texts fail rather than silently truncating', () => {
  assert.throws(() => chunkText('', file), /OCR/);
  assert.throws(() => chunkText('1234 '.repeat(100), file), /OCR/);
  assert.throws(() => chunkText('Poultry '.repeat(100_000), file), /chunk limit/);
});

test('unchanged documents skip; revision, rename and pipeline changes reprocess', async () => {
  assert.equal(isCurrent(file, current), true);
  for (const state of [null, { ...current, modified_time: '2026-10-28T00:00:00Z' }, { ...current, source_name: 'old.pdf' }, { ...current, pipeline_version: 'hash-vector-v1' }]) {
    assert.equal(isCurrent(file, state), false);
  }
  const result = await syncFile(file, {
    readState: async () => current,
    extract: async () => { throw new Error('Must not download unchanged PDF'); },
    embed: async () => { throw new Error('Must not spend tokens'); },
    replace: async () => { throw new Error('Must not write'); },
  });
  assert.equal(result.status, 'skipped');
});

test('embedding failure leaves the previous database document untouched', async () => {
  let replaced = false;
  let batches = 0;
  await assert.rejects(syncFile(file, {
    readState: async () => null,
    // Unique paragraphs force multiple batches even after duplicate-vector reuse.
    extract: async () => Array.from({ length: 1200 }, (_, i) => `Section ${i}: poultry symptoms feeding and prevention. `).join(''),
    embed: async texts => { if (++batches === 2) throw new Error('quota'); return texts.map(() => vector); },
    replace: async () => { replaced = true; return true; },
  }), /quota/);
  assert.equal(replaced, false);
});

test('successful sync replaces once, only after all embeddings; commit error is not success', async () => {
  let calls = 0;
  const deps = {
    readState: async () => null, extract: async () => text,
    embed: async texts => texts.map(() => vector),
    replace: async (_file, chunks) => {
      calls++;
      assert.ok(chunks.every(chunk => chunk.embedding.length === 384));
      return true;
    },
  };
  const result = await syncFile(file, deps);
  assert.equal(result.status, 'updated');
  assert.equal(calls, 1);
  await assert.rejects(syncFile(file, { ...deps, replace: async () => { throw new Error('transaction rolled back'); } }), /rolled back/);
  assert.equal((await syncFile(file, { ...deps, replace: async () => false })).status, 'skipped');
});

test('Drive listing follows pagination and rejects HTTP failures', async () => {
  let count = 0;
  const files = await listDriveFiles('token', 'folder', async url => {
    count++;
    if (count === 1) return Response.json({ files: [file], nextPageToken: 'page2' });
    assert.equal(new URL(url).searchParams.get('pageToken'), 'page2');
    return Response.json({ files: [{ ...file, id: 'second' }] });
  });
  assert.equal(files.length, 2);
  await assert.rejects(listDriveFiles('token', 'folder', async () => new Response('', { status: 403 })), /403/);
});

test('PDF download reads binary data and rejects non-PDF, HTTP and size errors', async () => {
  const bytes = Buffer.from('%PDF-1.4\nBinary data');
  assert.deepEqual(await downloadPdf(file.id, 'token', async () => new Response(bytes)), bytes);
  await assert.rejects(downloadPdf(file.id, 'token', async () => new Response('not a PDF')), /not a PDF/);
  await assert.rejects(downloadPdf(file.id, 'token', async () => new Response('', { status: 404 })), /404/);
  await assert.rejects(downloadPdf(file.id, 'token', async () => new Response(bytes, { headers: { 'Content-Length': String(MAX_PDF_BYTES + 1) } })), /15 MB/);
  await assert.rejects(downloadPdf(file.id, 'token', async () => new Response(new Uint8Array(MAX_PDF_BYTES + 1))), /15 MB/);
});

test('actual PDF text reaches semantic embeddings and document replacement', async () => {
  const bytes = readFileSync(new URL('./fixtures/poultry.pdf', import.meta.url));
  const result = await syncFile(file, {
    readState: async () => null,
    extract: async () => extractPdfText(await downloadPdf(file.id, 'token', async () => new Response(bytes))),
    embed: async texts => {
      assert.ok(texts[0].includes('Poultry feeding'));
      assert.ok(!texts[0].includes('endobj'));
      return getEmbeddings(texts, 'test-key', async () => Response.json({ data: texts.map((_, index) => ({ index, embedding: vector })) }));
    },
    replace: async (_file, chunks) => { assert.ok(chunks[0].content.includes('clean drinking water')); return true; },
  });
  assert.equal(result.status, 'updated');
});
