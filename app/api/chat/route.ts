import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Ленивая инициализация: RAG по базе знаний — опциональная фича, её отсутствие
// не должно валить весь чат (в т.ч. фото-запросы, которые Supabase не используют).
let supabase: SupabaseClient | null = null;
function getSupabase() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  supabase = createClient(url, key);
  return supabase;
}

// Фото/видео требуют более сильной модели для точной диагностики; обычный текстовый чат остаётся на Haiku ради стоимости.
const MODEL_VISION = process.env.ANTHROPIC_MODEL_VISION || 'claude-sonnet-5';
const MODEL_TEXT = process.env.ANTHROPIC_MODEL_TEXT || 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT_BASE = `Ты — Nauryz AI, профессиональный агро-ассистент и аналитик для казахстанских фермеров.

ТВОИ ВОЗМОЖНОСТИ:
- Диагностика болезней животных по фото и видео
- Ветеринарные консультации на основе справочников КазНАУ и Витебской ветакадемии
- Советы по кормлению, содержанию, селекции птицы и скота
- Анализ экономики фермерства — себестоимость, рентабельность, окупаемость
- Мировые тенденции птицеводства и животноводства
- Прогнозы и стратегические рекомендации для фермеров Казахстана
- Информация о субсидиях МСХ РК, ценах на рынке, вспышках болезней

ЯЗЫК: Отвечай на том языке, на котором написан вопрос (казахский, русский, английский).`;

// Общие для текстового и vision-режима правила — найдены на тестовом наборе
// из 18 случаев (TEST_CASES_DIAGNOSIS.md), подняли точность с 12 до 15 EXACT/18.
const DIFFERENTIAL_DIAGNOSIS_RULES = `ДИФФЕРЕНЦИАЛЬНАЯ ДИАГНОСТИКА — типичные ошибки, которых нужно избегать:
- Респираторные симптомы (хрипы, чихание, выделения из носа) НЕ равно автоматически ИЛТ (инфекционный ларинготрахеит). Сверяйся с более специфичными маркерами: запах выделений + отёк морды/периорбитальный отёк → инфекционный коризм; тонкая/деформированная/мягкая скорлупа на фоне респираторки → инфекционный бронхит. ИЛТ ставь основным только при явном кашле с кровью/сгустками, свистящем дыхании с запрокидыванием головы и высокой смертностью за короткий срок — иначе коризм/бронхит приоритетнее.
- Диарея у молодняка НЕ равно автоматически кокцидиоз или "пастинг" (слипшийся пух вокруг клоаки — это симптом, а не сам диагноз). Сначала явно определи точный возраст: 1-2 недели жизни + белый липкий понос со слипшимся пухом у клоаки → пуллороз (это бактериальная инфекция, не просто механическая закупорка); 3-6 недель + белая водянистая диарея, взъерошенность, дрожь, иммуносупрессия → болезнь Гамборо; кровянистый или водянистый понос в более широком возрастном диапазоне → кокцидиоз. Не останавливайся на первом частом диагнозе — проверь, не укладывается ли возраст в узкий диапазон, характерный для более редкой, но точно определяемой болезни.`;

// TASK_DESIGN_IMPLEMENTATION.md, п.4: "Курица хромает" → сначала уточняющие вопросы про
// возраст/ногу/позу/условия, а не мгновенный диагноз — это реальное поведение бэкенда,
// не заскриптованное в дизайне. Модель сама решает, хватает ли деталей; если нет — отвечает
// JSON вместо обычной markdown-структуры (см. buildClarifyMsg в прототипе за форму данных).
const CLARIFY_JSON_INSTRUCTIONS = `ЕСЛИ ВОПРОС КАСАЕТСЯ ЗДОРОВЬЯ ЖИВОТНОГО, но в описании не хватает ключевых деталей для уверенного диагноза (возраст животного, какая именно нога/часть тела/симптом, как давно началось, условия содержания) — НЕ угадывай диагноз. Вместо обычного текстового ответа верни ТОЛЬКО валидный JSON (без markdown, без \`\`\`, без текста до/после) в такой структуре:
{
  "type": "clarify",
  "title": "короткий заголовок проблемы, напр. 'Хромота у курицы — срочная диагностика'",
  "intro": "1-2 предложения: почему важны детали, что нужно уточнить или прислать фото/видео",
  "groups": [{"heading": "напр. Возраст птицы", "itemsText": "конкретные варианты/вопросы одной строкой"}],
  "causesPreview": ["Диагноз 1 — краткий узнаваемый признак", "Диагноз 2 — краткий признак"],
  "closing": "призыв прислать фото/видео или ответить текстом на вопросы выше"
}
Дай 3-5 groups (возраст, локализация симптома, поза/поведение, другие признаки, условия содержания — адаптируй под тему) и 3-5 causesPreview (вероятные направления по убыванию вероятности).
Если деталей УЖЕ достаточно (или тема не про здоровье животного, например экономика/тренды/субсидии) — НЕ используй JSON, отвечай обычным текстом в структуре ниже.`;

const TEXT_FORMAT_INSTRUCTIONS = `${CLARIFY_JSON_INSTRUCTIONS}

ПРИ АНАЛИЗЕ ОПИСАНИЯ СИМПТОМОВ ЖИВОТНОГО (когда деталей достаточно) — отвечай строго в этой структуре:

🔍 ОСМОТР: подробно перескажи и уточни, что описал фермер.

⚠️ СИМПТОМЫ: маркированный список конкретных отклонений от нормы.

🩺 ВЕРОЯТНЫЕ ПРИЧИНЫ: перечисли 2-4 наиболее вероятных диагноза/причины по убыванию вероятности, для каждой — короткое обоснование. Если картина неоднозначна — честно скажи об этом.

${DIFFERENTIAL_DIAGNOSIS_RULES}

💊 РЕКОМЕНДАЦИИ: конкретные препараты, дозировки, сроки лечения и изоляции; изменения в кормлении/содержании; меры по дезинфекции птичника.

👨‍⚕️ КОГДА ОБРАЩАТЬСЯ К ВЕТЕРИНАРУ: да/нет и почему — укажи тревожные признаки (например, массовый падёж, кровь, судороги), при которых промедление опасно и нужен очный осмотр специалиста немедленно.

🔮 ПРОФИЛАКТИКА: как предотвратить повторение в стаде.

ПРИ ЭКОНОМИЧЕСКИХ ВОПРОСАХ (себестоимость, рентабельность, бизнес-план):
📊 ТЕКУЩАЯ СИТУАЦИЯ: анализ данных
💰 РАСЧЁТЫ: конкретные цифры в тенге
📈 ПРОГНОЗ: что будет через 6-12 месяцев на основе трендов
✅ РЕКОМЕНДАЦИИ: конкретные шаги для фермера

ПРИ ВОПРОСАХ О ТЕНДЕНЦИЯХ И БУДУЩЕМ:
🌍 МИРОВОЙ ТРЕНД: что происходит в мире
🇰🇿 КАЗАХСТАН: как это касается местных фермеров
📅 ПРОГНОЗ НА 1-3 ГОДА: обоснованное предположение
💡 ЧТО ДЕЛАТЬ СЕЙЧАС: практический совет

ВАЖНО: Всегда давай конкретные цифры, дозы, сроки. Избегай общих фраз. Если не знаешь точно — скажи и предложи обратиться к специалисту.`;

// Vision-ответы рендерятся как структурированная карточка диагноза в интерфейсе
// (design_handoff_nauryz_ai/README.md, раздел 4b) — нужен строгий JSON, не markdown.
const VISION_JSON_INSTRUCTIONS = `ФОРМАТ ОТВЕТА — только валидный JSON, без markdown-обрамления (без \`\`\`), без текста до или после. Ровно такая структура:
{
  "inspection": "подробное описание того, что видно на фото/видео — оперение, поза, глаза, клюв, помёт, подстилка, поведение между кадрами (если видео)",
  "symptoms": ["конкретный симптом 1", "конкретный симптом 2"],
  "causes": [{"name": "название диагноза", "pct": 42, "severity": "high"}],
  "homeCare": ["конкретное действие фермера дома, с дозировкой/сроком"],
  "recommendations": ["критерий обращения к ветеринару"],
  "needsVet": true
}

Правила:
- causes: 2-4 диагноза по убыванию pct (проценты — условная вероятность, не обязаны давать в сумме 100). severity: "low"|"medium"|"high"|"critical" — critical только для особо опасных контагиозных болезней (например, Ньюкаслская болезнь, птичий грипп).
- homeCare — то, что фермер может сделать САМ без ветеринара: конкретные препараты, дозы, изоляция, дезинфекция.
- recommendations — КОГДА и ПОЧЕМУ обязательно нужен очный осмотр ветеринара (тревожные признаки: массовый падёж, кровь, судороги и т.п.), а не общие советы.
- needsVet — true, если хотя бы один вероятный диагноз требует очного ветеринарного вмешательства.
- Если на фото не видно животного/птичника или изображение слишком нечёткое для диагностики — верни causes: [] и опиши проблему в inspection, чтобы интерфейс показал "не удалось определить" вместо выдуманного диагноза.

${DIFFERENTIAL_DIAGNOSIS_RULES}`;

// Колонка knowledge_chunks.embedding — vector(384) (см. scripts/ingest-sources.cjs).
// text-embedding-3-small нативно отдаёт 1536 — без dimensions:384 запрос к match_chunks
// падает с "expected 384 dimensions, not 1536" и поиск молча возвращает пусто.
const EMBEDDING_DIMENSIONS = 384;

async function getEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text, dimensions: EMBEDDING_DIMENSIONS }),
    });
    const data = await response.json();
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function searchKnowledge(query: string): Promise<string> {
  try {
    const db = getSupabase();
    if (!db) return '';
    const embedding = await getEmbedding(query);
    if (!embedding) return '';
    // 0.35 откалиброван вручную на реальных cosine-similarity исходной базы +
    // FAO-контента после перехода на text-embedding-3-small(dimensions:384) —
    // на 0.45 отсекались релевантные результаты (напр. болезнь Марека для
    // запроса "курица хромает" давала ~0.35).
    const { data, error } = await db.rpc('match_chunks', {
      query_embedding: embedding,
      match_count: 4,
      match_threshold: 0.35,
    });
    if (error || !data || data.length === 0) return '';
    console.log(`[rag] "${query.slice(0, 60)}" -> ${data.map((c: any) => `${c.chunk_id}(${c.similarity?.toFixed(2)})`).join(', ')}`);
    const context = data
      .map((chunk: any) => `[${chunk.source}]\n${chunk.content}`)
      .join('\n\n---\n\n');
    return `\n\nРЕЛЕВАНТНАЯ ИНФОРМАЦИЯ ИЗ БАЗЫ ЗНАНИЙ:\n${context}\n\nИспользуй эту информацию при ответе, если она применима.`;
  } catch {
    return '';
  }
}

// Ориентировочные цены за токен, $/токен (input / output / запись в кэш / чтение из кэша).
const MODEL_RATES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-sonnet-5': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000, cacheWrite: 3.75 / 1_000_000, cacheRead: 0.3 / 1_000_000 },
  'claude-haiku-4-5-20251001': { input: 1.0 / 1_000_000, output: 5.0 / 1_000_000, cacheWrite: 1.25 / 1_000_000, cacheRead: 0.1 / 1_000_000 },
};

const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

// Валидирует и нормализует JSON, который вернула модель для vision-ответа, в форму
// карточки диагноза (design_handoff_nauryz_ai README, buildDiagnosis). Бросает при
// некорректной форме — вызывающий код в этом случае откатывается к обычному тексту.
function parseDiagnosisJson(raw: string): {
  inspection: string; symptoms: string[];
  causes: { name: string; pct: number; severity: string }[];
  homeCare: string[]; recommendations: string[]; needsVet: boolean;
} {
  const cleaned = raw.trim().replace(/^```(json)?\s*/i, '').replace(/```\s*$/i, '');
  const data = JSON.parse(cleaned);
  if (typeof data.inspection !== 'string' || !Array.isArray(data.symptoms) || !Array.isArray(data.causes)) {
    throw new Error('unexpected diagnosis JSON shape');
  }
  const causes = data.causes
    .map((c: any) => ({
      name: String(c?.name ?? '').trim(),
      pct: Math.max(0, Math.min(100, Number(c?.pct) || 0)),
      severity: SEVERITIES.has(c?.severity) ? c.severity : 'medium',
    }))
    .filter((c: any) => c.name)
    .sort((a: any, b: any) => b.pct - a.pct);
  return {
    inspection: data.inspection,
    symptoms: Array.isArray(data.symptoms) ? data.symptoms.filter((s: any) => typeof s === 'string') : [],
    causes,
    homeCare: Array.isArray(data.homeCare) ? data.homeCare.filter((s: any) => typeof s === 'string') : [],
    recommendations: Array.isArray(data.recommendations) ? data.recommendations.filter((s: any) => typeof s === 'string') : [],
    needsVet: data.needsVet !== false,
  };
}

// Уточняющие вопросы (текстовый чат) — модель сама решает выдавать ли это вместо
// обычной markdown-структуры, см. CLARIFY_JSON_INSTRUCTIONS.
function parseClarifyJson(raw: string): {
  title: string; intro: string; groups: { heading: string; itemsText: string }[];
  causesPreview: string[]; closing: string;
} {
  const cleaned = raw.trim().replace(/^```(json)?\s*/i, '').replace(/```\s*$/i, '');
  const data = JSON.parse(cleaned);
  if (data.type !== 'clarify' || typeof data.title !== 'string' || !Array.isArray(data.groups)) {
    throw new Error('unexpected clarify JSON shape');
  }
  return {
    title: data.title,
    intro: typeof data.intro === 'string' ? data.intro : '',
    groups: data.groups
      .map((g: any) => ({ heading: String(g?.heading ?? '').trim(), itemsText: String(g?.itemsText ?? '').trim() }))
      .filter((g: any) => g.heading && g.itemsText),
    causesPreview: Array.isArray(data.causesPreview) ? data.causesPreview.filter((s: any) => typeof s === 'string') : [],
    closing: typeof data.closing === 'string' ? data.closing : '',
  };
}

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    const lastMessage = messages[messages.length - 1];
    const queryText =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : lastMessage?.content?.find((c: any) => c.type === 'text')?.text || '';

    const hasMedia = lastMessage?.image || lastMessage?.frames;
    // RAG работает и для фото/видео, если фермер приложил текст к снимку
    // (README раздел 4, пункт 2b) — иначе для чистого фото без текста запрос пустой, RAG пропускаем.
    const ragContext = queryText ? await searchKnowledge(queryText) : '';

    const model = hasMedia ? MODEL_VISION : MODEL_TEXT;
    const systemPromptText = SYSTEM_PROMPT_BASE + '\n\n' + (hasMedia ? VISION_JSON_INSTRUCTIONS : TEXT_FORMAT_INSTRUCTIONS);

    // Статичный промпт кэшируется (ephemeral, ~5 мин TTL) и переиспользуется между запросами
    // всех пользователей — RAG-контекст динамический, поэтому идёт отдельным, некэшируемым блоком.
    const system: Anthropic.Messages.TextBlockParam[] = [
      { type: 'text', text: systemPromptText, cache_control: { type: 'ephemeral' } },
      ...(ragContext ? [{ type: 'text' as const, text: ragContext }] : []),
    ];

    const anthropicMessages = messages.map((msg: any) => {
      if (msg.role === 'user' && msg.frames && msg.frames.length > 0) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: `Это ${msg.frames.length} кадров из видео, идущих по порядку во времени. Проанализируй последовательность кадров как видео — обрати внимание на движение, походку, поведение животного между кадрами.` },
            ...msg.frames.map((f: any) => ({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } })),
            { type: 'text', text: msg.content || 'Проанализируй это видео' },
          ],
        };
      }
      if (msg.role === 'user' && msg.image) {
        return {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: msg.image.mediaType, data: msg.image.data } },
            { type: 'text', text: msg.content || 'Проанализируй это изображение' },
          ],
        };
      }
      return { role: msg.role, content: msg.content };
    });

    const stream = await client.messages.stream({
      model,
      max_tokens: hasMedia ? 3072 : 2048,
      system,
      messages: anthropicMessages,
    });

    const rates = MODEL_RATES[model] ?? MODEL_RATES['claude-haiku-4-5-20251001'];
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheCreationTokens = 0;
        let cacheReadTokens = 0;
        // Vision-ответы — строгий JSON для карточки диагноза: не стримим по токену
        // (частичный JSON бесполезен интерфейсу), копим целиком и парсим после.
        // Текст обычно стримится как есть, НО модель может вместо этого решить выдать
        // JSON с уточняющими вопросами (CLARIFY_JSON_INSTRUCTIONS) — поэтому придерживаем
        // самые первые символы, чтобы понять формат, и либо сразу отпускаем накопленное
        // в обычный поток, либо молча копим до конца для парсинга как JSON.
        let buffered = '';
        let jsonModeDecided = false;
        let isJsonMode = false;
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            const text = chunk.delta.text;
            if (hasMedia) {
              buffered += text;
            } else if (!jsonModeDecided) {
              buffered += text;
              const trimmed = buffered.trimStart();
              // Ждём достаточно символов, чтобы отличить {"..." от ```json\n{"... — модель
              // иногда оборачивает JSON в code fence вопреки явной инструкции не делать этого
              // (найдено на "Курица хромает" — весь clarify-ответ приходил как ```json\n{...).
              if (trimmed.length >= 15) {
                jsonModeDecided = true;
                isJsonMode = trimmed.replace(/^```(json)?\s*/i, '').startsWith('{');
                if (!isJsonMode) controller.enqueue(encoder.encode(buffered));
              }
            } else if (isJsonMode) {
              buffered += text;
            } else {
              controller.enqueue(encoder.encode(text));
            }
          }
          if (chunk.type === 'message_start') {
            inputTokens = chunk.message.usage.input_tokens;
            cacheCreationTokens = chunk.message.usage.cache_creation_input_tokens ?? 0;
            cacheReadTokens = chunk.message.usage.cache_read_input_tokens ?? 0;
          }
          if (chunk.type === 'message_delta') outputTokens = chunk.usage.output_tokens;
        }
        if (hasMedia) {
          try {
            const diagnosis = parseDiagnosisJson(buffered);
            controller.enqueue(encoder.encode(`\n___DIAGNOSIS___${JSON.stringify(diagnosis)}`));
          } catch (e) {
            console.error('[chat] vision JSON parse failed, falling back to raw text:', (e as Error).message, buffered.slice(0, 300));
            controller.enqueue(encoder.encode(buffered));
          }
        } else if (isJsonMode) {
          try {
            const clarify = parseClarifyJson(buffered);
            controller.enqueue(encoder.encode(`\n___CLARIFY___${JSON.stringify(clarify)}`));
          } catch (e) {
            console.error('[chat] clarify JSON parse failed, falling back to raw text:', (e as Error).message, buffered.slice(0, 300));
            controller.enqueue(encoder.encode(buffered));
          }
        } else if (!jsonModeDecided && buffered) {
          // Стрим закончился, а решение о формате так и не приняли (буфер был весь
          // из пробелов) — на всякий случай отдать накопленное, а не потерять его.
          controller.enqueue(encoder.encode(buffered));
        }
        const costUsd =
          inputTokens * rates.input +
          outputTokens * rates.output +
          cacheCreationTokens * rates.cacheWrite +
          cacheReadTokens * rates.cacheRead;
        console.log(
          `[chat] model=${model} input=${inputTokens} output=${outputTokens} cache_write=${cacheCreationTokens} cache_read=${cacheReadTokens} cost=$${costUsd.toFixed(5)}`
        );
        controller.enqueue(encoder.encode(`\n___COST___${JSON.stringify({ inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, costUsd })}`));
        controller.close();
      },
    });

    return new Response(readable, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (error: any) {
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Ошибка сервера' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
