export interface ClarifyResponse {
  title: string; intro: string; groups: { heading: string; itemsText: string }[];
  causesPreview: string[]; closing: string;
}

// Conservative opt-out: technical/format requests must retain their literal output.
// Inspect user messages only, never retrieved documents or model-generated examples.
export function preserveLiteralResponse(messages: { role: string; content: string }[]) {
  return messages.some(message => message.role === 'user'
    && /json|```|\bcode\b|\bschema\b|javascript|typescript|python|код|схем|формат/i.test(message.content));
}

export function parseClarifyJson(raw: string): ClarifyResponse {
  let json = raw.trim();
  // Only unwrap one complete JSON fence around the entire response.
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(json);
  if (fence) json = fence[1];
  const data = JSON.parse(json);
  const fields = ['type', 'title', 'intro', 'groups', 'causesPreview', 'closing'];
  const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).some(key => !fields.includes(key))
    || ('type' in data && data.type !== 'clarify')
    || !text(data.title) || typeof data.intro !== 'string' || typeof data.closing !== 'string'
    || !Array.isArray(data.groups) || !data.groups.length
    || !data.groups.every((g: any) => g && typeof g === 'object' && !Array.isArray(g)
      && Object.keys(g).length === 2 && text(g.heading) && text(g.itemsText))
    || !Array.isArray(data.causesPreview) || !data.causesPreview.every((v: unknown) => typeof v === 'string')) {
    throw new Error('unexpected clarify JSON shape');
  }
  // Missing discriminator is tolerated only for the complete, exact card schema.
  return { title: data.title, intro: data.intro, groups: data.groups,
    causesPreview: data.causesPreview, closing: data.closing };
}
