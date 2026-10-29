# Local improvements awaiting review

The existing RAG/Drive patch and its SQL migration are preserved. Nothing was
pushed, deployed, migrated in production or imported into the live knowledge base.
Production baseline supplied by user: https://nauryz-ai.vercel.app/ . This executor's
proxy denied the baseline read (CONNECT 403), so local checks are distinct from live checks.

## Chat and cost controls

- User question limit: 8,000 characters. History: at most 16 messages and 24,000
  characters, keeping the initial question (if within the question limit) and recent
  complete messages. The model and UI receive an explicit history-window notice.
  These are character bounds, not tokenizer measurements. Old details can still
  fall outside the window; users may need to restate important facts.
- Old images/video frames are not resent. A new image is still sent for analysis;
  prior structured findings and clarification questions now survive follow-ups as
  text instead of empty assistant messages. Text follow-ups use the text model.
- Internet search is opt-in and part of the main Anthropic stream (max one search
  use), replacing the browser's separate `/api/search` synthesis call. The legacy
  endpoint remains for compatibility but the updated UI does not call it.
- RAG keeps the calibrated 0.35 threshold and four-result count. It removes exact
  normalized duplicate excerpts and caps context at 6,400 characters before the
  small explanatory wrapper. It shows supplied source names, not an unsupported
  claim that every answer statement was verified by these sources.
- Query embeddings coalesce identical concurrent requests, expire after five
  minutes, have at most 128 cache entries, and are scoped by API credential. Only
  vectors and hashed cache keys are retained in warm process memory, never answers.
  Cache hits are not guaranteed across serverless instances or cold starts.
- Drive ingestion reuses vectors for identical text within a document, preserving
  all chunk IDs and transactional replacement. Existing unchanged-file skip remains.
- Cancel stops the provider stream, duplicate sends are guarded, and messages cannot
  migrate between chats mid-stream. Error responses avoid exposing provider details.
- Displayed dollar amounts are estimated token costs from the repository's existing
  rate table, excluding web-search fees. Unknown model overrides have no invented
  fallback price. No real API cost reduction or diagnostic accuracy is claimed yet.

Run `npm test`, `./node_modules/.bin/tsc --noEmit --incremental false`, and
`NEXT_TELEMETRY_DISABLED=1 npm run build`. The DB regression remains optional:
`NAURYZ_SQL_TEST_MODULES=/tmp/nauryz-db-test node --test tests/drive-sync-db.mjs`.

## Interface

Keep the existing warm palette, RU/Kazakh UI, theme, photo cards and deterministic
feed calculator. Four primary questions, secondary expandable topics, labelled
composer, higher contrast controls, readable narrow-screen composition, explicit
request errors, recoverable questions, source details and local-storage warnings.
Dialogs get modal semantics, initial/trapped/restored focus, Escape and named
numeric inputs. Collapsed history is inert; document language follows UI language.
Veterinary wording promises preliminary assessment rather than a confirmed photo
diagnosis. Calculations continue without paid model calls.

## Disease knowledge staging contract (no writes)

New material must be compared with the actual existing knowledge base first.
Neither a local JSONL snapshot nor an old URL establishes current production
inventory. The offline planner deliberately blocks import until a fresh complete
live inventory can be obtained and reviewed; the CLI never marks it verified.

Expected candidate JSON array entries:

```json
{
  "id": "stable-disease-evidence-id",
  "disease": "Canonical disease name",
  "synonyms": ["Alternative name"],
  "content": "Original, source-grounded summary of 100–1200 characters; include red flags and diagnostic limits.",
  "source": {
    "id": "stable-source-id",
    "title": "Reference title",
    "url": "https://publisher.example/reference",
    "version": "edition or revision/date",
    "license": "Verified terms, or basis for an original referenced summary",
    "rightsStatus": "cleared",
    "reviewStatus": "verified",
    "reviewedAt": "2026-10-29"
  }
}
```

Do not mark rights/evidence verified just to satisfy validation. Do not copy
copyrighted books wholesale. `node scripts/plan-knowledge.cjs candidates.json
[inventory.json]` produces a dry-run plan without API calls or database changes.
The library classifies exact existing/staged content as skip, changed source as
update-review, canonical-name/synonym or lexical-overlap matches as conflict-review,
and remaining candidates as add-review. Lexical comparison cannot establish
semantic uniqueness or veterinary correctness; all additions still need review.
No automatic overwrite/delete is implemented. Provenance stays in plan records;
any later importer must preserve source URL/version/review/hash in metadata or in
each chunk's text for the existing minimal schema, and verify RPC returns it.
Live import requires a current schema/RLS inventory, an authorized server-side
writer, an idempotent write plan and approval of the concrete production change.

## Verified in this checkout

- `npm test`: 21 tests passed (no skipped/zero-test substitutions).
- TypeScript, Next production build and `git diff --check`: passed.
- Isolated SQL regression: 1 named migration test passed.
- `node tests/ui-smoke.cjs`: passed against the built local app using system
  Chromium (`/usr/bin/chromium`, or `CHROMIUM_PATH`) and mocked chat responses.
  Verified dialog focus/trap/Escape/restore, 3 named numeric fields and calculation,
  inert collapsed sidebar, RU/Kazakh document language, layouts at 360/768/1440,
  one chat request with opt-in search and no legacy search call, structured
  follow-up context, HTTP-error recovery, and empty-history persistence after reload.
  There were no JavaScript page errors. Google fonts/external traffic were blocked
  in this test, so screenshots use the system fallback font.
- `node tests/chat-api-smoke.cjs`: passed. Starts a temporary second Next server
  and a loopback-only fake Anthropic endpoint, exercising actual SDK streaming,
  single-pass search configuration, old-media removal/text-model follow-up, usage
  metadata, sanitized 429 responses and upstream cancellation. No real key or paid
  service was used; the fake test key is scoped to the temporary child process.
- Real local API checks: malformed JSON and invalid role => 400; question over
  8,000 chars => 413; missing Anthropic configuration => 503; unauthenticated sync => 401.

Synthetic measurement (not real users, tokens or billed cost): 42-message history
with 72,044 text characters becomes 15 messages/23,444 characters. A repetitive
39-chunk document embeds 6 distinct texts while storing all 39 chunks. Local
`all_chunks.jsonl` has 58 records from 5 sources and no exact normalized-text
repeats; this says nothing about the current live database's contents.

Network checks from this executor returned proxy CONNECT 403 for the supplied
production site. Latest runtime observation still does not enforce the exact
Supabase-host grant or inject variables, although local ignored `.env.local`
loads the public URL/key. The exact Supabase domain was explicitly approved and
saved in the environment draft earlier; no broader access was added. Draft
publication has a user-interface route; available tools can save drafts but cannot
publish or reconnect this task. Do not confuse a different task's published-state
message with verified runtime access here, or repeatedly ask to reenter keys.
Live chat/retrieval quality, production migration, database inventory/import and
deployment remain unverified/not performed. Research candidates were subsequently received as exact ZIP bytes; see the staging audit below. They remain candidates, not clinically approved production knowledge.


## Received research package: completed offline staging audit

The original 23,818-byte ZIP was transferred in six base64 parts without Library
materialization tools. SHA256 matched
`f2fef5040a04d76caad7c3c3e950ee170d0c649e2941617aedf87bcdb25a3640`.
ZIP CRC, 8 manifest file sizes/hashes, JSON Schema Draft 2020-12 for all 14 cards,
content hashes, stable chunk IDs and references to 15 unique sources passed.
Original data and `production_import_allowed=false` flags were not modified.
Source-identity hashes are bibliographic references, not raw downloaded-source
hashes. Source facts were not independently re-fetched in this executor.

Use `python scripts/compare-staged-knowledge.py PACKAGE_DIR all_chunks.jsonl` for
the actual research format (not the earlier generic JSON planner format). It is
offline, produces JSON to stdout, and has no import/write mode. In this instance
PACKAGE_DIR is
`/workspace/artifacts/nauryz-knowledge-staging/received/nauryz_poultry_knowledge`.
Full output is `full-staging-dry-run.json` alongside the received ZIP.

Result against the 58-record local seed: 10 cards have existing concept/keyword
overlaps and 4 are possible gaps requiring review: fowl pox, ectoparasites,
intestinal helminths and botulism. No exact existing text duplicates were found by
the defined normalization. Add=0, update=0, skip=0, review=14. This does not mean
that all 4 are missing from production, or that the 10 existing mentions fully
cover the proposed facts. Generic salmonellosis does not confirm Enteritidis
coverage, and MG, parasite groups and avian-influenza subtypes cannot be silently
merged. Source matching cannot be established because all 58 local records lack
structured source URL/version/licence metadata.

Rights labels in supplied source metadata: 3 OGL-v3, 1 CC-BY-4.0 text-only, 9
unverified-scope, 1 restricted nonprofit unaltered-copy, 1 reuse-permission not
verified. These labels are not a blanket production-reuse approval. Veterinary,
local-jurisdiction and production-rights review remain pending for the cards.
No books, images or raw source documents were copied into application retrieval;
WOAH, FAO and Merck remain bibliography-only pointers in this package. Live
inventory and concrete reviewed additions are required before any production
knowledge write.
