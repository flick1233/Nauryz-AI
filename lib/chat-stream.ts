export const CONTROL_MARKERS = ['\n___DIAGNOSIS___', '\n___CLARIFY___', '\n___COST___', '\n___ERROR___'] as const;

export function firstControlMarker(text: string): number {
  const positions = CONTROL_MARKERS.map(marker => text.indexOf(marker)).filter(position => position >= 0);
  return positions.length ? Math.min(...positions) : -1;
}

export function visibleStreamText(text: string): string {
  const marker = firstControlMarker(text);
  return marker >= 0 ? text.slice(0, marker) : text;
}

export function hasCompleteStream(text: string): boolean {
  return text.includes('\n___COST___') && !text.includes('\n___ERROR___');
}

export function requireStreamBody(response: { ok: boolean; body: ReadableStream<Uint8Array> | null }): ReadableStream<Uint8Array> {
  if (!response.ok) throw new Error('Chat request failed');
  if (!response.body) throw new Error('Empty response body');
  return response.body;
}

/** Reads the browser response stream without interpreting provider content. */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onChunk: (text: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onChunk(text);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  }
  text += decoder.decode();
  return text;
}
