import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305' as any, name: 'web_search' }],
      messages: [
        {
          role: 'user',
          content: `Найди актуальную информацию по запросу: ${query}. Верни краткий структурированный ответ на русском языке.`,
        },
      ],
    });

    const textContent = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    return Response.json({ result: textContent });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
