// Запуск: node upload_embeddings.js
// Uses the same OpenAI vectors as chat retrieval and Drive ingestion.
// Provide environment variables in your shell; credentials are never embedded.
const fs = require('fs');
const path = require('path');
const { getEmbeddings } = require('./lib/embeddings.cjs');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const chunks = fs.readFileSync(path.join(__dirname, 'all_chunks.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));

console.log(`📚 Загружаем ${chunks.length} чанков...\n`);

async function getEmbedding(text) {
  return (await getEmbeddings([text]))[0];
}

async function insertChunk(chunk, embedding) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/knowledge_chunks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      chunk_id: chunk.id,
      source: chunk.source,
      topic: chunk.topic,
      content: chunk.text,
      embedding: JSON.stringify(embedding)
    })
  });
  if (!r.ok) {
    const t = await r.text();
    if (t.includes('duplicate')) return 'skip';
    throw new Error(t);
  }
  return 'ok';
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.OPENAI_API_KEY) {
    throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY), and OPENAI_API_KEY');
  }

  // Сначала проверим размерность эмбеддинга
  console.log('🔍 Проверяем модель...');
  const testEmb = await getEmbedding('тест');
  console.log(`✅ Модель работает, размерность: ${testEmb.length}\n`);

  let ok = 0, skipped = 0, failed = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const text = chunk.topic + ': ' + chunk.text;
      const embedding = await getEmbedding(text);
      const result = await insertChunk(chunk, embedding);

      if (result === 'skip') {
        skipped++;
        console.log(`⏭️  [${i+1}/${chunks.length}] Пропущен: ${chunk.id}`);
      } else {
        ok++;
        console.log(`✅ [${i+1}/${chunks.length}] ${chunk.id}`);
      }

      // Bound the pace of the one-off import.
      await new Promise(r => setTimeout(r, 500));

    } catch(e) {
      failed++;
      console.log(`❌ [${i+1}/${chunks.length}] ${chunk.id}: ${e.message.slice(0, 120)}`);
      // При ошибке ждём дольше
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Загружено: ${ok}`);
  console.log(`⏭️  Пропущено: ${skipped}`);
  console.log(`❌ Ошибок: ${failed}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
