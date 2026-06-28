// Запуск: node upload_embeddings.js
// Требует: npm install @supabase/supabase-js (в папке проекта)

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://djemdkjsigmkapimsple.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqZW1ka2pzaWdta2FwaW1zcGxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNjA4OTQsImV4cCI6MjA5NzYzNjg5NH0.pTfv2NA6m3-pMn4YbB3L18PWnKO6XZY631VYRrzo7Vk';
const OPENAI_KEY = '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';

// Читаем чанки (файл должен быть в той же папке)
const chunks = fs.readFileSync(path.join(__dirname, 'all_chunks.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));

console.log(`📚 Загружаем ${chunks.length} чанков в Supabase...\n`);

async function getEmbedding(text) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + OPENAI_KEY
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text })
  });
  const d = await r.json();
  if (!d.data) throw new Error(JSON.stringify(d));
  return d.data[0].embedding;
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
    // Если дубликат — пропускаем
    if (t.includes('duplicate')) return 'skip';
    throw new Error(t);
  }
  return 'ok';
}

async function main() {
  let ok = 0, skipped = 0, failed = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const text = chunk.topic + ': ' + chunk.text;
      const embedding = await getEmbedding(text);
      const result = await insertChunk(chunk, embedding);

      if (result === 'skip') {
        skipped++;
        console.log(`⏭️  [${i+1}/${chunks.length}] Пропущен (уже есть): ${chunk.id}`);
      } else {
        ok++;
        console.log(`✅ [${i+1}/${chunks.length}] Загружен: ${chunk.id}`);
      }

      // Пауза 200мс чтобы не превысить rate limit
      await new Promise(r => setTimeout(r, 200));

    } catch(e) {
      failed++;
      console.log(`❌ [${i+1}/${chunks.length}] Ошибка ${chunk.id}: ${e.message.slice(0, 120)}`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Загружено: ${ok}`);
  console.log(`⏭️  Пропущено: ${skipped}`);
  console.log(`❌ Ошибок: ${failed}`);
  console.log(`\nГотово! Теперь добавь в .env.local:`);
  console.log(`SUPABASE_URL=${SUPABASE_URL}`);
  console.log(`SUPABASE_ANON_KEY=${SUPABASE_KEY}`);
  console.log(`OPENAI_API_KEY=${OPENAI_KEY}`);
}

main().catch(console.error);
