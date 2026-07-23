// Разовая загрузка новых источников в RAG-базу Nauryz AI:
//   - 3 FAO PDF-руководства по птицеводству (приоритет 1, TASK_RAG_EXPANSION.md)
//   - Снэпшот рыночной статистики Казахстана (приоритет 2, POULTRY_SOURCES.md раздел 4)
//
// Запуск (локально, НЕ на Vercel — см. TASK_RAG_EXPANSION.md про лимит функций):
//   node scripts/ingest-sources.cjs
//
// Требует .env.ingest.local (в .gitignore) со значениями:
//   SUPABASE_URL=https://xxxxx.supabase.co
//   SUPABASE_SERVICE_KEY=sb_secret_...   (или anon-ключ, если на таблице нет RLS-запрета на insert)
//   OPENAI_API_KEY=sk-proj-...
//
// Идемпотентно: chunk_id детерминированный (hash от source_url + индекс чанка),
// повторный запуск не создаёт дублей — используется upsert с ON CONFLICT (chunk_id) DO NOTHING,
// с фолбэком на одиночные insert + разбор "duplicate key" в ответе, если на таблице нет
// уникального индекса на chunk_id.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- .env.ingest.local -------------------------------------------------
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
  console.error('❌ Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY (или SUPABASE_ANON_KEY) и OPENAI_API_KEY в .env.ingest.local');
  process.exit(1);
}

const pdfParse = require('pdf-parse');

// --- Источники -----------------------------------------------------------

const FAO_SOURCES = [
  {
    url: 'https://www.fao.org/4/y5169e/y5169e00.pdf',
    name: 'FAO — Small-scale Poultry Production (Sonaiya & Swan, 2004)',
  },
  {
    url: 'https://www.fao.org/4/al674e/al674e00.pdf',
    name: 'FAO — Smallholder Poultry Production: Livelihoods, Food Security and Sociocultural Significance (2010)',
  },
  {
    url: 'https://www.fao.org/4/i3542e/i3542e.pdf',
    name: 'FAO Animal Production and Health Guidelines №16 — Family Poultry Development',
  },
];

// Снэпшот статистики — POULTRY_SOURCES.md, раздел 4.
const SNAPSHOT_DATE = '2026-07-23';
const STATS_DISCLAIMER = `Данные актуальны на июль ${SNAPSHOT_DATE.slice(0, 4)}, требуют периодической проверки — рыночная статистика быстро устаревает.`;
const KZ_STATS_CHUNKS = [
  {
    topic: 'поголовье_и_производство_птицы_казахстан_2025',
    text: `На 1 октября 2025 года общее поголовье птицы в Казахстане достигло 49 миллионов голов, увеличившись на 6,5% год к году. По итогам 2024 года произведено 4,5 млрд пищевых яиц (+1,5% к предыдущему году) и 360 тысяч тонн мяса птицы (+7% к 2023 году). ${STATS_DISCLAIMER}`,
  },
  {
    topic: 'самообеспечение_мясом_птицы_господдержка_кредиты',
    text: `К 2027 году Казахстан планирует полностью обеспечивать внутренний рынок мясом птицы — доля отечественной продукции выросла до 80% (с чуть более половины 5 лет назад), во многом благодаря господдержке, включая льготные кредиты для птицефабрик. ${STATS_DISCLAIMER}`,
  },
  {
    topic: 'производство_яиц_январь_май_2026',
    text: `По итогам января–мая 2026 года в Казахстане произведено 1,9 млрд яиц — на 7,6% больше, чем за аналогичный период 2025 года, что стало самым высоким показателем за последние четыре года. ${STATS_DISCLAIMER}`,
  },
  {
    topic: 'производство_мяса_птицы_2025_динамика',
    text: `По итогам 2025 года объём производства мяса птицы в Казахстане достиг 371,7 тыс. тонн — рост в 11,2 раза по сравнению с 2000 годом (33,2 тыс. тонн). ${STATS_DISCLAIMER}`,
  },
  {
    topic: 'проблемы_отрасли_себестоимость_кормов',
    text: `Ключевые проблемы птицеводческой отрасли Казахстана: нехватка мясных пород птицы и высокая себестоимость кормов — на пшеницу, соевый шрот и кукурузу приходится порядка 60% стоимости корма, что снижает конкурентоспособность отечественной продукции. ${STATS_DISCLAIMER}`,
  },
];

// --- Чанкинг PDF -----------------------------------------------------------
// Целимся в чанки схожего порядка с исходными 58 (среднее ~480 симв.), но для
// длинных технических PDF (60-123 стр.) берём чуть крупнее окно (~900 симв.),
// чтобы не резать техническую инструкцию на бессвязные обрывки. 1 предложение
// overlap между соседними чанками — чтобы не терять контекст на границе.
const TARGET_LEN = 900;
const MIN_LEN = 250;
const OVERLAP_SENTENCES = 1;

function isGarbled(text) {
  const letters = (text.match(/[a-zA-Zа-яА-Я]/g) || []).length;
  return letters / text.length < 0.6;
}

function looksLikeTocOrJunk(text) {
  const dotRuns = (text.match(/\.{4,}/g) || []).length;
  return dotRuns > 2 || /^[\d\s.,]+$/.test(text);
}

function chunkPdfText(rawText) {
  const clean = rawText
    .replace(/\r/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const sentences = clean.match(/[^.!?]+[.!?]+(\s+|$)/g) || [clean];

  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    current.push(s);
    currentLen += s.length + 1;
    if (currentLen >= TARGET_LEN) {
      chunks.push(current.join(' '));
      current = current.slice(-OVERLAP_SENTENCES);
      currentLen = current.join(' ').length;
    }
  }
  if (current.length && currentLen >= MIN_LEN) chunks.push(current.join(' '));

  return chunks
    .map((c) => c.trim())
    .filter((c) => c.length >= MIN_LEN && !isGarbled(c) && !looksLikeTocOrJunk(c));
}

function shortHash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
}

// --- OpenAI эмбеддинги -----------------------------------------------------
// Колонка knowledge_chunks.embedding — vector(384) (подтверждено ошибкой Postgres
// при тестовой вставке: "expected 384 dimensions, not 1536"). text-embedding-3-small
// нативно отдаёт 1536, но поддерживает урезание через параметр dimensions — используем
// его, чтобы совпасть со схемой. ВАЖНО: тем же параметром нужно поправить и
// app/api/chat/route.ts, иначе поиск по-прежнему будет падать на несовпадении размерности.
const EMBEDDING_DIMENSIONS = 384;

async function getEmbeddings(texts) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts, dimensions: EMBEDDING_DIMENSIONS }),
  });
  const data = await r.json();
  if (!data.data) throw new Error(`OpenAI embeddings error: ${JSON.stringify(data).slice(0, 300)}`);
  return data.data.map((d) => d.embedding);
}

// --- Supabase insert (с фолбэком по схеме и по дедупликации) ---------------
let richSchemaSupported = true; // source_type/source_url/language/snapshot_date как колонки

async function insertBatch(rows) {
  // rows: [{ chunk_id, source, topic, content, embedding, meta: {...} }]
  const buildBody = (useRichSchema) =>
    rows.map((row) => {
      const base = {
        chunk_id: row.chunk_id,
        source: row.source,
        topic: row.topic,
        content: useRichSchema ? row.content : row.contentWithMetaFallback,
        embedding: row.embedding,
      };
      if (useRichSchema) Object.assign(base, row.meta);
      return base;
    });

  async function attempt(useRichSchema) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/knowledge_chunks?on_conflict=chunk_id`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          // return=representation (не minimal) — иначе нельзя отличить реально
          // вставленные строки от проигнорированных как дубли по on_conflict.
          Prefer: 'resolution=ignore-duplicates,return=representation',
        },
        body: JSON.stringify(buildBody(useRichSchema)),
      }
    );
    return res;
  }

  let res = await attempt(richSchemaSupported);
  let text = res.ok ? null : await res.text();

  if (!res.ok) {
    const schemaError = /column .* does not exist|PGRST204|unknown column/i.test(text);
    const noUniqueConstraint = /no unique or exclusion constraint/i.test(text);

    if (schemaError && richSchemaSupported) {
      console.log('   ⚠️  Колонок source_type/source_url/language/snapshot_date нет в схеме — переключаюсь на фолбэк (метаданные внутри текста чанка)');
      richSchemaSupported = false;
      res = await attempt(false);
      text = res.ok ? null : await res.text();
    } else if (noUniqueConstraint) {
      console.log('   ⚠️  Нет уникального индекса на chunk_id — вставляю по одному с проверкой "duplicate"');
      return insertOneByOne(rows);
    }
  }

  if (!res.ok) {
    console.log('   ⚠️  Batch insert не удался, пробую по одному:', (text || '').slice(0, 200));
    return insertOneByOne(rows);
  }

  const inserted = await res.json();
  const ok = inserted.length;
  const skip = rows.length - inserted.length;
  return { ok, skip, fail: 0 };
}

async function insertOneByOne(rows) {
  let ok = 0, skip = 0, fail = 0;
  for (const row of rows) {
    const body = {
      chunk_id: row.chunk_id,
      source: row.source,
      topic: row.topic,
      content: richSchemaSupported ? row.content : row.contentWithMetaFallback,
      embedding: row.embedding,
      ...(richSchemaSupported ? row.meta : {}),
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_chunks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) { ok++; continue; }
    const text = await res.text();
    if (/duplicate/i.test(text)) { skip++; continue; }
    fail++;
    console.log(`   ❌ ${row.chunk_id}: ${text.slice(0, 150)}`);
  }
  return { ok, skip, fail };
}

function buildMetaFallbackText(text, meta) {
  const metaLine = Object.entries(meta)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `[${metaLine}]\n${text}`;
}

// --- Основной пайплайн -------------------------------------------------

const EMBED_BATCH = 16;
const INSERT_BATCH = 16;

async function processRows(rows, label) {
  let totalOk = 0, totalSkip = 0, totalFail = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const embeddings = await getEmbeddings(batch.map((r) => `${r.topic}: ${r.content}`));
    batch.forEach((r, j) => (r.embedding = embeddings[j]));

    for (let k = 0; k < batch.length; k += INSERT_BATCH) {
      const sub = batch.slice(k, k + INSERT_BATCH);
      const { ok, skip, fail } = await insertBatch(sub);
      totalOk += ok; totalSkip += skip; totalFail += fail;
    }
    console.log(`   [${label}] embedded+inserted ${Math.min(i + EMBED_BATCH, rows.length)}/${rows.length}`);
  }
  return { totalOk, totalSkip, totalFail };
}

async function ingestFao() {
  console.log('\n📥 FAO PDF-руководства (приоритет 1)\n');
  const summary = [];

  for (const src of FAO_SOURCES) {
    console.log(`--- ${src.name} ---`);
    const res = await fetch(src.url);
    if (!res.ok) { console.log(`   ❌ Не удалось скачать: HTTP ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());

    let text;
    try {
      const parsed = await pdfParse(buf);
      text = parsed.text;
      console.log(`   Скачано, стр.: ${parsed.numpages}, извлечено символов: ${text.length}`);
    } catch (e) {
      console.log(`   ❌ Ошибка парсинга PDF: ${e.message}`);
      continue;
    }

    let chunkTexts = chunkPdfText(text);
    console.log(`   Чанков после фильтрации мусора/обложки: ${chunkTexts.length}`);
    const limit = parseInt(process.env.LIMIT_PER_SOURCE || '0', 10);
    if (limit > 0) chunkTexts = chunkTexts.slice(0, limit);

    const srcHash = shortHash(src.url);
    const meta = { source_type: 'fao_guide', source_url: src.url, language: 'en' };
    const rows = chunkTexts.map((content, idx) => ({
      chunk_id: `fao_${srcHash}_${idx}`,
      source: src.name,
      topic: src.name.split('—')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60),
      content,
      contentWithMetaFallback: buildMetaFallbackText(content, meta),
      meta,
    }));

    const { totalOk, totalSkip, totalFail } = await processRows(rows, src.name.slice(0, 20));
    console.log(`   ✅ добавлено: ${totalOk}, пропущено (дубли): ${totalSkip}, ошибок: ${totalFail}`);
    summary.push({ source: src.name, chunks: chunkTexts.length, added: totalOk, skipped: totalSkip, failed: totalFail });
  }

  return summary;
}

async function ingestStats() {
  console.log('\n📥 Снэпшот статистики Казахстана (приоритет 2)\n');
  const meta = { source_type: 'market_statistics', source_url: 'POULTRY_SOURCES.md#4', language: 'ru', snapshot_date: SNAPSHOT_DATE };
  const rows = KZ_STATS_CHUNKS.map((c) => ({
    chunk_id: `stats_kz_${SNAPSHOT_DATE}_${shortHash(c.topic)}`,
    source: `Рыночная статистика КЗ (снэпшот ${SNAPSHOT_DATE})`,
    topic: c.topic,
    content: c.text,
    contentWithMetaFallback: buildMetaFallbackText(c.text, meta),
    meta,
  }));
  const { totalOk, totalSkip, totalFail } = await processRows(rows, 'stats');
  console.log(`   ✅ добавлено: ${totalOk}, пропущено (дубли): ${totalSkip}, ошибок: ${totalFail}`);
  return { chunks: rows.length, added: totalOk, skipped: totalSkip, failed: totalFail };
}

async function main() {
  const faoSummary = await ingestFao();
  const statsSummary = await ingestStats();

  console.log('\n' + '='.repeat(60));
  console.log('ИТОГ');
  console.log('='.repeat(60));
  for (const s of faoSummary) {
    console.log(`${s.source}: ${s.chunks} чанков извлечено, ${s.added} добавлено, ${s.skipped} дублей, ${s.failed} ошибок`);
  }
  console.log(`Статистика КЗ: ${statsSummary.chunks} чанков, ${statsSummary.added} добавлено, ${statsSummary.skipped} дублей, ${statsSummary.failed} ошибок`);
  console.log(`Схема с отдельными колонками метаданных (source_type/source_url/language/snapshot_date): ${richSchemaSupported ? 'да' : 'нет — метаданные вписаны в content'}`);
}

main().catch((e) => {
  console.error('❌ Фатальная ошибка:', e);
  process.exit(1);
});
