import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const SYSTEM_PROMPT = `Ты — Nauryz AI, профессиональный агро-ассистент для казахстанских фермеров. 

ТВОИ ВОЗМОЖНОСТИ:
- Анализ фотографий животных (куры, коровы, лошади, овцы и т.д.) — ставишь диагнозы, предлагаешь лечение
- Консультации по болезням и лечению животных на основе ветеринарных справочников
- Советы по кормлению, уходу, содержанию птицы и скота
- Агрономические вопросы — растения, почва, посевы
- Информация о субсидиях МСХ РК, вспышках болезней

ЯЗЫК: Отвечай на том языке, на котором написан вопрос (казахский, русский, английский).

ПРИ АНАЛИЗЕ ФОТО ЖИВОТНОГО структурируй ответ:
🔍 ВИЗУАЛЬНЫЙ ОСМОТР
🩺 ВОЗМОЖНЫЙ ДИАГНОЗ
⚠️ СИМПТОМЫ
💊 ЛЕЧЕНИЕ
👨‍⚕️ НУЖЕН ВЕТЕРИНАР: да/нет
🔮 ПРОФИЛАКТИКА

Будь конкретным и практичным. Если в базе знаний есть релевантная информация — используй её.`;

// Детерминированный эмбеддинг (тот же алгоритм что при загрузке)
function textToEmbedding(text: string, dims = 384): number[] {
  const lower = text.toLowerCase();
  const words = lower.replace(/[,.:;-]/g, ' ').split(/\s+/).filter(w => w.length >= 2);

  const vec = new Array(dims).fill(0);

  for (const word of words) {
    // Простой хеш строки
    let h = 0;
    for (let i = 0; i < word.length; i++) {
      h = ((h << 5) - h + word.charCodeAt(i)) >>> 0;
    }
    const pos1 = h % dims;
    const pos2 = (h >>> 8) % dims;
    const pos3 = (h >>> 16) % dims;

    const count = words.filter(w => w === word).length;
    const weight = 1.0 / (1 + count);

    vec[pos1] += weight;
    vec[pos2] += weight * 0.5;
    vec[pos3] += weight * 0.25;
  }

  // L2 нормализация
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? vec.map(x => x / norm) : vec;
}

async function searchKnowledge(query: string): Promise<string> {
  try {
    const embedding = textToEmbedding(query);

    const { data, error } = await supabase.rpc('match_chunks', {
      query_embedding: embedding,
      match_count: 4,
      match_threshold: 0.3,
    });

    if (error || !data || data.length === 0) return '';

    const context = (data as any[])
      .map((c: any) => `[${c.source}]\n${c.content}`)
      .join('\n\n---\n\n');

    return `\n\nИНФОРМАЦИЯ ИЗ ВЕТЕРИНАРНЫХ СПРАВОЧНИКОВ:\n${context}\n\nИспользуй эти данные в ответе если они применимы.`;
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
        : Array.isArray(lastMessage?.content)
        ? lastMessage.content.find((c: any) => c.type === 'text')?.text || ''
        : '';

    const hasMedia = lastMessage?.image || lastMessage?.frames;
    const ragContext = hasMedia ? '' : await searchKnowledge(queryText);
    const systemWithContext = ragContext ? SYSTEM_PROMPT + ragContext : SYSTEM_PROMPT;

    const anthropicMessages = messages.map((msg: any) => {
      if (msg.role === 'user' && msg.frames?.length > 0) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: `Это ${msg.frames.length} кадров из видео по порядку. Проанализируй движение, походку, поведение животного.` },
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
            { type: 'text', text: msg.content || 'Проанализируй изображение' },
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
    return new Response(JSON.stringify({ error: error.message || 'Ошибка сервера' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
