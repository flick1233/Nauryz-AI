import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual route with isolated environment and fail-closed dependencies.
// No credentials or network from the test runner are inherited.
const source = readFileSync(new URL('../app/api/sync/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function route(environment) {
  const effects = [];
  const forbidden = name => () => { effects.push(name); throw new Error(`Unexpected external action: ${name}`); };
  const modules = {
    '@supabase/supabase-js': { createClient: forbidden('database client') },
    'node:crypto': { sign: forbidden('Google token signature') },
    '../../../lib/pdf': { extractPdfText: forbidden('PDF extraction') },
    '../../../lib/embeddings.cjs': { getEmbeddings: forbidden('paid embeddings') },
    '../../../lib/drive-sync': {
      downloadPdf: forbidden('download'), listDriveFiles: forbidden('Drive listing'),
      syncFile: forbidden('sync/write'), PIPELINE_VERSION: 'test',
    },
  };
  const context = {
    exports: {}, process: { env: environment }, Response,
    fetch: forbidden('network'), console,
    require: name => { assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name]; },
  };
  vm.runInNewContext(compiled, context);
  return { GET: context.exports.GET, effects };
}

test('Preview rejects sync even with valid authorization and complete configuration, before external effects', async () => {
  const { GET, effects } = route({
    VERCEL_ENV: 'preview', CRON_SECRET: 'fixture-secret', SUPABASE_URL: 'https://example.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-key', GOOGLE_SERVICE_ACCOUNT: '{}', OPENAI_API_KEY: 'fixture-key',
  });
  for (const authorization of [null, 'Bearer fixture-secret']) {
    const response = await GET(new Request('http://localhost/api/sync', {
      headers: authorization ? { authorization } : {},
    }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Knowledge sync is disabled in Preview' });
  }
  assert.deepEqual(effects, []);
});

test('Production and local sync retain authentication and configuration checks', async () => {
  for (const environment of [{ VERCEL_ENV: 'production' }, {}]) {
    const { GET, effects } = route({ ...environment, SYNC_SECRET: 'fixture-secret' });
    assert.equal((await GET(new Request('http://localhost/api/sync'))).status, 401);
    assert.equal((await GET(new Request('http://localhost/api/sync', {
      headers: { authorization: 'Bearer fixture-secret' },
    }))).status, 503);
    assert.deepEqual(effects, []);
  }
});
