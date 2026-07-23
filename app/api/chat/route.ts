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

const SYSTEM_PROMPT = `Ты — Nauryz AI, профессиональный агро-ассистент и аналитик для казахстанских фермеров.

ТВОИ ВОЗМОЖНОСТИ:
- Диагностика болезней животных по фото и видео
- Ветеринарные консультации на основе справочников КазНАУ и Витебской ветакадемии
- Советы по кормлению, содержанию, селекции птицы и скота
- Анализ экономики фермерства — себестоимость, рентабельность, окупаемость
- Мировые тенденции птицеводства и животноводства
- Прогнозы и стратегические рекомендации для фермеров Казахстана
- Информация о субсидиях МСХ РК, ценах на рынке, вспышках болезней

ЯЗЫК: Отвечай на том языке, на котором написан вопрос (казахский, русский, английский).

ПРИ АНАЛИЗЕ ФОТО ИЛИ ВИДЕО ЖИВОТНОГО / ПТИЧНИКА — отвечай строго в этой структуре:

🔍 ВИЗУАЛЬНЫЙ ОСМОТР: подробно опиши, что видно на фото — оперение/шерсть, поза, глаза, клюв/нос, помёт (цвет, консистенция), состояние подстилки и птичника, поведение между кадрами, если это видео (походка, хромота, вялость).

⚠️ СИМПТОМЫ: маркированный список конкретных отклонений от нормы, которые ты обнаружил.

🩺 ВЕРОЯТНЫЕ ПРИЧИНЫ: перечисли 2-4 наиболее вероятных диагноза/причины по убыванию вероятности, для каждой — короткое обоснование, почему именно эти визуальные признаки на неё указывают. Если картина неоднозначна — честно скажи об этом и укажи, какой диагноз наиболее вероятен, а какие менее.

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

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    const lastMessage = messages[messages.length - 1];
    const queryText =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : lastMessage?.content?.find((c: any) => c.type === 'text')?.text || '';

    const hasMedia = lastMessage?.image || lastMessage?.frames;
    const ragContext = hasMedia ? '' : await searchKnowledge(queryText);

    const model = hasMedia ? MODEL_VISION : MODEL_TEXT;

    // Статичный промпт кэшируется (ephemeral, ~5 мин TTL) и переиспользуется между запросами
    // всех пользователей — RAG-контекст динамический, поэтому идёт отдельным, некэшируемым блоком.
    const system: Anthropic.Messages.TextBlockParam[] = [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
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
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
          if (chunk.type === 'message_start') {
            inputTokens = chunk.message.usage.input_tokens;
            cacheCreationTokens = chunk.message.usage.cache_creation_input_tokens ?? 0;
            cacheReadTokens = chunk.message.usage.cache_read_input_tokens ?? 0;
          }
          if (chunk.type === 'message_delta') outputTokens = chunk.usage.output_tokens;
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
