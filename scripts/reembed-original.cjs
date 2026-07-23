const fs = require('fs');
for (const line of fs.readFileSync('.env.ingest.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

async function getEmbeddings(texts) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts, dimensions: 384 }),
  });
  const d = await r.json();
  if (!d.data) throw new Error(JSON.stringify(d).slice(0, 300));
  return d.data.map((x) => x.embedding);
}

(async () => {
  const res = await fetch(
    `${URL}/rest/v1/knowledge_chunks?select=id,chunk_id,topic,content&chunk_id=not.like.fao_*&chunk_id=not.like.stats_kz_*`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
  );
  const rows = await res.json();
  console.log(`Переэмбечиваю ${rows.length} исходных чанков...`);

  let ok = 0, fail = 0;
  const BATCH = 16;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const embeddings = await getEmbeddings(batch.map((r) => `${r.topic}: ${r.content}`));
    for (let j = 0; j < batch.length; j++) {
      const row = batch[j];
      const patchRes = await fetch(`${URL}/rest/v1/knowledge_chunks?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ embedding: embeddings[j] }),
      });
      if (patchRes.ok) ok++;
      else { fail++; console.log(`  ❌ ${row.chunk_id}: ${(await patchRes.text()).slice(0, 150)}`); }
    }
    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log(`\n✅ Готово: ${ok} обновлено, ${fail} ошибок`);
})();
