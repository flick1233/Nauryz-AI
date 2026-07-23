const fs = require('fs');
for (const line of fs.readFileSync('.env.ingest.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

async function getEmbedding(text) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text, dimensions: 384 }),
  });
  const d = await r.json();
  return d.data[0].embedding;
}

async function search(query) {
  const embedding = await getEmbedding(query);
  const r = await fetch(`${URL}/rest/v1/rpc/match_chunks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ query_embedding: embedding, match_count: 4, match_threshold: 0.35 }),
  });
  if (!r.ok) {
    console.log('  ❌ RPC error:', (await r.text()).slice(0, 300));
    return;
  }
  const rows = await r.json();
  console.log(`  ${rows.length} результатов:`);
  for (const row of rows) {
    console.log(`   - [${row.source}] sim=${row.similarity?.toFixed(3) ?? '?'} | ${(row.content || '').slice(0, 140)}...`);
  }
}

const QUERIES = [
  'Сколько яиц производится в Казахстане?',
  'Как правильно организовать содержание кур на подворье?',
  'Курица хромает, что делать?', // старый вопрос — должен по-прежнему находить старые чанки
];

// Запуск: node scripts/test-search.cjs (нужен .env.ingest.local с реальными ключами)
// Порог совпадает с app/api/chat/route.ts (0.35, откалибровано вручную).
(async () => {
  for (const q of QUERIES) {
    console.log(`\n=== "${q}" ===`);
    await search(q);
  }
})();
