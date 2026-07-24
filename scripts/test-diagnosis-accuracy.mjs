// Прогоняет все текстовые случаи из TEST_CASES_DIAGNOSIS.md через локальный /api/chat
// и сверяет ответ модели с "Ожидаемым диагнозом" через LLM-судью (здравый смысл,
// а не точное строковое совпадение — синонимы/уточнения в скобках/латынь считаются
// совпадением).
//
// Запуск: node scripts/test-diagnosis-accuracy.mjs
// Требует: локальный dev-сервер на CHAT_URL (по умолчанию http://localhost:3000/api/chat)
//          и ANTHROPIC_API_KEY в .env.local (для судьи и для самого чата).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvFile(path.join(ROOT, '.env.local'));

const CHAT_URL = process.env.CHAT_URL || 'http://localhost:3000/api/chat';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const JUDGE_MODEL = 'claude-haiku-4-5-20251001';

if (!ANTHROPIC_API_KEY) {
  console.error('❌ Нужен ANTHROPIC_API_KEY в .env.local (для судьи)');
  process.exit(1);
}

// --- Парсинг TEST_CASES_DIAGNOSIS.md -----------------------------------
function parseCases(md) {
  const cases = [];
  const blocks = md.split(/\n\*\*(\d+)\.\s*([^*]+)\*\*\n/).slice(1);
  for (let i = 0; i < blocks.length; i += 3) {
    const num = blocks[i];
    const title = blocks[i + 1].trim();
    const body = blocks[i + 2];
    const symptoms = body.match(/Симптомы:\s*(.+)/)?.[1]?.trim();
    const expected = body.match(/Ожидаемый диагноз:\s*(.+)/)?.[1]?.trim();
    const markers = body.match(/Ключевые маркеры:\s*(.+)/)?.[1]?.trim();
    if (symptoms && expected) cases.push({ num: Number(num), title, symptoms, expected, markers });
  }
  return cases;
}

// --- Запрос к /api/chat --------------------------------------------------
async function askChat(symptoms) {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: symptoms }] }),
  });
  if (!res.ok) throw new Error(`/api/chat HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text.split('\n___COST___')[0].trim();
}

// --- Судья (Claude Haiku) -------------------------------------------------
const JUDGE_SYSTEM = `Ты — судья точности ветеринарной диагностики птицы. Тебе дают описание симптомов, эталонный диагноз и фактический ответ модели-диагноста.

Определи вердикт:
- EXACT — эталонный диагноз назван как основной/наиболее вероятный диагноз в ответе. Синонимы, перефразировки, латинские названия, уточнения в скобках (например "кокцидиоз" и "кокцидиоз (Eimeria)") — это EXACT, не придирайся к формулировке.
- PARTIAL — эталонный диагноз упомянут в ответе (например, в списке дифференциальных/возможных причин), но НЕ как основной/наиболее вероятный вариант.
- MISS — эталонный диагноз в ответе не упомянут вообще, либо упомянут только в контексте исключения ("это не X").

Отвечай СТРОГО валидным JSON без markdown-обрамления: {"verdict": "EXACT" | "PARTIAL" | "MISS", "reasoning": "краткое обоснование в одно предложение"}`;

async function judge(symptoms, expected, actual) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 300,
      system: JUDGE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `СИМПТОМЫ:\n${symptoms}\n\nЭТАЛОННЫЙ ДИАГНОЗ:\n${expected}\n\nОТВЕТ МОДЕЛИ-ДИАГНОСТА:\n${actual}`,
        },
      ],
    }),
  });
  const data = await res.json();
  const text = data.content?.[0]?.text ?? '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { verdict: 'MISS', reasoning: `не удалось распарсить ответ судьи: ${text.slice(0, 150)}` };
  }
}

// --- Основной прогон -------------------------------------------------------
async function main() {
  const md = fs.readFileSync(path.join(ROOT, 'TEST_CASES_DIAGNOSIS.md'), 'utf8');
  const cases = parseCases(md);
  console.log(`Найдено ${cases.length} тестовых случаев\n`);

  const results = [];
  for (const c of cases) {
    process.stdout.write(`[${c.num}/${cases.length}] ${c.title}... `);
    try {
      const actual = await askChat(c.symptoms);
      const verdict = await judge(c.symptoms, c.expected, actual);
      results.push({ ...c, actual, ...verdict });
      console.log(verdict.verdict);
    } catch (e) {
      results.push({ ...c, actual: '', verdict: 'ERROR', reasoning: e.message });
      console.log('ERROR:', e.message);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log('\n' + '='.repeat(70));
  console.log('ДЕТАЛИ');
  console.log('='.repeat(70));
  for (const r of results) {
    console.log(`\n[${r.num}] ${r.title} — ${r.verdict}`);
    console.log(`  Ожидалось: ${r.expected}`);
    console.log(`  Обоснование судьи: ${r.reasoning}`);
    console.log(`  Ответ модели (начало): ${r.actual.replace(/\n/g, ' ').slice(0, 180)}...`);
  }

  const counts = { EXACT: 0, PARTIAL: 0, MISS: 0, ERROR: 0 };
  for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  console.log(`Точное совпадение (EXACT):    ${counts.EXACT}/${cases.length}`);
  console.log(`Частичное (PARTIAL, в дифф.): ${counts.PARTIAL}/${cases.length}`);
  console.log(`Мимо (MISS):                  ${counts.MISS}/${cases.length}`);
  if (counts.ERROR) console.log(`Ошибок запроса (ERROR):       ${counts.ERROR}/${cases.length}`);
  console.log(`\nТочность (EXACT только): ${((counts.EXACT / cases.length) * 100).toFixed(0)}%`);
  console.log(`Точность (EXACT + PARTIAL): ${(((counts.EXACT + counts.PARTIAL) / cases.length) * 100).toFixed(0)}%`);

  fs.writeFileSync(path.join(ROOT, 'diagnosis-test-results.json'), JSON.stringify(results, null, 2));
  console.log('\nПолные результаты: diagnosis-test-results.json');
}

main().catch((e) => {
  console.error('Фатальная ошибка:', e);
  process.exit(1);
});
