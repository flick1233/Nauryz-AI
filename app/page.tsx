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
  { icon: '🐔', text: 'Курица хромает, что делать?' },
  { icon: '🥚', text: 'Куры перестали нести яйца' },
  { icon: '💊', text: 'Норма корма для бройлеров' },
  { icon: '🌿', text: 'Признаки авитаминоза у кур' },
  { icon: '🦠', text: 'Болезнь Ньюкасла — симптомы' },
  { icon: '📋', text: 'Субсидии МСХ РК 2026' },
];

const FEED_ANIMALS = [
  { label: 'Бройлер', perHead: 120 },
  { label: 'Несушка', perHead: 110 },
  { label: 'Индейка', perHead: 300 },
  { label: 'Утка', perHead: 200 },
  { label: 'Гусь', perHead: 400 },
];

function renderMarkdown(text: string) {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (i + 1 < lines.length && lines[i + 1].match(/^\|[-: |]+\|$/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) { tableLines.push(lines[i]); i++; }
      result.push(renderTable(tableLines, result.length)); continue;
    }
    if (line.startsWith('# ')) result.push(<h1 key={i} className="md-h1">{inlineMarkdown(line.slice(2))}</h1>);
    else if (line.startsWith('## ')) result.push(<h2 key={i} className="md-h2">{inlineMarkdown(line.slice(3))}</h2>);
    else if (line.startsWith('### ')) result.push(<h3 key={i} className="md-h3">{inlineMarkdown(line.slice(4))}</h3>);
    else if (line.match(/^---+$/)) result.push(<hr key={i} className="md-hr" />);
    else if (line.startsWith('```')) {
      const codeLines: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      result.push(<pre key={i} className="md-code"><code>{codeLines.join('\n')}</code></pre>);
    } else if (line.match(/^[-*•] /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*•] /)) { items.push(lines[i].replace(/^[-*•] /, '')); i++; }
      result.push(<ul key={i} className="md-ul">{items.map((it, j) => <li key={j}>{inlineMarkdown(it)}</li>)}</ul>); continue;
    } else if (line.match(/^\d+\. /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) { items.push(lines[i].replace(/^\d+\. /, '')); i++; }
      result.push(<ol key={i} className="md-ol">{items.map((it, j) => <li key={j}>{inlineMarkdown(it)}</li>)}</ol>); continue;
    } else if (line.trim() === '') result.push(<div key={i} className="md-spacer" />);
    else result.push(<p key={i} className="md-p">{inlineMarkdown(line)}</p>);
    i++;
  }
  return result;
}

function renderTable(lines: string[], key: number) {
  const rows = lines.map(l => l.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim()));
  const [header, , ...body] = rows;
  return (
    <div key={key} className="md-table-wrap">
      <table className="md-table">
        <thead><tr>{header.map((cell, i) => <th key={i}>{inlineMarkdown(cell)}</th>)}</tr></thead>
        <tbody>{body.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{inlineMarkdown(cell)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function inlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="md-inline-code">{part.slice(1, -1)}</code>;
    return part;
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
      const saved = localStorage.getItem('nauryz-chats-v3');
      if (saved) {
        const parsed: Chat[] = JSON.parse(saved);
        const chatsWithDates = parsed.map(c => ({ ...c, createdAt: new Date(c.createdAt), messages: c.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) })) }));
        setChats(chatsWithDates);
        if (chatsWithDates.length > 0) { const last = chatsWithDates[chatsWithDates.length - 1]; setActiveChatId(last.id); setMessages(last.messages); }
      }
    } catch {}
  }, []);

  useEffect(() => { if (chats.length > 0) { try { localStorage.setItem('nauryz-chats-v3', JSON.stringify(chats)); } catch {} } }, [chats]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isLoading]);

  const createNewChat = () => {
    const id = Date.now().toString();
    const newChat: Chat = { id, title: 'Новый чат', messages: [], createdAt: new Date() };
    setChats(prev => [...prev, newChat]);
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

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.type.startsWith('video/')) { extractVideoFrames(file); return; }
    const reader = new FileReader();
    reader.onload = (ev) => { const d = ev.target?.result as string; setPendingImage({ data: d.split(',')[1], mediaType: file.type, preview: d }); };
    reader.readAsDataURL(file);
  };

  const extractVideoFrames = (file: File) => {
    setIsExtractingVideo(true);
    const videoUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = videoUrl; video.muted = true; video.playsInline = true;
    video.onloadedmetadata = async () => {
      if (video.duration > 20) { alert('Максимум 20 секунд.'); setIsExtractingVideo(false); URL.revokeObjectURL(videoUrl); return; }
      const canvas = document.createElement('canvas');
      canvas.width = 480; canvas.height = Math.round((480 * video.videoHeight) / video.videoWidth) || 360;
      const ctx = canvas.getContext('2d'); const frames: ImageData[] = [];
      const seekTo = (t: number) => new Promise<void>((resolve) => { video.currentTime = t; video.onseeked = () => resolve(); });
      try {
        for (let i = 0; i < 7; i++) {
          await seekTo(Math.min((video.duration * i) / 6, video.duration - 0.05));
          ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
          const d = canvas.toDataURL('image/jpeg', 0.7);
          frames.push({ data: d.split(',')[1], mediaType: 'image/jpeg', preview: d });
        }
        setPendingVideo({ frames, preview: videoUrl });
      } catch { URL.revokeObjectURL(videoUrl); } finally { setIsExtractingVideo(false); }
    };
    video.onerror = () => { setIsExtractingVideo(false); URL.revokeObjectURL(videoUrl); };
  };

  const startVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Голосовой ввод поддерживается только в Chrome.'); return; }
    const r = new SR(); r.lang = 'ru-RU'; r.continuous = false; r.interimResults = false;
    r.onresult = (e: any) => { setInput(e.results[0][0].transcript); setIsRecording(false); };
    r.onerror = () => setIsRecording(false); r.onend = () => setIsRecording(false);
    recognitionRef.current = r; r.start(); setIsRecording(true);
  };

  const stopVoice = () => { recognitionRef.current?.stop(); setIsRecording(false); };

  const sendMessage = useCallback(async (text?: string) => {
    const content = text || input.trim();
    if (!content && !pendingImage && !pendingVideo) return;

    let chatId = activeChatId;
    if (!chatId) {
      const id = Date.now().toString();
      const newChat: Chat = { id, title: content?.slice(0, 30) || 'Новый чат', messages: [], createdAt: new Date() };
      setChats(prev => [...prev, newChat]); setActiveChatId(id); chatId = id;
    }

    const userMsg: Message = {
      id: Date.now().toString(), role: 'user',
      content: content || (pendingVideo ? '🎥 Видео' : '📸 Фото'),
      image: pendingImage || undefined, frames: pendingVideo?.frames,
      videoPreview: pendingVideo?.preview, timestamp: new Date(),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages); setInput(''); setPendingImage(null); setPendingVideo(null); setIsLoading(true);
    if (messages.length === 0) setChats(prev => prev.map(c => c.id === chatId ? { ...c, title: content?.slice(0, 35) || 'Чат' } : c));

    const ac = new AbortController(); setAbortController(ac);

    let searchContext = '';
    if (searchMode && content) {
      try {
        const sr = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: content }), signal: ac.signal });
        if (sr.ok) { const sd = await sr.json(); searchContext = sd.result ? `\n\n[Из интернета]:\n${sd.result}` : ''; }
      } catch {}
    }

    const apiMessages = newMessages.map(m => ({
      role: m.role,
      content: m.role === 'user' && m.id === userMsg.id && searchContext ? (m.content + searchContext) : m.content,
      image: m.image, frames: m.frames,
    }));

    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: apiMessages }), signal: ac.signal });
      if (!res.ok) throw new Error('Ошибка сервера');
      const reader = res.body!.getReader(); const decoder = new TextDecoder();
      let assistantText = '';
      const assistantId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', timestamp: new Date() }]);
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        const mi = assistantText.indexOf('\n___COST___');
        const displayText = mi >= 0 ? assistantText.slice(0, mi) : assistantText;
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: displayText } : m));
      }
      const mi = assistantText.indexOf('\n___COST___');
      if (mi >= 0) {
        try {
          const { costUsd } = JSON.parse(assistantText.slice(mi + '\n___COST___'.length));
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, costUsd } : m));
          setSessionCost(prev => prev + costUsd);
        } catch {}
      }
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: [...newMessages, { id: assistantId, role: 'assistant' as const, content: assistantText.split('\n___COST___')[0], timestamp: new Date() }] } : c));
    } catch (err: any) {
      if (err.name !== 'AbortError') setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: '❌ Ошибка. Проверьте ANTHROPIC_API_KEY', timestamp: new Date() }]);
    } finally { setIsLoading(false); setAbortController(null); }
  }, [input, pendingImage, pendingVideo, messages, searchMode, activeChatId]);

  const stopGeneration = () => { abortController?.abort(); setIsLoading(false); };

  const calcResult = () => {
    const count = parseInt(calcCount) || 0; const days = parseInt(calcDays) || 1;
    const animal = FEED_ANIMALS[calcAnimal];
    return { totalKg: ((count * animal.perHead * days) / 1000).toFixed(1), perDay: ((count * animal.perHead) / 1000).toFixed(1), animal: animal.label };
  };

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #0e1a0a;
          --bg2: #121f0d;
          --bg3: #162410;
          --border: #1f3318;
          --border2: #2a4520;
          --green1: #4a7c3f;
          --green2: #6aaa5a;
          --green3: #8fd47a;
          --olive: #7a8c2a;
          --olive2: #a0b835;
          --text1: #d4e8c8;
          --text2: #8aaa7a;
          --text3: #4a6a3a;
          --accent: #5a9648;
        }
        html, body { height: 100%; overflow: hidden; }
        body { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text1); font-size: 14px; line-height: 1.6; }

        .layout { display: flex; height: 100dvh; }

        /* SIDEBAR */
        .sidebar { width: 248px; min-width: 248px; background: var(--bg2); border-right: 1px solid var(--border); display: flex; flex-direction: column; transition: width .22s, min-width .22s, opacity .22s; overflow: hidden; }
        .sidebar.closed { width: 0; min-width: 0; opacity: 0; }
        .sb-head { padding: 14px 12px 10px; border-bottom: 1px solid var(--border); }
        .sb-logo { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
        .sb-logo-icon { width: 34px; height: 34px; border-radius: 9px; background: linear-gradient(145deg, var(--green1), var(--olive)); display: flex; align-items: center; justify-content: center; font-size: 17px; flex-shrink: 0; }
        .sb-logo-text { font-size: 15px; font-weight: 700; color: var(--text1); letter-spacing: -.3px; }
        .sb-logo-sub { font-size: 10px; color: var(--text3); margin-top: 1px; }
        .new-btn { width: 100%; padding: 8px 12px; background: var(--bg3); border: 1px solid var(--border2); border-radius: 8px; color: var(--green3); cursor: pointer; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; transition: background .15s; white-space: nowrap; }
        .new-btn:hover { background: #1e3015; }
        .sb-list { flex: 1; overflow-y: auto; padding: 8px; }
        .sb-list::-webkit-scrollbar { width: 3px; } .sb-list::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
        .chat-item { display: flex; align-items: center; gap: 6px; padding: 8px 9px; border-radius: 7px; cursor: pointer; font-size: 12px; color: var(--text3); transition: all .15s; margin-bottom: 1px; border: 1px solid transparent; white-space: nowrap; }
        .chat-item:hover { background: var(--bg3); color: var(--text2); }
        .chat-item.active { background: #1a2e12; border-color: var(--border2); color: var(--text1); }
        .chat-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; }
        .chat-del { opacity: 0; background: none; border: none; color: var(--text3); cursor: pointer; font-size: 13px; padding: 2px 4px; border-radius: 4px; transition: opacity .15s, color .15s; flex-shrink: 0; }
        .chat-item:hover .chat-del { opacity: 1; } .chat-del:hover { color: #e57373; }
        .sb-footer { padding: 10px 12px; border-top: 1px solid var(--border); }
        .cost-pill { font-size: 11px; color: var(--text3); text-align: center; padding: 5px; background: var(--bg); border-radius: 6px; border: 1px solid var(--border); }

        /* MAIN */
        .main { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg); }

        .header { display: flex; align-items: center; gap: 10px; padding: 11px 16px; border-bottom: 1px solid var(--border); background: var(--bg2); }
        .toggle-sb { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 18px; padding: 4px; border-radius: 6px; transition: color .15s; line-height: 1; flex-shrink: 0; }
        .toggle-sb:hover { color: var(--green3); }
        .header-info .title { font-size: 14px; font-weight: 700; color: var(--text1); }
        .header-info .sub { font-size: 10px; color: var(--text3); }
        .header-right { margin-left: auto; display: flex; gap: 6px; align-items: center; }
        .icon-btn { width: 32px; height: 32px; border-radius: 7px; background: var(--bg3); border: 1px solid var(--border); color: var(--text2); cursor: pointer; font-size: 15px; display: flex; align-items: center; justify-content: center; transition: all .15s; }
        .icon-btn:hover { border-color: var(--border2); color: var(--green3); }

        .toolbar { display: flex; gap: 8px; align-items: center; padding: 7px 16px; border-bottom: 1px solid var(--border); background: var(--bg2); }
        .search-toggle { display: flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px; font-size: 11px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--text3); transition: all .15s; }
        .search-toggle.on { background: #1a2e12; border-color: var(--border2); color: var(--green3); }
        .toggle-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
        .session-cost { margin-left: auto; font-size: 11px; color: var(--text3); padding: 3px 8px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); }

        /* MESSAGES */
        .messages { flex: 1; overflow-y: auto; padding: 20px 16px; display: flex; flex-direction: column; gap: 18px; }
        .messages::-webkit-scrollbar { width: 4px; } .messages::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }

        /* WELCOME */
        .welcome { margin: auto; padding: 28px 16px; max-width: 520px; width: 100%; text-align: center; }
        .welcome-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; background: #1a2e12; border: 1px solid var(--border2); border-radius: 20px; font-size: 11px; color: var(--green3); margin-bottom: 18px; }
        .welcome-icon { font-size: 56px; margin-bottom: 12px; line-height: 1; }
        .welcome h1 { font-size: 26px; font-weight: 800; color: var(--text1); margin-bottom: 8px; letter-spacing: -.5px; }
        .welcome-desc { color: var(--text3); font-size: 13px; line-height: 1.7; margin-bottom: 22px; }
        .stats-row { display: flex; gap: 8px; justify-content: center; margin-bottom: 24px; flex-wrap: wrap; }
        .stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 9px 14px; display: flex; flex-direction: column; align-items: center; min-width: 72px; }
        .stat-n { font-size: 19px; font-weight: 700; color: var(--olive2); }
        .stat-l { font-size: 10px; color: var(--text3); margin-top: 1px; }
        .sug-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-bottom: 14px; }
        .sug-btn { background: var(--bg2); border: 1px solid var(--border); border-radius: 9px; padding: 9px 11px; cursor: pointer; text-align: left; font-size: 12px; color: var(--text2); display: flex; align-items: center; gap: 7px; transition: all .15s; }
        .sug-btn:hover { background: var(--bg3); border-color: var(--border2); color: var(--text1); transform: translateY(-1px); }
        .welcome-tip { font-size: 11px; color: var(--text3); padding: 9px 14px; background: var(--bg2); border: 1px dashed var(--border2); border-radius: 9px; }

        /* MESSAGES */
        .msg { display: flex; gap: 9px; max-width: 100%; }
        .msg.user { flex-direction: row-reverse; }
        .avatar { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; margin-top: 2px; }
        .avatar.ai { background: linear-gradient(145deg, var(--green1), var(--olive)); }
        .avatar.user { background: var(--bg3); border: 1px solid var(--border2); }
        .bubble-wrap { display: flex; flex-direction: column; max-width: 78%; }
        .msg.user .bubble-wrap { align-items: flex-end; }
        .bubble { padding: 11px 14px; border-radius: 14px; font-size: 13.5px; line-height: 1.65; word-break: break-word; }
        .bubble.ai { background: var(--bg2); border: 1px solid var(--border); border-radius: 14px 14px 14px 4px; }
        .bubble.user { background: #1c3614; border: 1px solid #2a4a1e; border-radius: 14px 14px 4px 14px; color: var(--text1); }
        .bubble img { max-width: 100%; border-radius: 8px; margin-bottom: 6px; display: block; }
        .msg-meta { font-size: 10px; color: var(--text3); margin-top: 3px; }
        .msg.user .msg-meta { text-align: right; }
        .msg-cost { color: var(--border2); }

        /* Markdown */
        .md-h1 { font-size: 17px; font-weight: 700; color: var(--text1); margin: 10px 0 7px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
        .md-h2 { font-size: 14px; font-weight: 700; color: var(--olive2); margin: 9px 0 5px; }
        .md-h3 { font-size: 13px; font-weight: 600; color: var(--green3); margin: 7px 0 4px; }
        .md-p { margin: 3px 0; color: var(--text1); }
        .md-hr { border: none; border-top: 1px solid var(--border); margin: 10px 0; }
        .md-ul, .md-ol { padding-left: 18px; margin: 4px 0; }
        .md-ul li, .md-ol li { margin: 2px 0; color: var(--text2); }
        .md-code { background: var(--bg); border: 1px solid var(--border); border-radius: 7px; padding: 9px 12px; font-family: 'Consolas', monospace; font-size: 12px; overflow-x: auto; margin: 6px 0; color: var(--green3); }
        .md-inline-code { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-family: 'Consolas', monospace; font-size: 12px; color: var(--olive2); }
        .md-spacer { height: 4px; }
        .md-table-wrap { overflow-x: auto; margin: 7px 0; border-radius: 8px; border: 1px solid var(--border); }
        .md-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .md-table th { background: var(--bg3); color: var(--olive2); padding: 7px 11px; text-align: left; font-weight: 600; border-bottom: 1px solid var(--border); }
        .md-table td { padding: 6px 11px; border-bottom: 1px solid var(--border); color: var(--text2); }
        .md-table tr:last-child td { border-bottom: none; }
        .md-table tr:hover td { background: var(--bg3); }

        /* Typing */
        .typing { display: flex; gap: 4px; padding: 4px 0; align-items: center; }
        .typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--green1); animation: bounce 1.2s infinite; }
        .typing span:nth-child(2) { animation-delay: .2s; } .typing span:nth-child(3) { animation-delay: .4s; }
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }

        /* Preview */
        .preview-bar { margin: 0 16px 6px; padding: 8px 12px; background: var(--bg2); border: 1px solid var(--border2); border-radius: 9px; display: flex; align-items: center; gap: 10px; }
        .preview-thumb { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; }
        .preview-label { flex: 1; font-size: 12px; color: var(--text2); }
        .preview-rm { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 16px; padding: 2px; }

        /* INPUT */
        .input-area { padding: 8px 16px 16px; }
        .input-box { display: flex; gap: 6px; align-items: flex-end; background: var(--bg2); border: 1px solid var(--border); border-radius: 13px; padding: 6px; transition: border-color .15s; }
        .input-box:focus-within { border-color: var(--border2); }
        .input-actions { display: flex; gap: 2px; flex-shrink: 0; }
        .inp-btn { width: 30px; height: 30px; border-radius: 6px; border: none; background: transparent; color: var(--text3); cursor: pointer; font-size: 15px; display: flex; align-items: center; justify-content: center; transition: all .15s; }
        .inp-btn:hover { color: var(--green3); background: var(--bg3); }
        .inp-btn.rec { color: #e57373; animation: pulse 1s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        textarea { flex: 1; background: none; border: none; color: var(--text1); font-size: 13.5px; resize: none; outline: none; font-family: inherit; line-height: 1.5; min-height: 30px; max-height: 120px; padding: 4px 4px; }
        textarea::placeholder { color: var(--text3); }
        .send-btn { width: 30px; height: 30px; border-radius: 7px; border: none; background: var(--accent); color: #fff; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; transition: background .15s; flex-shrink: 0; }
        .send-btn:hover { background: var(--green2); }
        .send-btn:disabled { background: var(--bg3); color: var(--text3); cursor: default; }
        .send-btn.stop { background: #7a2a2a; }

        /* Modal */
        .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 20px; }
        .modal { background: var(--bg2); border: 1px solid var(--border2); border-radius: 14px; padding: 20px; width: 100%; max-width: 340px; }
        .modal h2 { font-size: 15px; font-weight: 700; margin-bottom: 16px; color: var(--text1); }
        .field { margin-bottom: 11px; }
        .field label { display: block; font-size: 10px; color: var(--text3); margin-bottom: 4px; text-transform: uppercase; letter-spacing: .5px; }
        .field select, .field input { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text1); border-radius: 7px; padding: 7px 10px; font-size: 13px; outline: none; }
        .field select:focus, .field input:focus { border-color: var(--border2); }
        .calc-res { background: var(--bg); border: 1px solid var(--border2); border-radius: 9px; padding: 13px; margin: 12px 0; text-align: center; }
        .calc-big { font-size: 26px; font-weight: 700; color: var(--olive2); }
        .calc-sub { font-size: 11px; color: var(--text3); margin-top: 3px; }
        .modal-btns { display: flex; gap: 7px; margin-top: 4px; }
        .modal-btns button { flex: 1; padding: 8px; border-radius: 7px; border: none; cursor: pointer; font-size: 12px; font-weight: 600; }
        .btn-prim { background: var(--accent); color: #fff; } .btn-prim:hover { background: var(--green2); } .btn-prim:disabled { background: var(--bg3); color: var(--text3); cursor: default; }
        .btn-sec { background: var(--bg3); color: var(--text2); border: 1px solid var(--border) !important; }

        /* Mobile */
        @media (max-width: 767px) {
          .sidebar { position: fixed; z-index: 100; height: 100dvh; top: 0; left: 0; box-shadow: 4px 0 20px rgba(0,0,0,.5); }
          .sidebar.closed { width: 0; min-width: 0; }
          .sb-overlay { display: block; position: fixed; inset: 0; z-index: 99; background: rgba(0,0,0,.5); }
          .sug-grid { grid-template-columns: 1fr; }
          .bubble-wrap { max-width: 90%; }
          .messages { padding: 14px 12px; }
          .welcome { padding: 20px 12px; }
          .stats-row { gap: 6px; }
          .stat-card { padding: 7px 10px; min-width: 60px; }
        }
        @media (min-width: 768px) { .sb-overlay { display: none; } }
      `}</style>

      <div className="layout">
        {sidebarOpen && <div className="sb-overlay" onClick={() => setSidebarOpen(false)} />}

        <div className={`sidebar ${sidebarOpen ? '' : 'closed'}`}>
          <div className="sb-head">
            <div className="sb-logo">
              <div className="sb-logo-icon">🌾</div>
              <div>
                <div className="sb-logo-text">Nauryz AI</div>
                <div className="sb-logo-sub">Агро-ассистент</div>
              </div>
            </div>
            <button className="new-btn" onClick={createNewChat}>✏️ Новый чат</button>
          </div>

          <div className="sb-list">
            {chats.slice().reverse().map(chat => (
              <div key={chat.id} className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`} onClick={() => switchChat(chat.id)}>
                <span>💬</span>
                <span className="chat-item-title">{chat.title}</span>
                <button className="chat-del" onClick={(e) => deleteChat(chat.id, e)}>✕</button>
              </div>
            ))}
            {chats.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 11, padding: '12px 8px', textAlign: 'center' }}>Нет чатов</div>}
          </div>

          {sessionCost > 0 && <div className="sb-footer"><div className="cost-pill">💰 Сессия: ${sessionCost.toFixed(4)}</div></div>}
        </div>

        <div className="main">
          <div className="header">
            <button className="toggle-sb" onClick={() => setSidebarOpen(p => !p)}>☰</button>
            <div className="header-info">
              <div className="title">Nauryz AI</div>
              <div className="sub">Агро-ассистент для фермеров</div>
            </div>
            <div className="header-right">
              <button className="icon-btn" title="Калькулятор корма" onClick={() => setShowCalc(true)}>🧮</button>
            </div>
          </div>

          <div className="toolbar">
            <button className={`search-toggle ${searchMode ? 'on' : ''}`} onClick={() => setSearchMode(!searchMode)}>
              <span className="toggle-dot" />🌐 Поиск {searchMode ? 'ВКЛ' : 'ВЫКЛ'}
            </button>
            {sessionCost > 0 && <div className="session-cost">💰 ${sessionCost.toFixed(4)}</div>}
          </div>

          <div className="messages">
            {messages.length === 0 ? (
              <div className="welcome">
                <div className="welcome-badge">🇰🇿 Для фермеров Казахстана</div>
                <div className="welcome-icon">🌾</div>
                <h1>Nauryz AI</h1>
                <p className="welcome-desc">Задай вопрос о птицеводстве или прикрепи<br />фото — поставлю диагноз и назначу лечение</p>
                <div className="stats-row">
                  <div className="stat-card"><span className="stat-n">68</span><span className="stat-l">знаний</span></div>
                  <div className="stat-card"><span className="stat-n">40+</span><span className="stat-l">болезней</span></div>
                  <div className="stat-card"><span className="stat-n">📸</span><span className="stat-l">фото/видео</span></div>
                  <div className="stat-card"><span className="stat-n">3</span><span className="stat-l">языка</span></div>
                </div>
                <div className="sug-grid">
                  {SUGGESTIONS.map((s) => (
                    <button key={s.text} className="sug-btn" onClick={() => sendMessage(s.text)}>
                      <span>{s.icon}</span><span>{s.text}</span>
                    </button>
                  ))}
                </div>
                <div className="welcome-tip">💡 Прикрепи фото больного животного — поставлю диагноз и назначу конкретное лечение</div>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`msg ${msg.role}`}>
                  <div className={`avatar ${msg.role === 'assistant' ? 'ai' : 'user'}`}>
                    {msg.role === 'assistant' ? '🌾' : '👤'}
                  </div>
                  <div className="bubble-wrap">
                    <div className={`bubble ${msg.role === 'assistant' ? 'ai' : 'user'}`}>
                      {msg.videoPreview && <video src={msg.videoPreview} controls style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 6 }} />}
                      {msg.image && !msg.videoPreview && <img src={msg.image.preview} alt="фото" />}
                      {msg.role === 'assistant' ? (
                        msg.content === '' && isLoading ? <div className="typing"><span /><span /><span /></div> : renderMarkdown(msg.content)
                      ) : msg.content}
                    </div>
                    <div className="msg-meta">
                      {msg.timestamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      {msg.role === 'assistant' && typeof msg.costUsd === 'number' && <span className="msg-cost"> · ${msg.costUsd.toFixed(4)}</span>}
                    </div>
                  </div>
                </div>
              ))
            )}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="msg"><div className="avatar ai">🌾</div><div className="bubble ai"><div className="typing"><span /><span /><span /></div></div></div>
            )}
            <div ref={bottomRef} />
          </div>

          {pendingImage && <div className="preview-bar"><img src={pendingImage.preview} className="preview-thumb" alt="" /><span className="preview-label">📸 Фото прикреплено</span><button className="preview-rm" onClick={() => setPendingImage(null)}>✕</button></div>}
          {isExtractingVideo && <div className="preview-bar"><span className="preview-label">🎥 Обрабатываю видео...</span></div>}
          {pendingVideo && !isExtractingVideo && <div className="preview-bar"><video src={pendingVideo.preview} className="preview-thumb" muted /><span className="preview-label">🎥 Видео ({pendingVideo.frames.length} кадров)</span><button className="preview-rm" onClick={() => setPendingVideo(null)}>✕</button></div>}

          <div className="input-area">
            <div className="input-box">
              <div className="input-actions">
                <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleImage} />
                <button className="inp-btn" onClick={() => fileRef.current?.click()} title="Прикрепить фото/видео">📎</button>
                <button className={`inp-btn ${isRecording ? 'rec' : ''}`} onClick={isRecording ? stopVoice : startVoice} title="Голосовой ввод">{isRecording ? '🔴' : '🎤'}</button>
              </div>
              <textarea
                ref={textareaRef} value={input}
                onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Опиши проблему или прикрепи фото..." rows={1}
              />
              {isLoading
                ? <button className="send-btn stop" onClick={stopGeneration}>⏹</button>
                : <button className="send-btn" onClick={() => sendMessage()} disabled={!input.trim() && !pendingImage && !pendingVideo}>➤</button>}
            </div>
          </div>
        </div>
      </div>

      {showCalc && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setShowCalc(false)}>
          <div className="modal">
            <h2>🧮 Калькулятор корма</h2>
            <div className="field">
              <label>Вид птицы</label>
              <select value={calcAnimal} onChange={(e) => setCalcAnimal(Number(e.target.value))}>
                {FEED_ANIMALS.map((a, i) => <option key={a.label} value={i}>{a.label}</option>)}
              </select>
            </div>
            <div className="field"><label>Количество голов</label><input type="number" placeholder="100" value={calcCount} onChange={(e) => setCalcCount(e.target.value)} min="1" /></div>
            <div className="field"><label>Период (дней)</label><input type="number" value={calcDays} onChange={(e) => setCalcDays(e.target.value)} min="1" /></div>
            {calcCount && <div className="calc-res"><div className="calc-big">{calcResult().totalKg} кг</div><div className="calc-sub">{calcResult().animal} × {calcCount} гол × {calcDays} дн · {calcResult().perDay} кг/день</div></div>}
            <div className="modal-btns">
              <button className="btn-sec" onClick={() => setShowCalc(false)}>Закрыть</button>
              <button className="btn-prim" onClick={() => { setShowCalc(false); sendMessage(`Рассчитай рацион: ${calcResult().animal} ${calcCount} голов ${calcDays} дней = ${calcResult().totalKg} кг. Дай состав рациона.`); }} disabled={!calcCount}>Спросить AI</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
