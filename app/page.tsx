'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Menu, Plus, Camera, Mic, Send, X, Square, Globe, Calculator } from 'lucide-react';
import './nauryz.css';

interface ImageData { data: string; mediaType: string; preview: string }
type Severity = 'low' | 'medium' | 'high' | 'critical';
interface Cause { name: string; pct: number; severity: Severity }
interface DiagnosisData {
  inspection: string; symptoms: string[]; causes: Cause[];
  homeCare: string[]; recommendations: string[]; needsVet: boolean;
}
interface Message {
  id: string; role: 'user' | 'assistant'; content: string;
  image?: ImageData; frames?: ImageData[]; videoPreview?: string;
  diagnosis?: DiagnosisData;
  costUsd?: number; timestamp: Date;
}
interface Chat { id: string; title: string; messages: Message[]; createdAt: Date; }

// design_handoff_nauryz_ai/README.md — Severity colors (diagnosis causes)
const SEVERITY_STYLE: Record<Severity, { bar: string; text: string; bg: string }> = {
  high: { bar: 'var(--color-accent-500)', text: 'var(--color-accent-800)', bg: 'var(--color-accent-100)' },
  critical: { bar: 'var(--color-accent-700)', text: 'var(--color-accent-900)', bg: 'var(--color-accent-200)' },
  medium: { bar: 'var(--color-accent-2-500)', text: 'var(--color-accent-2-800)', bg: 'var(--color-accent-2-100)' },
  low: { bar: 'var(--color-neutral-400)', text: 'var(--color-neutral-700)', bg: 'var(--color-neutral-100)' },
};

const SUGGESTIONS = [
  { emoji: '🐔', text: 'Курица хромает, что делать?' },
  { emoji: '🥚', text: 'Куры перестали нести яйца' },
  { emoji: '💊', text: 'Норма корма для бройлеров' },
  { emoji: '🌿', text: 'Признаки авитаминоза у кур' },
  { emoji: '🦠', text: 'Болезнь Ньюкасла — симптомы' },
  { emoji: '📋', text: 'Субсидии МСХ РК 2026' },
  { emoji: '🌾', text: 'Бизнес-план птицефабрики' },
  { emoji: '🔬', text: 'Селекция бройлеров — кроссы' },
];

const FEED_ANIMALS = [
  { label: 'Бройлер 🐔', perHead: 120 },
  { label: 'Несушка 🥚', perHead: 110 },
  { label: 'Индейка 🦃', perHead: 300 },
  { label: 'Утка 🦆', perHead: 200 },
  { label: 'Гусь 🪿', perHead: 400 },
];

// Логотип-росток из design-handoff (Nauryz AI - Web.dc.html) — воспроизведён как есть, не заменён на Lucide.
function Logo({ size = 20, strokeWidth = 2.5 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34">
      <path d="M17 30 C17 22 17 16 17 8" stroke="var(--color-accent-700)" strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      <path d="M17 14 C10 14 6 9 7 3 C13 3 18 7 17 14Z" fill="var(--color-accent-2-500)" />
      <path d="M17 18 C24 18 28 13 27 6 C21 6 16 11 17 18Z" fill="var(--color-accent-500)" />
    </svg>
  );
}

function DiagnosisCard({ diagnosis, onOpen }: { diagnosis: DiagnosisData; onOpen: () => void }) {
  const topCauses = diagnosis.causes.slice(0, 2);
  return (
    <div className="diag-card">
      <span className="tag tag-accent">Осмотр</span>
      <div className="diag-text">{diagnosis.inspection}</div>
      <span className="tag tag-accent-2">Симптомы</span>
      <ul className="diag-symptoms">{diagnosis.symptoms.map((s, i) => <li key={i}>{s}</li>)}</ul>
      {topCauses.length > 0 && (
        <>
          <span className="tag tag-neutral">Вероятные причины</span>
          <div className="diag-causes">
            {topCauses.map((c, i) => (
              <div key={i}>
                <div className="diag-cause-row"><span>{c.name}</span><span className="diag-cause-pct">{c.pct}%</span></div>
                <div className="diag-bar-track"><div className="diag-bar-fill" style={{ width: `${c.pct}%`, background: SEVERITY_STYLE[c.severity].bar }} /></div>
              </div>
            ))}
          </div>
        </>
      )}
      <button className="pill-btn" style={{ marginTop: 2, alignSelf: 'flex-start' }} onClick={onOpen}>Подробный разбор →</button>
    </div>
  );
}

function DiagnosisModal({ diagnosis, onClose }: { diagnosis: DiagnosisData; onClose: () => void }) {
  return (
    <div className="dlg-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dlg-sheet">
        <div className="dlg-header">
          <span>Результат диагностики</span>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={14} strokeWidth={2.75} /></button>
        </div>
        <div className="dlg-body">
          <div className="dlg-inspection">
            <span className="tag tag-accent">Осмотр</span>
            <div className="dlg-inspection-text">{diagnosis.inspection}</div>
          </div>

          <div>
            <h4 className="dlg-h4">Симптомы</h4>
            <div className="dlg-symptom-chips">{diagnosis.symptoms.map((s, i) => <span key={i} className="tag tag-neutral">{s}</span>)}</div>
          </div>

          {diagnosis.causes.length > 0 && (
            <div>
              <h4 className="dlg-h4">Возможные причины</h4>
              <div className="dlg-causes">
                {diagnosis.causes.map((c, i) => {
                  const sev = SEVERITY_STYLE[c.severity];
                  return (
                    <div key={i} className="dlg-cause-card" style={{ background: sev.bg }}>
                      <div className="dlg-cause-row">
                        <span style={{ color: sev.text }}>{c.name}</span>
                        <span style={{ color: sev.text }} className="dlg-cause-pct-big">{c.pct}%</span>
                      </div>
                      <div className="diag-bar-track" style={{ background: 'rgba(255,255,255,0.6)' }}><div className="diag-bar-fill" style={{ width: `${c.pct}%`, background: sev.bar }} /></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {diagnosis.homeCare.length > 0 && (
            <div>
              <h4 className="dlg-h4">🏠 Лечение в домашних условиях</h4>
              <div className="dlg-numbered">
                {diagnosis.homeCare.map((t, i) => <div key={i} className="dlg-numbered-row"><span className="dlg-num dlg-num-care">{i + 1}</span><span>{t}</span></div>)}
              </div>
            </div>
          )}

          {diagnosis.recommendations.length > 0 && (
            <div>
              <h4 className="dlg-h4">Когда обращаться к ветеринару</h4>
              <div className="dlg-numbered">
                {diagnosis.recommendations.map((t, i) => <div key={i} className="dlg-numbered-row"><span className="dlg-num dlg-num-vet">{i + 1}</span><span>{t}</span></div>)}
              </div>
            </div>
          )}
        </div>
        <div className="dlg-actions">
          <button className="sb-new" style={{ width: 'auto', padding: '10px 20px' }} onClick={onClose}>Понятно, сохранить в историю</button>
        </div>
      </div>
    </div>
  );
}

function renderMarkdown(text: string) {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (i + 1 < lines.length && lines[i + 1].match(/^\|[-: |]+\|$/)) {
      const tl: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) { tl.push(lines[i]); i++; }
      const rows = tl.map(l => l.split('|').filter((_, x, a) => x > 0 && x < a.length - 1).map(c => c.trim()));
      const [hdr, , ...body] = rows;
      result.push(
        <div key={result.length} className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{hdr.map((c, j) => <th key={j}>{inlineMd(c)}</th>)}</tr></thead>
            <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inlineMd(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ); continue;
    }
    if (line.startsWith('# ')) result.push(<h1 key={i} className="md-h1">{inlineMd(line.slice(2))}</h1>);
    else if (line.startsWith('## ')) result.push(<h2 key={i} className="md-h2">{inlineMd(line.slice(3))}</h2>);
    else if (line.startsWith('### ')) result.push(<h3 key={i} className="md-h3">{inlineMd(line.slice(4))}</h3>);
    else if (line.match(/^---+$/)) result.push(<hr key={i} className="md-hr" />);
    else if (line.startsWith('```')) {
      const cl: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) { cl.push(lines[i]); i++; }
      result.push(<pre key={i} className="md-code"><code>{cl.join('\n')}</code></pre>);
    } else if (line.match(/^[-*•] /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*•] /)) { items.push(lines[i].replace(/^[-*•] /, '')); i++; }
      result.push(<ul key={i} className="md-ul">{items.map((it, j) => <li key={j}>{inlineMd(it)}</li>)}</ul>); continue;
    } else if (line.match(/^\d+\. /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) { items.push(lines[i].replace(/^\d+\. /, '')); i++; }
      result.push(<ol key={i} className="md-ol">{items.map((it, j) => <li key={j}>{inlineMd(it)}</li>)}</ol>); continue;
    } else if (line.trim() === '') result.push(<div key={i} className="md-sp" />);
    else result.push(<p key={i} className="md-p">{inlineMd(line)}</p>);
    i++;
  }
  return result;
}

function inlineMd(text: string): React.ReactNode {
  return text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('*') && p.endsWith('*')) return <em key={i}>{p.slice(1, -1)}</em>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="md-ic">{p.slice(1, -1)}</code>;
    return p;
  });
}

export default function NauryzAI() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingImage, setPendingImage] = useState<ImageData | null>(null);
  const [pendingVideo, setPendingVideo] = useState<{ frames: ImageData[]; preview: string } | null>(null);
  const [isExtractingVideo, setIsExtractingVideo] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [calcAnimal, setCalcAnimal] = useState(0);
  const [calcCount, setCalcCount] = useState('');
  const [calcDays, setCalcDays] = useState('7');
  const [searchMode, setSearchMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [sessionCost, setSessionCost] = useState(0);
  const [activeDiagnosis, setActiveDiagnosis] = useState<DiagnosisData | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => { setSidebarOpen(window.innerWidth >= 768); }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nauryz-v4');
      if (saved) {
        const parsed: Chat[] = JSON.parse(saved);
        const c = parsed.map(ch => ({ ...ch, createdAt: new Date(ch.createdAt), messages: ch.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) })) }));
        setChats(c);
        if (c.length > 0) { setActiveChatId(c[c.length - 1].id); setMessages(c[c.length - 1].messages); }
      }
    } catch {}
  }, []);
  useEffect(() => { if (chats.length > 0) try { localStorage.setItem('nauryz-v4', JSON.stringify(chats)); } catch {} }, [chats]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isLoading]);

  const createNewChat = () => {
    const id = Date.now().toString();
    setChats(prev => [...prev, { id, title: 'Новый чат', messages: [], createdAt: new Date() }]);
    setActiveChatId(id); setMessages([]); setSessionCost(0);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const switchChat = (chatId: string) => {
    if (activeChatId) setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, messages } : c));
    const chat = chats.find(c => c.id === chatId);
    if (chat) { setActiveChatId(chatId); setMessages(chat.messages); setSessionCost(0); }
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const deleteChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (activeChatId === chatId) { setActiveChatId(null); setMessages([]); }
  };

  const MAX_IMAGE_EDGE = 1568; // оптимальный длинный край для vision-моделей Claude — большие фото Claude всё равно сначала уменьшит
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // лимит Anthropic API на одно изображение в base64

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.type.startsWith('video/')) { extractFrames(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
      const needsResize = scale < 1 || file.size > MAX_UPLOAD_BYTES;
      if (!needsResize) {
        const r = new FileReader();
        r.onload = ev => { const d = ev.target?.result as string; setPendingImage({ data: d.split(',')[1], mediaType: file.type, preview: d }); };
        r.readAsDataURL(file);
        return;
      }
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale) || img.width;
      c.height = Math.round(img.height * scale) || img.height;
      const ctx = c.getContext('2d');
      ctx?.drawImage(img, 0, 0, c.width, c.height);
      const d = c.toDataURL('image/jpeg', 0.85);
      setPendingImage({ data: d.split(',')[1], mediaType: 'image/jpeg', preview: d });
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('Не удалось загрузить фото'); };
    img.src = url;
  };

  const extractFrames = (file: File) => {
    setIsExtractingVideo(true);
    const url = URL.createObjectURL(file);
    const v = document.createElement('video'); v.src = url; v.muted = true; v.playsInline = true;
    v.onloadedmetadata = async () => {
      if (v.duration > 20) { alert('Максимум 20 секунд'); setIsExtractingVideo(false); URL.revokeObjectURL(url); return; }
      const c = document.createElement('canvas'); c.width = 480; c.height = Math.round(480 * v.videoHeight / v.videoWidth) || 360;
      const ctx = c.getContext('2d'); const frames: ImageData[] = [];
      for (let i = 0; i < 7; i++) {
        await new Promise<void>(res => { v.currentTime = Math.min(v.duration * i / 6, v.duration - 0.05); v.onseeked = () => res(); });
        ctx?.drawImage(v, 0, 0, c.width, c.height);
        const d = c.toDataURL('image/jpeg', 0.7);
        frames.push({ data: d.split(',')[1], mediaType: 'image/jpeg', preview: d });
      }
      setPendingVideo({ frames, preview: url }); setIsExtractingVideo(false);
    };
    v.onerror = () => { setIsExtractingVideo(false); URL.revokeObjectURL(url); };
  };

  const startVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Только в Chrome'); return; }
    const r = new SR(); r.lang = 'ru-RU'; r.continuous = false; r.interimResults = false;
    r.onresult = (e: any) => { setInput(e.results[0][0].transcript); setIsRecording(false); };
    r.onerror = () => setIsRecording(false); r.onend = () => setIsRecording(false);
    recognitionRef.current = r; r.start(); setIsRecording(true);
  };

  const sendMessage = useCallback(async (text?: string) => {
    const content = text || input.trim();
    if (!content && !pendingImage && !pendingVideo) return;
    let chatId = activeChatId;
    if (!chatId) {
      const id = Date.now().toString();
      setChats(prev => [...prev, { id, title: content?.slice(0, 30) || 'Новый чат', messages: [], createdAt: new Date() }]);
      setActiveChatId(id); chatId = id;
    }
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: content || (pendingVideo ? '🎥 Видео' : '📸 Фото'), image: pendingImage || undefined, frames: pendingVideo?.frames, videoPreview: pendingVideo?.preview, timestamp: new Date() };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs); setInput(''); setPendingImage(null); setPendingVideo(null); setIsLoading(true);
    if (messages.length === 0) setChats(prev => prev.map(c => c.id === chatId ? { ...c, title: content?.slice(0, 35) || 'Чат' } : c));
    const ac = new AbortController(); setAbortController(ac);
    let searchCtx = '';
    if (searchMode && content) {
      try { const sr = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: content }), signal: ac.signal }); if (sr.ok) { const sd = await sr.json(); searchCtx = sd.result ? `\n\n[Из интернета]:\n${sd.result}` : ''; } } catch {}
    }
    const apiMsgs = newMsgs.map(m => ({ role: m.role, content: m.role === 'user' && m.id === userMsg.id && searchCtx ? m.content + searchCtx : m.content, image: m.image, frames: m.frames }));
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: apiMsgs }), signal: ac.signal });
      if (!res.ok) throw new Error('Ошибка');
      const reader = res.body!.getReader(); const dec = new TextDecoder();
      let text2 = ''; const aid = (Date.now() + 1).toString();
      setMessages(prev => [...prev, { id: aid, role: 'assistant', content: '', timestamp: new Date() }]);
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        text2 += dec.decode(value, { stream: true });
        const di = text2.indexOf('\n___DIAGNOSIS___');
        const ci = text2.indexOf('\n___COST___');
        const cut = di >= 0 ? di : ci;
        setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: cut >= 0 ? text2.slice(0, cut) : text2 } : m));
      }
      const di = text2.indexOf('\n___DIAGNOSIS___');
      const ci = text2.indexOf('\n___COST___');
      let diagnosis: DiagnosisData | undefined;
      if (di >= 0) {
        try { diagnosis = JSON.parse(text2.slice(di + '\n___DIAGNOSIS___'.length, ci >= 0 ? ci : undefined)); } catch {}
      }
      const plainContent = text2.slice(0, di >= 0 ? di : (ci >= 0 ? ci : undefined));
      if (ci >= 0) { try { const { costUsd } = JSON.parse(text2.slice(ci + '\n___COST___'.length)); setMessages(prev => prev.map(m => m.id === aid ? { ...m, costUsd } : m)); setSessionCost(p => p + costUsd); } catch {} }
      setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: plainContent, diagnosis } : m));
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: [...newMsgs, { id: aid, role: 'assistant' as const, content: plainContent, diagnosis, timestamp: new Date() }] } : c));
    } catch (err: any) {
      if (err.name !== 'AbortError') setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: '❌ Ошибка. Проверьте API ключ.', timestamp: new Date() }]);
    } finally { setIsLoading(false); setAbortController(null); }
  }, [input, pendingImage, pendingVideo, messages, searchMode, activeChatId]);

  const calcRes = () => {
    const count = parseInt(calcCount) || 0; const days = parseInt(calcDays) || 1; const a = FEED_ANIMALS[calcAnimal];
    return { kg: ((count * a.perHead * days) / 1000).toFixed(1), perDay: ((count * a.perHead) / 1000).toFixed(1), name: a.label };
  };

  const isEmpty = messages.length === 0;
  const lastMsg = messages[messages.length - 1];
  // До появления пустого assistant-плейсхолдера источник — последнее user-сообщение;
  // после того как стрим начал писать в него (плейсхолдер уже в messages) — предпоследнее.
  const pendingSourceMsg = !isLoading ? undefined
    : lastMsg?.role === 'user' ? lastMsg
    : lastMsg?.role === 'assistant' && lastMsg.content === '' ? messages[messages.length - 2]
    : undefined;
  const isAwaitingReply = isLoading && lastMsg?.role === 'user';
  const isAnalyzingPhoto = !!(pendingSourceMsg?.image || pendingSourceMsg?.frames);

  const Composer = (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={textareaRef} value={input} rows={1}
          onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Опиши проблему или задай вопрос…"
        />
        <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleFile} />
        <button className="c-btn c-btn-photo" onClick={() => fileRef.current?.click()}><Camera size={15} strokeWidth={2.75} />Фото</button>
        <button className={`c-btn c-btn-voice ${isRecording ? 'rec' : ''}`} onClick={isRecording ? () => { recognitionRef.current?.stop(); setIsRecording(false); } : startVoice}>
          <Mic size={15} strokeWidth={2.75} />{isRecording ? 'Запись…' : 'Голос'}
        </button>
        {isLoading
          ? <button className="c-send stop" onClick={() => { abortController?.abort(); setIsLoading(false); }} aria-label="Остановить"><Square size={15} strokeWidth={2.75} fill="currentColor" /></button>
          : <button className="c-send" onClick={() => sendMessage()} disabled={!input.trim() && !pendingImage && !pendingVideo} aria-label="Отправить"><Send size={16} strokeWidth={2.75} /></button>}
      </div>
    </div>
  );

  return (
    <>
      <div className="layout">
        {sidebarOpen && <div className="sb-overlay" onClick={() => setSidebarOpen(false)} />}

        {/* SIDEBAR */}
        <div className={`sidebar ${sidebarOpen ? '' : 'closed'}`}>
          <div className="sb-brand">
            <div className="sb-brand-icon"><Logo size={19} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sb-brand-name">Nauryz AI</div>
              <div className="sb-brand-sub">Агро-ассистент</div>
            </div>
            <button className="sb-hide-btn" onClick={() => setSidebarOpen(false)} aria-label="Скрыть историю"><Menu size={16} strokeWidth={2.75} /></button>
          </div>

          <button className="sb-new" onClick={createNewChat}><Plus size={14} strokeWidth={2.75} />Новый чат</button>

          <div className="sb-section-label">История</div>
          <div className="sb-chats">
            {chats.length === 0 && <div style={{ padding: '12px 10px', fontSize: 11, color: 'var(--color-neutral-500)', textAlign: 'center' }}>Нет чатов</div>}
            {chats.slice().reverse().map(chat => (
              <div key={chat.id} className={`chat-row ${chat.id === activeChatId ? 'act' : ''}`} onClick={() => switchChat(chat.id)}>
                <div className="chat-row-title">{chat.title}</div>
                <div className="chat-row-snippet">{chat.messages[chat.messages.length - 1]?.content.slice(0, 40) || ''}</div>
                <button className="chat-del" onClick={e => deleteChat(chat.id, e)} aria-label="Удалить чат"><X size={12} strokeWidth={2.75} /></button>
              </div>
            ))}
          </div>

          <div className="sb-footer">
            <div className="sb-avatar">Ф</div>
            <span className="sb-footer-label">Фермер</span>
            {sessionCost > 0 && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-neutral-500)' }}>${sessionCost.toFixed(4)}</span>}
          </div>
        </div>

        {/* MAIN */}
        <div className="main">
          <div className="topbar">
            {!sidebarOpen && <button className="icon-btn" onClick={() => setSidebarOpen(true)} aria-label="Показать историю"><Menu size={16} strokeWidth={2.75} /></button>}
            <div className="topbar-title">{isEmpty ? 'Новый чат' : (messages[0]?.content || 'Чат')}</div>
            <div className="topbar-spacer" />
            <button className={`pill-btn ${searchMode ? 'on' : ''}`} onClick={() => setSearchMode(!searchMode)}>
              <Globe size={14} strokeWidth={2.75} />Поиск {searchMode ? 'ВКЛ' : 'ВЫКЛ'}
            </button>
            <button className="pill-btn" onClick={() => setShowCalc(true)}><Calculator size={14} strokeWidth={2.75} />Калькулятор</button>
          </div>

          <div className="content">
            {isEmpty ? (
              <div className="empty">
                <div className="empty-badge"><Logo size={34} strokeWidth={2.5} /></div>
                <h2 className="empty-heading">Сәлем! Чем помочь?</h2>
                <p className="empty-sub">Задай вопрос о птицеводстве или прикрепи фото курицы/птичника — поставлю диагноз и подскажу решение</p>
                <div className="quick-grid">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={s.text} className="quick-card" style={{ animationDelay: `${i * 0.06}s` }} onClick={() => sendMessage(s.text)}>
                      <span className="quick-emoji">{s.emoji}</span>
                      <span className="quick-text">{s.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="feed">
                <div className="feed-inner">
                  {messages.map(msg => (
                    <div key={msg.id} className={`row ${msg.role}`}>
                      {msg.role === 'assistant' && <div className="a-avatar"><Logo size={16} strokeWidth={3} /></div>}
                      <div className="bubble-col">
                        {msg.role === 'user' ? (
                          <>
                            {(msg.videoPreview || msg.image) && (
                              <div className="u-photo-frame">
                                {msg.videoPreview && <video src={msg.videoPreview} controls />}
                                {msg.image && !msg.videoPreview && <img src={msg.image.preview} alt="" />}
                              </div>
                            )}
                            {msg.content && !(msg.image || msg.videoPreview) && <div className="u-bubble">{msg.content}</div>}
                          </>
                        ) : msg.diagnosis ? (
                          <DiagnosisCard diagnosis={msg.diagnosis} onOpen={() => setActiveDiagnosis(msg.diagnosis!)} />
                        ) : msg.content === '' && isLoading && msg.id === lastMsg?.id ? (
                          isAnalyzingPhoto ? (
                            <div className="analyzing-card">
                              <div className="analyzing-title">📸 Анализирую фото…</div>
                              <div className="analyzing-track"><div className="analyzing-bar" /></div>
                              <div className="analyzing-caption">Определяю симптомы по изображению…</div>
                            </div>
                          ) : (
                            <div className="typing-card"><span /><span /><span /></div>
                          )
                        ) : (
                          <div className="a-card">{renderMarkdown(msg.content)}</div>
                        )}
                        <div className="msg-time">
                          {msg.timestamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                          {msg.role === 'assistant' && typeof msg.costUsd === 'number' && <span> · ${msg.costUsd.toFixed(4)}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {isAwaitingReply && (
                    <div className="row assistant">
                      <div className="a-avatar"><Logo size={16} strokeWidth={3} /></div>
                      {isAnalyzingPhoto ? (
                        <div className="analyzing-card">
                          <div className="analyzing-title">📸 Анализирую фото…</div>
                          <div className="analyzing-track"><div className="analyzing-bar" /></div>
                          <div className="analyzing-caption">Определяю симптомы по изображению…</div>
                        </div>
                      ) : (
                        <div className="typing-card"><span /><span /><span /></div>
                      )}
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              </div>
            )}
          </div>

          {pendingImage && <div className="preview"><img src={pendingImage.preview} alt="" /><span className="preview-label">📸 Фото прикреплено</span><button className="preview-rm" onClick={() => setPendingImage(null)} aria-label="Убрать"><X size={16} strokeWidth={2.75} /></button></div>}
          {isExtractingVideo && <div className="preview"><span className="preview-label">🎥 Обрабатываю видео...</span></div>}
          {pendingVideo && !isExtractingVideo && <div className="preview"><video src={pendingVideo.preview} /><span className="preview-label">🎥 Видео ({pendingVideo.frames.length} кадров)</span><button className="preview-rm" onClick={() => setPendingVideo(null)} aria-label="Убрать"><X size={16} strokeWidth={2.75} /></button></div>}

          {Composer}
        </div>
      </div>

      {/* CALC MODAL — не редизайнен на этом этапе (отдельный шаг по плану) */}
      {showCalc && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setShowCalc(false)}>
          <div className="modal">
            <h2>🧮 Калькулятор корма</h2>
            <div className="field"><label>Вид птицы</label>
              <select value={calcAnimal} onChange={e => setCalcAnimal(Number(e.target.value))}>
                {FEED_ANIMALS.map((a, i) => <option key={i} value={i}>{a.label}</option>)}
              </select>
            </div>
            <div className="field"><label>Количество голов</label><input type="number" placeholder="100" value={calcCount} onChange={e => setCalcCount(e.target.value)} min="1" /></div>
            <div className="field"><label>Период (дней)</label><input type="number" value={calcDays} onChange={e => setCalcDays(e.target.value)} min="1" /></div>
            {calcCount && <div className="calc-res"><div className="calc-big">{calcRes().kg} кг</div><div className="calc-sub">{calcRes().name} · {calcCount} гол · {calcDays} дн · {calcRes().perDay} кг/день</div></div>}
            <div className="mbtns">
              <button className="msec" onClick={() => setShowCalc(false)}>Закрыть</button>
              <button className="mprim" disabled={!calcCount} onClick={() => { setShowCalc(false); sendMessage(`Рацион: ${calcRes().name} ${calcCount} голов ${calcDays} дней = ${calcRes().kg} кг. Дай состав рациона.`); }}>Спросить AI ↗</button>
            </div>
          </div>
        </div>
      )}

      {activeDiagnosis && <DiagnosisModal diagnosis={activeDiagnosis} onClose={() => setActiveDiagnosis(null)} />}
    </>
  );
}
