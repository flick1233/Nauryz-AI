import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Ты — Nauryz AI, профессиональный агро-ассистент для казахстанских фермеров. 

ТВОИ ВОЗМОЖНОСТИ:
- Анализ фотографий животных (куры, коровы, лошади, овцы и т.д.) — ставишь диагнозы, предлагаешь лечение
- Консультации по болезням и лечению животных
- Советы по кормлению, уходу, содержанию
- Агрономические вопросы — растения, почва, посевы
- Актуальная информация о ценах, субсидиях МСХ РК, вспышках болезней

ЯЗЫК: Отвечай на том языке, на котором написан вопрос (казахский, русский, английский).

ПРИ АНАЛИЗЕ ФОТО ЖИВОТНОГО — всегда структурируй ответ так:
🔍 ВИЗУАЛЬНЫЙ ОСМОТР: что ты видишь на фото
🩺 ВОЗМОЖНЫЙ ДИАГНОЗ: название болезни/проблемы  
⚠️ СИМПТОМЫ: перечисли симптомы
💊 ЛЕЧЕНИЕ: конкретные рекомендации
👨‍⚕️ НУЖЕН ВЕТЕРИНАР: да/нет и почему
🔮 ПРОФИЛАКТИКА: как предотвратить в будущем

Будь конкретным, практичным и понятным для обычного фермера. Не используй сложные медицинские термины без объяснения.`;

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    // Convert messages to Anthropic format
    const anthropicMessages = messages.map((msg: any) => {
      if (msg.role === 'user' && msg.image) {
        return {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: msg.image.mediaType,
                data: msg.image.data,
              },
            },
            { type: 'text', text: msg.content || 'Проанализируй это изображение' },
          ],
        };
      }
      return { role: msg.role, content: msg.content };
    });

    const stream = await client.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: anthropicMessages,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error: any) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Ошибка сервера' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
