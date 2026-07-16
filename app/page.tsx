'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface ImageData { data: string; mediaType: string; preview: string }
interface Message {
  id: string; role: 'user' | 'assistant'; content: string;
  image?: ImageData; frames?: ImageData[]; videoPreview?: string;
  costUsd?: number; timestamp: Date;
}
interface Chat { id: string; title: string; messages: Message[]; createdAt: Date; }

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
        const mi = text2.indexOf('\n___COST___');
        setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: mi >= 0 ? text2.slice(0, mi) : text2 } : m));
      }
      const mi = text2.indexOf('\n___COST___');
      if (mi >= 0) { try { const { costUsd } = JSON.parse(text2.slice(mi + '\n___COST___'.length)); setMessages(prev => prev.map(m => m.id === aid ? { ...m, costUsd } : m)); setSessionCost(p => p + costUsd); } catch {} }
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: [...newMsgs, { id: aid, role: 'assistant' as const, content: text2.split('\n___COST___')[0], timestamp: new Date() }] } : c));
    } catch (err: any) {
      if (err.name !== 'AbortError') setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: '❌ Ошибка. Проверьте API ключ.', timestamp: new Date() }]);
    } finally { setIsLoading(false); setAbortController(null); }
  }, [input, pendingImage, pendingVideo, messages, searchMode, activeChatId]);

  const calcRes = () => {
    const count = parseInt(calcCount) || 0; const days = parseInt(calcDays) || 1; const a = FEED_ANIMALS[calcAnimal];
    return { kg: ((count * a.perHead * days) / 1000).toFixed(1), perDay: ((count * a.perHead) / 1000).toFixed(1), name: a.label };
  };

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; }
        body { font-family: -apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif; background: #f0f4ee; color: #1a2e14; }

        .layout { display: flex; height: 100dvh; }

        /* SIDEBAR — белая карточка */
        .sidebar {
          width: 220px; min-width: 220px; background: #fff;
          border-right: 1px solid #e0e8d8; display: flex; flex-direction: column;
          transition: width .22s, min-width .22s; overflow: hidden;
        }
        .sidebar.closed { width: 0; min-width: 0; }

        .sb-top { padding: 20px 16px 12px; }
        .sb-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
        .sb-brand-icon { font-size: 28px; line-height: 1; }
        .sb-brand-name { font-size: 17px; font-weight: 700; color: #2d5a1e; letter-spacing: -.4px; }
        .sb-brand-sub { font-size: 10px; color: #8aaa7a; margin-top: 1px; }

        .sb-nav { display: flex; flex-direction: column; gap: 2px; }
        .sb-nav-item {
          display: flex; align-items: center; gap: 10px; padding: 9px 12px;
          border-radius: 10px; cursor: pointer; font-size: 13px; color: #5a7a50;
          transition: all .15s; border: none; background: none; width: 100%; text-align: left;
          white-space: nowrap;
        }
        .sb-nav-item:hover { background: #f0f4ee; color: #2d5a1e; }
        .sb-nav-item.active { background: #e8f5e0; color: #2d5a1e; font-weight: 600; }
        .sb-nav-icon { font-size: 16px; flex-shrink: 0; }
        .sb-new { background: #3d7a2e !important; color: #fff !important; font-weight: 600 !important; margin-bottom: 8px; }
        .sb-new:hover { background: #4a8f38 !important; }

        .sb-divider { height: 1px; background: #e8f0e0; margin: 8px 16px; }

        .sb-chats { flex: 1; overflow-y: auto; padding: 4px 8px; }
        .sb-chats::-webkit-scrollbar { width: 3px; }
        .sb-chats::-webkit-scrollbar-thumb { background: #c8dbb8; border-radius: 3px; }
        .chat-row {
          display: flex; align-items: center; gap: 8px; padding: 8px 10px;
          border-radius: 9px; cursor: pointer; font-size: 12px; color: #7a9a6a;
          transition: all .15s; white-space: nowrap;
        }
        .chat-row:hover { background: #f0f4ee; color: #3d6a2e; }
        .chat-row.act { background: #e8f5e0; color: #2d5a1e; font-weight: 500; }
        .chat-row-title { flex: 1; overflow: hidden; text-overflow: ellipsis; }
        .chat-del { opacity: 0; background: none; border: none; color: #aac8a0; cursor: pointer; font-size: 12px; padding: 2px 4px; border-radius: 4px; flex-shrink: 0; }
        .chat-row:hover .chat-del { opacity: 1; }
        .chat-del:hover { color: #e57373; }

        .sb-footer { padding: 12px 16px; border-top: 1px solid #e0e8d8; }
        .sb-profile { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #7a9a6a; }
        .sb-avatar { width: 28px; height: 28px; border-radius: 50%; background: #e8f5e0; display: flex; align-items: center; justify-content: center; font-size: 14px; }

        /* MAIN */
        .main { flex: 1; display: flex; flex-direction: column; min-width: 0; background: #f0f4ee; }

        .topbar { display: flex; align-items: center; gap: 10px; padding: 12px 20px; background: #fff; border-bottom: 1px solid #e0e8d8; }
        .menu-btn { background: none; border: none; font-size: 18px; color: #7a9a6a; cursor: pointer; padding: 4px; border-radius: 7px; transition: all .15s; line-height: 1; }
        .menu-btn:hover { background: #f0f4ee; color: #2d5a1e; }
        .topbar-title { font-size: 15px; font-weight: 600; color: #2d5a1e; }
        .topbar-right { margin-left: auto; display: flex; gap: 6px; }
        .top-btn { display: flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 20px; font-size: 12px; border: 1px solid #d0e0c0; background: #fff; color: #5a7a50; cursor: pointer; transition: all .15s; font-weight: 500; }
        .top-btn:hover { background: #f0f4ee; border-color: #b0c8a0; }
        .top-btn.on { background: #e8f5e0; border-color: #7ab86a; color: #2d5a1e; }
        .top-btn-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

        /* MESSAGES */
        .msgs { flex: 1; overflow-y: auto; padding: 24px 20px; display: flex; flex-direction: column; gap: 20px; }
        .msgs::-webkit-scrollbar { width: 4px; }
        .msgs::-webkit-scrollbar-thumb { background: #c8dbb8; border-radius: 4px; }

        /* WELCOME */
        .welcome { margin: auto; max-width: 600px; width: 100%; text-align: center; padding: 20px 16px; }
        .w-emoji { font-size: 64px; margin-bottom: 16px; line-height: 1; display: block; }
        .w-title { font-size: 32px; font-weight: 700; color: #2d5a1e; margin-bottom: 8px; letter-spacing: -.8px; }
        .w-sub { font-size: 15px; color: #7a9a6a; margin-bottom: 28px; line-height: 1.6; }
        .w-stats { display: flex; gap: 10px; justify-content: center; margin-bottom: 28px; }
        .w-stat { background: #fff; border: 1px solid #e0e8d8; border-radius: 14px; padding: 12px 18px; display: flex; flex-direction: column; align-items: center; gap: 3px; }
        .w-stat-n { font-size: 22px; font-weight: 700; color: #3d7a2e; }
        .w-stat-l { font-size: 11px; color: #9ab88a; }

        /* INPUT CARD — центральный как на референсе */
        .input-card { background: #fff; border-radius: 18px; border: 1px solid #e0e8d8; padding: 14px 16px; box-shadow: 0 4px 24px rgba(60,100,40,.08); }
        .input-card textarea {
          width: 100%; background: none; border: none; color: #1a2e14; font-size: 15px;
          resize: none; outline: none; font-family: inherit; line-height: 1.5;
          min-height: 36px; max-height: 120px; display: block; margin-bottom: 10px;
        }
        .input-card textarea::placeholder { color: #aac8a0; }
        .input-card-bottom { display: flex; align-items: center; gap: 8px; }
        .ic-btn {
          display: flex; align-items: center; gap: 5px; padding: 6px 12px;
          border-radius: 20px; font-size: 12px; border: 1px solid #e0e8d8;
          background: #fff; color: #5a7a50; cursor: pointer; transition: all .15s;
          white-space: nowrap; font-weight: 500;
        }
        .ic-btn:hover { background: #f0f4ee; border-color: #b0c8a0; }
        .ic-btn.on { background: #e8f5e0; border-color: #7ab86a; color: #2d5a1e; }
        .ic-btn.rec { border-color: #f4a0a0; color: #d04040; animation: pulse 1s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        .ic-send {
          margin-left: auto; width: 38px; height: 38px; border-radius: 50%;
          background: #3d7a2e; border: none; color: #fff; cursor: pointer;
          font-size: 16px; display: flex; align-items: center; justify-content: center;
          transition: background .15s; flex-shrink: 0;
        }
        .ic-send:hover { background: #4a8f38; }
        .ic-send:disabled { background: #c8dbb8; cursor: default; }
        .ic-send.stop { background: #c03030; }

        /* SUGGESTIONS GRID */
        .sug-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
        .sug-card {
          background: #fff; border: 1px solid #e8f0e0; border-radius: 14px;
          padding: 11px 14px; cursor: pointer; text-align: left;
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; color: #4a6a3a; transition: all .15s;
          font-weight: 500;
        }
        .sug-card:hover { border-color: #7ab86a; background: #f4faf0; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(60,100,40,.08); }
        .sug-emoji { font-size: 20px; flex-shrink: 0; }

        /* MESSAGES */
        .msg { display: flex; gap: 10px; }
        .msg.user { flex-direction: row-reverse; }
        .av { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; margin-top: 2px; }
        .av.ai { background: #e8f5e0; border: 1px solid #c8e0b8; }
        .av.user { background: #fff; border: 1px solid #e0e8d8; }
        .bwrap { max-width: 76%; display: flex; flex-direction: column; }
        .msg.user .bwrap { align-items: flex-end; }
        .bubble { padding: 12px 16px; border-radius: 18px; font-size: 14px; line-height: 1.65; word-break: break-word; }
        .bubble.ai { background: #fff; border: 1px solid #e0e8d8; border-radius: 18px 18px 18px 5px; color: #1a2e14; }
        .bubble.user { background: #3d7a2e; color: #fff; border-radius: 18px 18px 5px 18px; }
        .bubble img, .bubble video { max-width: 100%; border-radius: 10px; margin-bottom: 8px; display: block; }
        .bmeta { font-size: 10px; color: #aac8a0; margin-top: 4px; }
        .msg.user .bmeta { text-align: right; }

        /* Typing */
        .typing { display: flex; gap: 5px; align-items: center; padding: 4px 0; }
        .typing span { width: 7px; height: 7px; border-radius: 50%; background: #7ab86a; animation: bounce 1.2s infinite; }
        .typing span:nth-child(2) { animation-delay: .2s; } .typing span:nth-child(3) { animation-delay: .4s; }
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }

        /* Markdown */
        .md-h1 { font-size: 18px; font-weight: 700; color: #2d5a1e; margin: 10px 0 7px; padding-bottom: 6px; border-bottom: 1px solid #e0e8d8; }
        .md-h2 { font-size: 15px; font-weight: 600; color: #3d6a2e; margin: 9px 0 5px; }
        .md-h3 { font-size: 14px; font-weight: 600; color: #4a7a38; margin: 7px 0 4px; }
        .md-p { margin: 3px 0; }
        .md-hr { border: none; border-top: 1px solid #e0e8d8; margin: 10px 0; }
        .md-ul, .md-ol { padding-left: 18px; margin: 4px 0; }
        .md-ul li, .md-ol li { margin: 2px 0; }
        .md-code { background: #f4faf0; border: 1px solid #d0e0c0; border-radius: 8px; padding: 10px 14px; font-family: 'SF Mono', 'Consolas', monospace; font-size: 12px; overflow-x: auto; margin: 6px 0; color: #3d6a2e; }
        .md-ic { background: #f4faf0; border: 1px solid #d0e0c0; border-radius: 4px; padding: 1px 5px; font-family: 'SF Mono', monospace; font-size: 12px; color: #5a8a3e; }
        .md-sp { height: 4px; }
        .md-table-wrap { overflow-x: auto; margin: 7px 0; border-radius: 10px; border: 1px solid #e0e8d8; }
        .md-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .md-table th { background: #f4faf0; color: #3d6a2e; padding: 8px 12px; text-align: left; font-weight: 600; border-bottom: 1px solid #e0e8d8; }
        .md-table td { padding: 7px 12px; border-bottom: 1px solid #f0f4ee; color: #4a6a3a; }
        .md-table tr:last-child td { border-bottom: none; }
        .md-table tr:hover td { background: #f8fcf5; }

        /* Preview */
        .preview { margin: 0 20px 8px; background: #fff; border: 1px solid #e0e8d8; border-radius: 12px; padding: 9px 14px; display: flex; align-items: center; gap: 10px; }
        .preview img, .preview video { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; }
        .preview-label { flex: 1; font-size: 12px; color: #7a9a6a; }
        .preview-rm { background: none; border: none; color: #aac8a0; cursor: pointer; font-size: 16px; }

        /* INPUT AREA at bottom when chatting */
        .input-area { padding: 8px 20px 16px; }

        /* Modal */
        .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 20px; backdrop-filter: blur(4px); }
        .modal { background: #fff; border-radius: 20px; padding: 24px; width: 100%; max-width: 360px; box-shadow: 0 20px 60px rgba(60,100,40,.15); }
        .modal h2 { font-size: 17px; font-weight: 700; margin-bottom: 18px; color: #2d5a1e; }
        .field { margin-bottom: 12px; }
        .field label { display: block; font-size: 11px; color: #9ab88a; margin-bottom: 5px; text-transform: uppercase; letter-spacing: .5px; font-weight: 600; }
        .field select, .field input { width: 100%; background: #f4faf0; border: 1px solid #d0e0c0; color: #1a2e14; border-radius: 10px; padding: 9px 12px; font-size: 14px; outline: none; font-family: inherit; }
        .field select:focus, .field input:focus { border-color: #7ab86a; }
        .calc-res { background: #f4faf0; border: 1px solid #d0e0c0; border-radius: 12px; padding: 16px; margin: 14px 0; text-align: center; }
        .calc-big { font-size: 32px; font-weight: 700; color: #3d7a2e; }
        .calc-sub { font-size: 12px; color: #9ab88a; margin-top: 4px; }
        .mbtns { display: flex; gap: 8px; margin-top: 6px; }
        .mbtns button { flex: 1; padding: 10px; border-radius: 10px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; font-family: inherit; }
        .mprim { background: #3d7a2e; color: #fff; } .mprim:hover { background: #4a8f38; } .mprim:disabled { background: #c8dbb8; cursor: default; }
        .msec { background: #f4faf0; color: #5a7a50; border: 1px solid #d0e0c0 !important; }

        /* Mobile */
        .sb-overlay { display: none; }
        @media (max-width: 767px) {
          .sidebar { position: fixed; z-index: 100; height: 100dvh; top: 0; left: 0; box-shadow: 8px 0 32px rgba(0,0,0,.12); }
          .sidebar.closed { width: 0; min-width: 0; }
          .sb-overlay { display: block; position: fixed; inset: 0; z-index: 99; background: rgba(0,0,0,.3); }
          .sug-grid { grid-template-columns: 1fr; }
          .bwrap { max-width: 88%; }
          .msgs { padding: 16px 14px; }
          .welcome { padding: 16px 12px; }
          .w-title { font-size: 24px; }
          .w-emoji { font-size: 48px; }
          .w-stats { gap: 7px; }
          .w-stat { padding: 9px 12px; }
          .topbar { padding: 10px 14px; }
          .input-area { padding: 6px 14px 14px; }
        }
      `}</style>

      <div className="layout">
        {sidebarOpen && <div className="sb-overlay" onClick={() => setSidebarOpen(false)} />}

        {/* SIDEBAR */}
        <div className={`sidebar ${sidebarOpen ? '' : 'closed'}`}>
          <div className="sb-top">
            <div className="sb-brand">
              <span className="sb-brand-icon">🌾</span>
              <div>
                <div className="sb-brand-name">Nauryz AI</div>
                <div className="sb-brand-sub">Агро-ассистент</div>
              </div>
            </div>
            <div className="sb-nav">
              <button className="sb-nav-item sb-new" onClick={createNewChat}>
                <span className="sb-nav-icon">✏️</span> Новый чат
              </button>
            </div>
          </div>

          <div className="sb-divider" />

          <div className="sb-chats">
            {chats.length === 0 && <div style={{ padding: '12px 10px', fontSize: 11, color: '#b0c8a0', textAlign: 'center' }}>Нет чатов</div>}
            {chats.slice().reverse().map(chat => (
              <div key={chat.id} className={`chat-row ${chat.id === activeChatId ? 'act' : ''}`} onClick={() => switchChat(chat.id)}>
                <span>💬</span>
                <span className="chat-row-title">{chat.title}</span>
                <button className="chat-del" onClick={e => deleteChat(chat.id, e)}>✕</button>
              </div>
            ))}
          </div>

          <div className="sb-footer">
            <div className="sb-profile">
              <div className="sb-avatar">👤</div>
              <span>Фермер</span>
              {sessionCost > 0 && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#aac8a0' }}>${sessionCost.toFixed(4)}</span>}
            </div>
          </div>
        </div>

        {/* MAIN */}
        <div className="main">
          <div className="topbar">
            <button className="menu-btn" onClick={() => setSidebarOpen(p => !p)}>☰</button>
            <span className="topbar-title">Nauryz AI 🌾</span>
            <div className="topbar-right">
              <button className={`top-btn ${searchMode ? 'on' : ''}`} onClick={() => setSearchMode(!searchMode)}>
                <span className="top-btn-dot" />
                🌐 Поиск {searchMode ? 'ВКЛ' : 'ВЫКЛ'}
              </button>
              <button className="top-btn" onClick={() => setShowCalc(true)}>🧮 Калькулятор</button>
            </div>
          </div>

          <div className="msgs">
            {messages.length === 0 ? (
              <div className="welcome">
                <span className="w-emoji">🌾</span>
                <h1 className="w-title">Чем помочь?</h1>
                <p className="w-sub">Задай вопрос о птицеводстве или прикрепи фото — поставлю диагноз</p>

                <div className="w-stats">
                  <div className="w-stat"><span className="w-stat-n">68</span><span className="w-stat-l">знаний</span></div>
                  <div className="w-stat"><span className="w-stat-n">40+</span><span className="w-stat-l">болезней</span></div>
                  <div className="w-stat"><span className="w-stat-n">📸</span><span className="w-stat-l">фото/видео</span></div>
                  <div className="w-stat"><span className="w-stat-n">🇰🇿</span><span className="w-stat-l">Казахстан</span></div>
                </div>

                <div className="sug-grid">
                  {SUGGESTIONS.map(s => (
                    <button key={s.text} className="sug-card" onClick={() => sendMessage(s.text)}>
                      <span className="sug-emoji">{s.emoji}</span>
                      <span>{s.text}</span>
                    </button>
                  ))}
                </div>

                <div className="input-card">
                  <textarea
                    ref={textareaRef} value={input} rows={2}
                    onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Опиши проблему или задай вопрос..."
                  />
                  <div className="input-card-bottom">
                    <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleFile} />
                    <button className="ic-btn" onClick={() => fileRef.current?.click()}>📎 Фото</button>
                    <button className={`ic-btn ${isRecording ? 'rec' : ''}`} onClick={isRecording ? () => { recognitionRef.current?.stop(); setIsRecording(false); } : startVoice}>
                      {isRecording ? '🔴 Запись...' : '🎤 Голос'}
                    </button>
                    {isLoading
                      ? <button className="ic-send stop" onClick={() => { abortController?.abort(); setIsLoading(false); }}>⏹</button>
                      : <button className="ic-send" onClick={() => sendMessage()} disabled={!input.trim() && !pendingImage && !pendingVideo}>➤</button>}
                  </div>
                </div>
              </div>
            ) : (
              messages.map(msg => (
                <div key={msg.id} className={`msg ${msg.role}`}>
                  <div className={`av ${msg.role}`}>{msg.role === 'assistant' ? '🌾' : '👤'}</div>
                  <div className="bwrap">
                    <div className={`bubble ${msg.role}`}>
                      {msg.videoPreview && <video src={msg.videoPreview} controls />}
                      {msg.image && !msg.videoPreview && <img src={msg.image.preview} alt="" />}
                      {msg.role === 'assistant'
                        ? (msg.content === '' && isLoading ? <div className="typing"><span /><span /><span /></div> : renderMarkdown(msg.content))
                        : msg.content}
                    </div>
                    <div className="bmeta">
                      {msg.timestamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      {msg.role === 'assistant' && typeof msg.costUsd === 'number' && <span> · ${msg.costUsd.toFixed(4)}</span>}
                    </div>
                  </div>
                </div>
              ))
            )}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="msg"><div className="av ai">🌾</div><div className="bubble ai"><div className="typing"><span /><span /><span /></div></div></div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Preview bars */}
          {pendingImage && <div className="preview"><img src={pendingImage.preview} alt="" /><span className="preview-label">📸 Фото прикреплено</span><button className="preview-rm" onClick={() => setPendingImage(null)}>✕</button></div>}
          {isExtractingVideo && <div className="preview"><span className="preview-label">🎥 Обрабатываю видео...</span></div>}
          {pendingVideo && !isExtractingVideo && <div className="preview"><video src={pendingVideo.preview} /><span className="preview-label">🎥 Видео ({pendingVideo.frames.length} кадров)</span><button className="preview-rm" onClick={() => setPendingVideo(null)}>✕</button></div>}

          {/* Input area when chatting */}
          {messages.length > 0 && (
            <div className="input-area">
              <div className="input-card">
                <textarea
                  ref={messages.length > 0 ? textareaRef : undefined} value={input} rows={1}
                  onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Опиши проблему или прикрепи фото..."
                />
                <div className="input-card-bottom">
                  <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleFile} />
                  <button className="ic-btn" onClick={() => fileRef.current?.click()}>📎 Фото</button>
                  <button className={`ic-btn ${isRecording ? 'rec' : ''}`} onClick={isRecording ? () => { recognitionRef.current?.stop(); setIsRecording(false); } : startVoice}>
                    {isRecording ? '🔴 Запись...' : '🎤 Голос'}
                  </button>
                  {isLoading
                    ? <button className="ic-send stop" onClick={() => { abortController?.abort(); setIsLoading(false); }}>⏹</button>
                    : <button className="ic-send" onClick={() => sendMessage()} disabled={!input.trim() && !pendingImage && !pendingVideo}>➤</button>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CALC MODAL */}
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
    </>
  );
}
