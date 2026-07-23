// Разовый фикс: добавляет оговорку об устаревании/непроверенности источника в
// исходные чанки с недатированными рыночными/экономическими цифрами без ссылки
// на первоисточник (s1_005, s1_006, s1_007, s1_008). Текст фактов не меняется —
// только дописывается дисклеймер в конец content. Эмбеддинг пересчитывается,
// т.к. текст чанка изменился.
//
// Запуск: node scripts/add-staleness-disclaimer.cjs
// Требует SUPABASE_URL / SUPABASE_SERVICE_KEY (или ANON_KEY) / OPENAI_API_KEY
// в .env.ingest.local (создать заново — файл с ключами удаляется после каждого
// использования, см. TASK_RAG_EXPANSION.md).

const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvFile(path.join(__dirname, '..', '.env.ingest.local'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_API_KEY) {
  console.error('❌ Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY/SUPABASE_ANON_KEY и OPENAI_API_KEY в .env.ingest.local');
  process.exit(1);
}

const DISCLAIMERS = {
  s1_005:
    'Данные по состоянию на 2023 год без проверяемой ссылки на источник (МСХ РК) — требуют проверки перед использованием как точный факт, особенно ставки субсидий, которые могут пересматриваться ежегодно.',
  s1_006:
    'Цены (корм, суточные цыплята, мясо) приведены по состоянию на 2023 год без проверяемой ссылки на источник (МСХ РК) — рыночные цены меняются, перед использованием в реальных расчётах уточните текущие значения.',
  s1_007:
    'Данные по состоянию на 2024 год без проверяемой ссылки на источник (FAO) — мировые рыночные показатели меняются год к году, требуют проверки перед использованием как точный факт.',
  s1_008:
    'Прогноз по состоянию на 2024 год (FAO) без проверяемой ссылки на источник — на 2026 год часть прогнозного периода (2025-2027) уже прошла, рекомендации требуют проверки на соответствие фактическому развитию рынка.',
};

async function getEmbedding(text) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text, dimensions: 384 }),
  });
  const d = await r.json();
  if (!d.data) throw new Error(JSON.stringify(d).slice(0, 300));
  return d.data[0].embedding;
}

async function main() {
  for (const [chunkId, disclaimer] of Object.entries(DISCLAIMERS)) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_chunks?chunk_id=eq.${chunkId}&select=id,topic,content`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const rows = await res.json();
    if (!rows.length) { console.log(`❌ ${chunkId}: не найден`); continue; }
    const row = rows[0];

    if (row.content.includes(disclaimer)) {
      console.log(`⏭️  ${chunkId}: дисклеймер уже есть, пропускаю`);
      continue;
    }

    const newContent = `${row.content} ⚠️ ${disclaimer}`;
    const embedding = await getEmbedding(`${row.topic}: ${newContent}`);

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_chunks?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ content: newContent, embedding }),
    });

    if (patchRes.ok) console.log(`✅ ${chunkId}: дисклеймер добавлен, переэмбеднут`);
    else console.log(`❌ ${chunkId}: ${(await patchRes.text()).slice(0, 200)}`);
  }
}

main().catch((e) => { console.error('Фатальная ошибка:', e); process.exit(1); });
