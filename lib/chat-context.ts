// Shared request shaping: never resend historical photos or empty UI-only cards.
export const MAX_HISTORY_MESSAGES = 16;
export const MAX_HISTORY_CHARS = 24_000;
export const MAX_QUESTION_CHARS = 8_000;
export interface ChatMedia { data: string; mediaType: string }
export interface ChatMessage { role: 'user' | 'assistant'; content: string; image?: ChatMedia; frames?: ChatMedia[] }
export class ChatInputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function prepareMessages(input: unknown): { messages: ChatMessage[]; trimmed: boolean; removedMedia: boolean } {
  if (!Array.isArray(input) || !input.length || input.length > 120) throw new ChatInputError('Некорректная история чата');
  if (input.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) {
    throw new ChatInputError('Некорректный формат сообщения');
  }
  const last = input.at(-1);
  if (last.role !== 'user') throw new ChatInputError('Последнее сообщение должно быть вопросом');
  if (last.content.length > MAX_QUESTION_CHARS) throw new ChatInputError('Сократите вопрос до 8000 символов', 413);
  if (input.reduce((sum, m) => sum + m.content.length, 0) > 500_000) throw new ChatInputError('История слишком большая', 413);
  const frames = last.frames;
  if (frames !== undefined && (!Array.isArray(frames) || !frames.length || frames.length > 7)) throw new ChatInputError('Допустимо до 7 кадров');
  const media = frames || (last.image ? [last.image] : []);
  let bytes = 0;
  for (const item of media) {
    if (!item || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(item.mediaType)
      || typeof item.data !== 'string' || !item.data.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) throw new ChatInputError('Некорректное изображение');
    bytes += item.data.length;
    if (item.data.length > 7_000_000 || bytes > 12_000_000) throw new ChatInputError('Изображения слишком большие', 413);
  }
  if (!last.content.trim() && !media.length) throw new ChatInputError('Введите вопрос или прикрепите фото');
  const cleaned: ChatMessage[] = input.map((m, i) => ({
    role: m.role, content: m.content.trim() || (i < input.length - 1 && (m.image || m.frames) ? '[Ранее отправлено изображение]' : ''),
    ...(i === input.length - 1 && last.image ? { image: last.image } : {}),
    ...(i === input.length - 1 && last.frames ? { frames: last.frames } : {}),
  })).filter(m => m.content || m.image || m.frames);
  // Keep complete messages. Preserve the first question (often age/species/symptoms)
  // in addition to recent turns, rather than silently cutting a clinical sentence.
  const anchor = cleaned[0];
  const selected: ChatMessage[] = [];
  let chars = 0;
  const anchorBudget = cleaned.length > 1 ? Math.min(anchor.content.length, MAX_QUESTION_CHARS) : 0;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const m = cleaned[i];
    const reserve = i > 0 && anchor.content.length <= MAX_QUESTION_CHARS ? anchorBudget : 0;
    if (selected.length >= MAX_HISTORY_MESSAGES - 1 || chars + m.content.length + reserve > MAX_HISTORY_CHARS) break;
    selected.unshift(m); chars += m.content.length;
  }
  if (selected[0] !== anchor && anchor.content.length <= MAX_QUESTION_CHARS) selected.unshift(anchor);
  // A preceding assistant turn without its question is ambiguous; discard it.
  if (selected[0]?.role === 'assistant') selected.shift();
  return { messages: selected, trimmed: selected.length < cleaned.length,
    removedMedia: input.slice(0, -1).some(m => m.image || m.frames) };
}

export interface HistoryMessage extends ChatMessage {
  diagnosis?: unknown; clarify?: unknown; isCalcCard?: boolean; isError?: boolean;
}
export function historyForRequest(messages: HistoryMessage[]) {
  return messages.filter(m => !m.isError && !m.isCalcCard).map(m => ({
    role: m.role,
    content: m.diagnosis ? JSON.stringify(m.diagnosis) : m.clarify ? JSON.stringify({ type: 'clarify', ...m.clarify as object }) : m.content,
    image: m.image, frames: m.frames,
  }));
}
