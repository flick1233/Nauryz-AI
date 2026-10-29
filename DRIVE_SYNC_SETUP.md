# Drive → knowledge base: first-stage RAG fixes

This change uses `text-embedding-3-small` with 384 dimensions for chat retrieval,
Drive imports, FAO imports, the legacy JSONL uploader, the search probe and the offline re-embedding tool. It replaces the
Drive sync's hash vectors, parses PDF bytes, keeps the full document text in
bounded overlapping chunks, and updates changed/renamed PDFs.

## Install on the existing Vercel/Supabase project

1. Apply this branch/patch against commit `8377e66bfb296fb646ab618cdcc053affeafca27`.
   For the supplied patch: `git apply --check nauryz-rag-sync.patch`, then
   `git apply nauryz-rag-sync.patch` from the repository root.
2. Back up the database before migration. Review and run
   `supabase/migrations/202610290001_drive_sync.sql` with the Supabase SQL editor
   or your normal migration workflow. It assumes the existing
   `public.knowledge_chunks` table has `chunk_id`, `source`, `topic`, `content`,
   and `embedding vector(384)`. The live schema has not been accessed here.
   The vector extension can be in `public` or `extensions`.
3. Set these **server-only** environment variables in Vercel:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (or the existing `SUPABASE_SERVICE_KEY` alias)
   - `OPENAI_API_KEY`
   - `GOOGLE_SERVICE_ACCOUNT`: JSON for an account with read access to the folder
   - `CRON_SECRET`: a long random value; Vercel's scheduled request uses it as a
     bearer token. `SYNC_SECRET` is supported only as a legacy fallback.
   - Optional `GOOGLE_DRIVE_FOLDER_ID`; otherwise the previous folder is retained.
   Preserve the existing chat/Anthropic variables. Never put credentials in Git
   or a `NEXT_PUBLIC_*` variable.
4. Deploy the branch to a Vercel preview first. A successful build alone does not
   validate actual Google/OpenAI credentials or the live Supabase schema.
5. Call `/api/sync` with `Authorization: Bearer <CRON_SECRET>` from a trusted
   server-side client. This downloads Drive documents and incurs OpenAI embedding
   usage. Inspect `updated`, `skipped`, `failed`, `deferred` and actual chunk counts.
   Failed and deferred runs return HTTP 207 with `success: false`.
6. Rerun until `failed = 0` and `deferred = 0`. A repeat with unchanged files
   should skip them. Change one PDF and verify that only it is replaced; check a
   related question in the chat. Then promote the tested version to production.

The existing cron schedule is unchanged. The first successful import of each
file repairs its old hash-vector chunks; it does not overwrite manually curated
or other named sources. The database function commits new chunks and sync state
in one transaction, so failed replacements preserve the previous version.
Concurrent replacements of one document are serialized; stale Drive revisions
are rejected. The function and sync state are restricted to `service_role`.

## Limits and intentional exclusions

- Text-layer PDFs only; scanned PDFs require OCR and are reported as failures.
- Maximum 15 MB and 400 chunks per PDF. Oversized inputs fail explicitly rather
  than being silently truncated. Download/embedding requests have timeouts.
- A run stops starting new files after two minutes; completed files are saved,
  remaining files are handled on the next run. Each file's embedding loop also
  has a deadline. Split documents that repeatedly exceed limits.
- Removing a PDF from Drive does not automatically delete its knowledge.
- A changed PDF that cannot be processed keeps its previous chunks.
- A pre-existing legacy PDF renamed before its first successful new sync may
  leave old hash-vector chunks under the previous name. Audit legacy `auto_*`
  sources after the first complete run; no broad automatic deletion is done.
- No changes to diagnosis prompts, UI, languages, or source display are included
  in this first-stage patch.

## Validation

Run on Node.js 22.18+ or 24:

```sh
npm ci
npm test
npx tsc --noEmit
npm run build
```

`npm test` covers vectors and errors, multilingual text/chunk boundaries,
revision/name/pipeline invalidation, skip behaviour, failed embeddings and
writes, Drive pagination/HTTP/size checks, and an actual text-layer PDF fixture.

The optional database regression uses PostgreSQL/pgvector in PGlite without a
live Supabase connection. Install its test-only packages outside the checkout:

```sh
npm install --prefix /tmp/nauryz-db-test --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.13 @electric-sql/pglite-pgvector@0.0.14
NAURYZ_SQL_TEST_MODULES=/tmp/nauryz-db-test node --test tests/drive-sync-db.mjs
```

It applies the real migration with the vector extension in `extensions`, checks
legacy-source isolation, successful and stale updates, transaction rollback
after an insertion error, and denial of access for `anon`. Actual production
RLS policies, table constraints, service credentials and provider connections
still need verification before rollout.
