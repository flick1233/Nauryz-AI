import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();

    // Используем fetch напрямую чтобы обойти TypeScript ошибки с web_search tool
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [
          {
            role: 'user',
            content: `Найди актуальную информацию по запросу: ${query}. Верни краткий структурированный ответ на русском языке.`,
          },
        ],
      }),
    });

    const data = await response.json();
    const textContent = (data.content || [])
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    return Response.json({ result: textContent });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
