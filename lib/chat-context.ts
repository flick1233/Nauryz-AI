export type ContextMessage = {
  role: 'user' | 'assistant';
  content: string;
  image?: unknown;
  frames?: unknown;
  transportError?: boolean;
  diagnosis?: { inspection?: string; symptoms?: string[]; causes?: { name?: string; severity?: string }[]; homeCare?: string[]; recommendations?: string[] };
  clarify?: { title?: string; intro?: string; groups?: { heading?: string; itemsText?: string }[]; causesPreview?: string[]; closing?: string };
};

export function messagesForRetry<T extends { transportError?: boolean }>(messages: T[], retry: boolean): T[] {
  return retry && messages[messages.length - 1]?.transportError ? messages.slice(0, -1) : messages;
}

export const MAX_CONTEXT_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 4_000;
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const compact = (value: string) => value.slice(0, MAX_MESSAGE_CHARS);

function cardText(message: ContextMessage): string {
  if (message.diagnosis) {
    const d = message.diagnosis;
    const causes = (d.causes ?? []).map(c => [clean(c.name), clean(c.severity)].filter(Boolean).join(' — ')).filter(Boolean);
    return ['Предварительная оценка по фото:', clean(d.inspection), d.symptoms?.length ? `Наблюдения: ${d.symptoms.map(clean).filter(Boolean).join('; ')}` : '', causes.length ? `Возможные направления: ${causes.join('; ')}` : '', d.homeCare?.length ? `Безопасные первичные действия: ${d.homeCare.map(clean).filter(Boolean).join('; ')}` : '', d.recommendations?.length ? `Когда нужен ветеринар: ${d.recommendations.map(clean).filter(Boolean).join('; ')}` : ''].filter(Boolean).join('\n');
  }
  if (message.clarify) {
    const c = message.clarify;
    const groups = (c.groups ?? []).map(g => `${clean(g.heading)}: ${clean(g.itemsText)}`).filter(Boolean);
    return ['Запрошенные уточнения:', clean(c.title), clean(c.intro), ...groups, c.causesPreview?.length ? `Возможные направления: ${c.causesPreview.map(clean).filter(Boolean).join('; ')}` : '', clean(c.closing)].filter(Boolean).join('\n');
  }
  return '';
}

/** Keeps recent context including structured cards; only the current message retains media. */
export function buildChatContext(messages: ContextMessage[]): ContextMessage[] {
  const recent = messages.slice(-MAX_CONTEXT_MESSAGES);
  const lastIndex = recent.length - 1;
  return recent.map((message, index) => ({
    role: message.role,
    content: compact([clean(message.content), cardText(message)].filter(Boolean).join('\n\n')),
    ...(index === lastIndex && message.image ? { image: message.image } : {}),
    ...(index === lastIndex && message.frames ? { frames: message.frames } : {}),
  }));
}
