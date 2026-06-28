// Запуск: node upload_embeddings.js
// Бесплатные эмбеддинги через Hugging Face

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://djemdkjsigmkapimsple.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqZW1ka2pzaWdta2FwaW1zcGxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNjA4OTQsImV4cCI6MjA5NzYzNjg5NH0.pTfv2NA6m3-pMn4YbB3L18PWnKO6XZY631VYRrzo7Vk';

// Бесплатный HuggingFace токен — создай на hf.co/settings/tokens
// Модель multilingual-e5-small даёт 384 измерения (нужно изменить в SQL!)
const HF_TOKEN = process.env.HF_TOKEN || '';

const chunks = fs.readFileSync(path.join(__dirname, 'all_chunks.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));

console.log(`📚 Загружаем ${chunks.length} чанков...\n`);

async function getEmbedding(text) {
  // multilingual-e5-small: 384 dims, поддерживает русский
  const r = await fetch(
    'https://api-inference.huggingface.co/pipeline/feature-extraction/intfloat/multilingual-e5-small',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + HF_TOKEN
      },
      body: JSON.stringify({ inputs: 'query: ' + text, options: { wait_for_model: true } })
    }
  );
  const d = await r.json();
  if (!Array.isArray(d)) throw new Error(JSON.stringify(d).slice(0, 200));
  // HF возвращает [[...]] или [...] — берём первый вектор
  return Array.isArray(d[0]) ? d[0] : d;
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
  if (!HF_TOKEN) {
    console.log('❌ Нужен HF_TOKEN!');
    console.log('1. Зайди на https://huggingface.co/settings/tokens');
    console.log('2. Создай токен (бесплатно)');
    console.log('3. Запусти: $env:HF_TOKEN="hf_xxx"; node upload_embeddings.js');
    process.exit(1);
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

      // Пауза — HF free tier имеет лимит
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

main().catch(console.error);
