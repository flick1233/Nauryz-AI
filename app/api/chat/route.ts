import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

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

ПРИ АНАЛИЗЕ ФОТО ЖИВОТНОГО:
🔍 ВИЗУАЛЬНЫЙ ОСМОТР: что видишь
🩺 ДИАГНОЗ: название болезни/проблемы
⚠️ СИМПТОМЫ: перечисли
💊 ЛЕЧЕНИЕ: конкретные препараты и дозы
👨‍⚕️ НУЖЕН ВЕТЕРИНАР: да/нет
🔮 ПРОФИЛАКТИКА: как предотвратить

ПРИ АНАЛИЗЕ ВИДЕО:
🎬 ДВИЖЕНИЕ И ПОХОДКА: хромота, вялость, странные позы между кадрами
Затем та же структура что для фото.

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
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    });
    const data = await response.json();
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function searchKnowledge(query: string): Promise<string> {
  try {
    const embedding = await getEmbedding(query);
    if (!embedding) return '';
    const { data, error } = await supabase.rpc('match_chunks', {
      query_embedding: embedding,
      match_count: 4,
      match_threshold: 0.45,
    });
    if (error || !data || data.length === 0) return '';
    const context = data
      .map((chunk: any) => `[${chunk.source}]\n${chunk.content}`)
      .join('\n\n---\n\n');
    return `\n\nРЕЛЕВАНТНАЯ ИНФОРМАЦИЯ ИЗ БАЗЫ ЗНАНИЙ:\n${context}\n\nИспользуй эту информацию при ответе, если она применима.`;
  } catch {
    return '';
  }
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
    const ragContext = hasMedia ? '' : await searchKnowledge(queryText);
    const systemWithContext = ragContext ? SYSTEM_PROMPT + ragContext : SYSTEM_PROMPT;

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
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemWithContext,
      messages: anthropicMessages,
    });

    const INPUT_RATE = 1.0 / 1_000_000;
    const OUTPUT_RATE = 5.0 / 1_000_000;
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        let inputTokens = 0;
        let outputTokens = 0;
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
          if (chunk.type === 'message_start') inputTokens = chunk.message.usage.input_tokens;
          if (chunk.type === 'message_delta') outputTokens = chunk.usage.output_tokens;
        }
        const costUsd = inputTokens * INPUT_RATE + outputTokens * OUTPUT_RATE;
        controller.enqueue(encoder.encode(`\n___COST___${JSON.stringify({ inputTokens, outputTokens, costUsd })}`));
        controller.close();
      },
    });

    return new Response(readable, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (error: any) {
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Ошибка сервера' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
