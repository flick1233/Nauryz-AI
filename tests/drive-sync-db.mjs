// Optional PostgreSQL/pgvector regression test. See DRIVE_SYNC_SETUP.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(process.env.NAURYZ_SQL_TEST_MODULES
  ? path.join(process.env.NAURYZ_SQL_TEST_MODULES, 'package.json') : import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const { vector } = require('@electric-sql/pglite-pgvector');

test('Drive migration: atomic replacement, legacy cleanup, stale revision and RLS', async () => {
  const db = new PGlite({ extensions: { vector } });
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema extensions;
      create extension vector with schema extensions;
      create table public.knowledge_chunks (
        id bigint generated always as identity primary key,
        chunk_id text unique not null, source text not null, topic text not null,
        content text not null check(length(content) <= 1500), embedding extensions.vector(384) not null
      );
      grant usage on schema public, extensions to service_role;
      grant all on public.knowledge_chunks to service_role;
      grant usage, select on all sequences in schema public to service_role;
    `);
    await db.exec(readFileSync(new URL('../supabase/migrations/202610290001_drive_sync.sql', import.meta.url), 'utf8'));
    const fileId = 'abcdefgh-long-drive-id';
    const prefix = `drive_${createHash('sha256').update(fileId).digest('hex')}_`;
    const values = Array(384).fill(0.1);
    await db.query(`insert into public.knowledge_chunks(chunk_id,source,topic,content,embedding) values
      ('auto_abcdefgh_0','guide.pdf','old','legacy hash-vector',$1),
      ('auto_abcdefgh_1','other.pdf','other','other source',$1),
      ('manual_original','guide.pdf','original','curated text',$1)`, [JSON.stringify(values)]);
    const chunk = (index, content = 'New PDF text') => ({ chunk_id: `${prefix}${index}`, source: 'guide.pdf', topic: 'poultry', content, embedding: values });
    const replace = async (revision, chunks, pipeline = 'test-v2') => (await db.query(
      'select public.replace_drive_knowledge($1,$2,$3,$4,$5::jsonb) as updated',
      [fileId, revision, 'guide.pdf', pipeline, JSON.stringify(chunks)],
    )).rows[0].updated;
    await db.exec('set role service_role');
    assert.equal(await replace('2026-10-29T10:00:00Z', [chunk(0), chunk(1)]), true);
    let rows = (await db.query('select chunk_id from public.knowledge_chunks order by chunk_id')).rows;
    assert.equal(rows.length, 4);
    assert.ok(!rows.some(row => row.chunk_id === 'auto_abcdefgh_0'));
    assert.ok(rows.some(row => row.chunk_id === 'auto_abcdefgh_1'));
    assert.ok(rows.some(row => row.chunk_id === 'manual_original'));
    assert.equal(await replace('2026-10-29T10:00:00Z', [chunk(0)]), false);
    assert.equal(await replace('2026-10-28T10:00:00Z', [chunk(0)]), false);
    // Force an insertion error AFTER old chunks have been deleted inside the function.
    await assert.rejects(replace('2026-10-30T10:00:00Z', [chunk(0, 'x'.repeat(1501))]), /check constraint/);
    assert.equal((await db.query('select count(*)::int as n from public.knowledge_chunks')).rows[0].n, 4);
    assert.equal((await db.query('select modified_time from public.knowledge_sync_files')).rows[0].modified_time, '2026-10-29T10:00:00Z');
    assert.equal(await replace('2026-10-30T10:00:00Z', [chunk(0, 'Updated PDF text')]), true);
    assert.equal((await db.query('select count(*)::int as n from public.knowledge_chunks')).rows[0].n, 3);
    await assert.rejects(replace('2026-10-31T10:00:00Z', []), /chunk count/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.knowledge_sync_files'), /permission denied/);
    await assert.rejects(replace('2026-10-31T10:00:00Z', [chunk(0)]), /permission denied/);
  } finally { await db.close(); }
});
