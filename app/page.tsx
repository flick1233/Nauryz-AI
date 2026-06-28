'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface ImageData { data: string; mediaType: string; preview: string }

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: ImageData;
  frames?: ImageData[];
  videoPreview?: string;
  costUsd?: number;
  timestamp: Date;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}

const SUGGESTIONS = [
  { icon: '🐔', text: 'Курица хромает, что делать?' },
  { icon: '🐄', text: 'Корова не даёт молоко' },
  { icon: '🌾', text: 'Болезни пшеницы в Казахстане' },
  { icon: '💊', text: 'Норма корма для бройлеров' },
  { icon: '🌿', text: 'Признаки авитаминоза у кур' },
  { icon: '📋', text: 'Субсидии МСХ РК 2026' },
];

const FEED_ANIMALS = [
  { label: 'Бройлер', perHead: 120 },
  { label: 'Несушка', perHead: 110 },
  { label: 'Корова', perHead: 18000 },
  { label: 'Овца', perHead: 1500 },
  { label: 'Свинья', perHead: 2500 },
];

// Full markdown renderer
function renderMarkdown(text: string) {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Table detection
    if (i + 1 < lines.length && lines[i + 1].match(/^\|[-: |]+\|$/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      result.push(renderTable(tableLines, result.length));
      continue;
    }

    // H1
    if (line.startsWith('# ')) {
      result.push(<h1 key={i} className="md-h1">{inlineMarkdown(line.slice(2))}</h1>);
    }
    // H2
    else if (line.startsWith('## ')) {
      result.push(<h2 key={i} className="md-h2">{inlineMarkdown(line.slice(3))}</h2>);
    }
    // H3
    else if (line.startsWith('### ')) {
      result.push(<h3 key={i} className="md-h3">{inlineMarkdown(line.slice(4))}</h3>);
    }
    // HR
    else if (line.match(/^---+$/)) {
      result.push(<hr key={i} className="md-hr" />);
    }
    // Code block
    else if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      result.push(<pre key={i} className="md-code"><code>{codeLines.join('\n')}</code></pre>);
    }
    // Bullet list
    else if (line.match(/^[-*•] /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*•] /)) {
        items.push(lines[i].replace(/^[-*•] /, ''));
        i++;
      }
      result.push(
        <ul key={i} className="md-ul">
          {items.map((item, j) => <li key={j}>{inlineMarkdown(item)}</li>)}
        </ul>
      );
      continue;
    }
    // Numbered list
    else if (line.match(/^\d+\. /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(lines[i].replace(/^\d+\. /, ''));
        i++;
      }
      result.push(
        <ol key={i} className="md-ol">
          {items.map((item, j) => <li key={j}>{inlineMarkdown(item)}</li>)}
        </ol>
      );
      continue;
    }
    // Empty line
    else if (line.trim() === '') {
      result.push(<div key={i} className="md-spacer" />);
    }
    // Normal paragraph
    else {
      result.push(<p key={i} className="md-p">{inlineMarkdown(line)}</p>);
    }
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
        <thead>
          <tr>{header.map((cell, i) => <th key={i}>{inlineMarkdown(cell)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j}>{inlineMarkdown(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function inlineMarkdown(text: string): React.ReactNode {
  // Split by bold/italic/code patterns
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

  // Load chats from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nauryz-chats-v2');
      if (saved) {
        const parsed: Chat[] = JSON.parse(saved);
        const chatsWithDates = parsed.map(c => ({
          ...c,
          createdAt: new Date(c.createdAt),
          messages: c.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
        }));
        setChats(chatsWithDates);
        if (chatsWithDates.length > 0) {
          const last = chatsWithDates[chatsWithDates.length - 1];
          setActiveChatId(last.id);
          setMessages(last.messages);
        }
      }
    } catch {}
  }, []);

  // Save chats
  useEffect(() => {
    if (chats.length > 0) {
      try {
        localStorage.setItem('nauryz-chats-v2', JSON.stringify(chats));
      } catch {}
    }
  }, [chats]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const createNewChat = () => {
    const id = Date.now().toString();
    const newChat: Chat = { id, title: 'Новый чат', messages: [], createdAt: new Date() };
    setChats(prev => [...prev, newChat]);
    setActiveChatId(id);
    setMessages([]);
    setSessionCost(0);
  };

  const switchChat = (chatId: string) => {
    // Save current messages to current chat
    if (activeChatId) {
      setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, messages } : c));
    }
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
      setActiveChatId(chatId);
      setMessages(chat.messages);
      setSessionCost(0);
    }
  };

  const deleteChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (activeChatId === chatId) {
      setActiveChatId(null);
      setMessages([]);
    }
  };

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith('video/')) { extractVideoFrames(file); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setPendingImage({ data: dataUrl.split(',')[1], mediaType: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const extractVideoFrames = (file: File) => {
    const MAX_DURATION = 20;
    const FRAME_COUNT = 7;
    setIsExtractingVideo(true);
    const videoUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = async () => {
      if (video.duration > MAX_DURATION) {
        alert(`Видео слишком длинное (${Math.round(video.duration)}с). Максимум ${MAX_DURATION} секунд.`);
        setIsExtractingVideo(false);
        URL.revokeObjectURL(videoUrl);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = Math.round((480 * video.videoHeight) / video.videoWidth) || 360;
      const ctx = canvas.getContext('2d');
      const frames: ImageData[] = [];
      const seekTo = (t: number) => new Promise<void>((resolve) => { video.currentTime = t; video.onseeked = () => resolve(); });
      try {
        for (let i = 0; i < FRAME_COUNT; i++) {
          const t = (video.duration * i) / (FRAME_COUNT - 1 || 1);
          await seekTo(Math.min(t, Math.max(video.duration - 0.05, 0)));
          ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          frames.push({ data: dataUrl.split(',')[1], mediaType: 'image/jpeg', preview: dataUrl });
        }
        setPendingVideo({ frames, preview: videoUrl });
      } catch { alert('Не удалось обработать видео.'); URL.revokeObjectURL(videoUrl); }
      finally { setIsExtractingVideo(false); }
    };
    video.onerror = () => { alert('Не удалось загрузить видео.'); setIsExtractingVideo(false); URL.revokeObjectURL(videoUrl); };
  };

  const startVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Голосовой ввод поддерживается только в Chrome.'); return; }
    const r = new SR();
    r.lang = 'ru-RU'; r.continuous = false; r.interimResults = false;
    r.onresult = (e: any) => { setInput(e.results[0][0].transcript); setIsRecording(false); };
    r.onerror = () => setIsRecording(false);
    r.onend = () => setIsRecording(false);
    recognitionRef.current = r;
    r.start();
    setIsRecording(true);
  };

  const stopVoice = () => { recognitionRef.current?.stop(); setIsRecording(false); };

  const sendMessage = useCallback(async (text?: string, img?: ImageData) => {
    const content = text || input.trim();
    if (!content && !img && !pendingImage && !pendingVideo) return;

    // Create chat if none
    let chatId = activeChatId;
    if (!chatId) {
      const id = Date.now().toString();
      const newChat: Chat = { id, title: content?.slice(0, 30) || 'Новый чат', messages: [], createdAt: new Date() };
      setChats(prev => [...prev, newChat]);
      setActiveChatId(id);
      chatId = id;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: content || (pendingVideo ? '🎥 Видео отправлено' : '📸 Фото отправлено'),
      image: img || pendingImage || undefined,
      frames: pendingVideo?.frames,
      videoPreview: pendingVideo?.preview,
      timestamp: new Date(),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setPendingImage(null);
    setPendingVideo(null);
    setIsLoading(true);

    // Update chat title from first message
    if (messages.length === 0) {
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, title: content?.slice(0, 35) || 'Чат' } : c));
    }

    const ac = new AbortController();
    setAbortController(ac);

    let searchContext = '';
    if (searchMode && content) {
      try {
        const sr = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: content }), signal: ac.signal });
        if (sr.ok) { const sd = await sr.json(); searchContext = sd.result ? `\n\n[Актуальная информация из интернета]:\n${sd.result}` : ''; }
      } catch {}
    }

    const apiMessages = newMessages.map((m) => ({
      role: m.role,
      content: m.role === 'user' && m.id === userMsg.id && searchContext ? (m.content + searchContext) : m.content,
      image: m.image,
      frames: m.frames,
    }));

    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: apiMessages }), signal: ac.signal });
      if (!res.ok) throw new Error('Ошибка сервера');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      const assistantId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', timestamp: new Date() }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        const markerIndex = assistantText.indexOf('\n___COST___');
        const displayText = markerIndex >= 0 ? assistantText.slice(0, markerIndex) : assistantText;
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: displayText } : m));
      }

      const markerIndex = assistantText.indexOf('\n___COST___');
      if (markerIndex >= 0) {
        try {
          const { costUsd } = JSON.parse(assistantText.slice(markerIndex + '\n___COST___'.length));
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, costUsd } : m));
          setSessionCost(prev => prev + costUsd);
        } catch {}
      }

      // Save to chat
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: [...newMessages, { id: assistantId, role: 'assistant' as const, content: assistantText.split('\n___COST___')[0], timestamp: new Date() }] } : c));

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: '❌ Ошибка подключения. Проверьте ANTHROPIC_API_KEY в .env.local', timestamp: new Date() }]);
      }
    } finally {
      setIsLoading(false);
      setAbortController(null);
    }
  }, [input, pendingImage, pendingVideo, messages, searchMode, activeChatId]);

  const stopGeneration = () => { abortController?.abort(); setIsLoading(false); };

  const calcResult = () => {
    const count = parseInt(calcCount) || 0;
    const days = parseInt(calcDays) || 1;
    const animal = FEED_ANIMALS[calcAnimal];
    const totalG = count * animal.perHead * days;
    return { totalKg: (totalG / 1000).toFixed(1), perDay: ((count * animal.perHead) / 1000).toFixed(1), animal: animal.label };
  };

  const sendCalcToChat = () => {
    const r = calcResult();
    setShowCalc(false);
    sendMessage(`Рассчитай норму корма: ${r.animal} × ${calcCount} голов × ${calcDays} дней = ${r.totalKg} кг (${r.perDay} кг/день). Дай рекомендации по составу рациона.`);
  };

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; background: #0a1410; color: #e2f0dc; }

        .layout { display: flex; height: 100dvh; overflow: hidden; }

        /* ── SIDEBAR ── */
        .sidebar {
          width: 260px; min-width: 260px; background: #0d1a0f;
          border-right: 1px solid #1e3322; display: flex; flex-direction: column;
          transition: width 0.25s, min-width 0.25s;
        }
        .sidebar.closed { width: 0; min-width: 0; overflow: hidden; }
        .sidebar-header {
          padding: 16px; border-bottom: 1px solid #1e3322;
          display: flex; align-items: center; justify-content: space-between;
        }
        .sidebar-logo { display: flex; align-items: center; gap: 8px; }
        .sidebar-logo-icon {
          width: 32px; height: 32px; border-radius: 8px;
          background: linear-gradient(135deg, #27673a, #4caf65);
          display: flex; align-items: center; justify-content: center; font-size: 16px;
        }
        .sidebar-logo-text { font-size: 15px; font-weight: 700; color: #c8e6cc; }
        .new-chat-btn {
          width: 100%; margin: 10px 0 6px; padding: 9px 14px;
          background: #1a2e1c; border: 1px solid #2a4a2e; border-radius: 8px;
          color: #7dc882; cursor: pointer; font-size: 13px; font-weight: 600;
          display: flex; align-items: center; gap: 6px; transition: background 0.15s;
        }
        .new-chat-btn:hover { background: #223824; }
        .sidebar-list { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
        .sidebar-list::-webkit-scrollbar { width: 3px; }
        .sidebar-list::-webkit-scrollbar-thumb { background: #2a4a2e; border-radius: 3px; }
        .chat-item {
          display: flex; align-items: center; gap: 6px;
          padding: 9px 10px; border-radius: 8px; cursor: pointer;
          font-size: 13px; color: #7a9e80; transition: all 0.15s; margin-bottom: 2px;
          border: 1px solid transparent;
        }
        .chat-item:hover { background: #151f16; color: #b0d4b4; }
        .chat-item.active { background: #1a2e1e; border-color: #2a4a30; color: #c8e6cc; }
        .chat-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .chat-item-del {
          opacity: 0; background: none; border: none; color: #5a7a60;
          cursor: pointer; font-size: 14px; padding: 2px 4px; border-radius: 4px;
          transition: opacity 0.15s, color 0.15s;
        }
        .chat-item:hover .chat-item-del { opacity: 1; }
        .chat-item-del:hover { color: #e57373; }
        .sidebar-footer { padding: 12px; border-top: 1px solid #1e3322; }
        .cost-badge {
          font-size: 11px; color: #4a6e50; padding: 5px 10px;
          background: #111a12; border-radius: 6px; border: 1px solid #1e3322;
          text-align: center;
        }

        /* ── MAIN ── */
        .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

        .header {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 18px; border-bottom: 1px solid #1e3322;
          background: #0a1410;
        }
        .sidebar-toggle {
          background: none; border: none; color: #5a8a60; cursor: pointer;
          font-size: 18px; padding: 4px 6px; border-radius: 6px; transition: color 0.15s;
        }
        .sidebar-toggle:hover { color: #90ee90; }
        .header-title { font-size: 15px; font-weight: 700; color: #c8e6cc; }
        .header-sub { font-size: 11px; color: #4a6e50; }
        .header-actions { margin-left: auto; display: flex; gap: 6px; }
        .btn-icon {
          background: #151f16; border: 1px solid #243824; color: #6a9e70;
          width: 34px; height: 34px; border-radius: 8px; cursor: pointer; font-size: 15px;
          display: flex; align-items: center; justify-content: center; transition: all 0.15s;
        }
        .btn-icon:hover { background: #1e2e1e; color: #90ee90; }

        /* Toolbar */
        .toolbar {
          display: flex; gap: 8px; padding: 8px 18px;
          border-bottom: 1px solid #141e15; background: #0c1810;
        }
        .toggle-btn {
          display: flex; align-items: center; gap: 5px;
          padding: 5px 11px; border-radius: 20px; font-size: 12px;
          cursor: pointer; border: 1px solid #243824; background: transparent;
          color: #4a6e50; transition: all 0.15s;
        }
        .toggle-btn.on { background: #1a3520; border-color: #3a7040; color: #7dc882; }
        .toggle-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
        .session-cost {
          margin-left: auto; font-size: 11px; color: #4a6e50;
          padding: 5px 9px; background: #0e1810; border-radius: 16px;
          border: 1px solid #1a2e1a;
        }

        /* Messages */
        .messages { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 20px; }
        .messages::-webkit-scrollbar { width: 4px; }
        .messages::-webkit-scrollbar-thumb { background: #243824; border-radius: 4px; }

        /* Welcome */
        .welcome { text-align: center; margin: auto; padding: 40px 20px; max-width: 500px; }
        .welcome-icon { font-size: 56px; margin-bottom: 16px; }
        .welcome h1 { font-size: 24px; font-weight: 700; color: #c8e6cc; margin-bottom: 8px; }
        .welcome p { color: #4a7050; font-size: 14px; margin-bottom: 28px; line-height: 1.6; }
        .suggestions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .suggestion {
          background: #0f1a10; border: 1px solid #1e3322; border-radius: 10px;
          padding: 10px 13px; cursor: pointer; text-align: left; font-size: 13px;
          color: #7a9e80; transition: all 0.15s; display: flex; align-items: center; gap: 8px;
        }
        .suggestion:hover { background: #151f16; border-color: #2a4a2e; color: #b0d4b4; }

        /* Bubbles */
        .msg { display: flex; gap: 10px; }
        .msg.user { flex-direction: row-reverse; }
        .avatar {
          width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center; font-size: 14px;
          margin-top: 2px;
        }
        .avatar.ai { background: linear-gradient(135deg, #27673a, #4caf65); }
        .avatar.user { background: #1e3322; }
        .bubble-wrap { display: flex; flex-direction: column; max-width: 78%; }
        .msg.user .bubble-wrap { align-items: flex-end; }
        .bubble {
          padding: 12px 16px; border-radius: 14px;
          font-size: 14px; line-height: 1.65; word-break: break-word;
        }
        .bubble.ai { background: #111c12; border: 1px solid #1e3322; border-radius: 14px 14px 14px 4px; }
        .bubble.user { background: #1a4020; border: 1px solid #2a5e30; border-radius: 14px 14px 4px 14px; }
        .bubble img { max-width: 100%; border-radius: 8px; margin-bottom: 8px; display: block; }
        .msg-time { font-size: 10px; color: #354e38; margin-top: 4px; }
        .msg.user .msg-time { text-align: right; }
        .msg-cost { color: #2e4e34; }

        /* Markdown styles */
        .md-h1 { font-size: 18px; font-weight: 700; color: #a8d8ac; margin: 10px 0 8px; border-bottom: 1px solid #1e3322; padding-bottom: 6px; }
        .md-h2 { font-size: 15px; font-weight: 700; color: #90c894; margin: 10px 0 6px; }
        .md-h3 { font-size: 14px; font-weight: 600; color: #7ab87e; margin: 8px 0 4px; }
        .md-p { margin: 3px 0; }
        .md-hr { border: none; border-top: 1px solid #1e3322; margin: 10px 0; }
        .md-ul, .md-ol { padding-left: 18px; margin: 4px 0; }
        .md-ul li, .md-ol li { margin: 3px 0; color: #a0c4a4; }
        .md-code { background: #0a120b; border: 1px solid #1e3322; border-radius: 8px; padding: 10px 14px; font-family: 'Consolas', monospace; font-size: 13px; overflow-x: auto; margin: 6px 0; color: #7dc882; }
        .md-inline-code { background: #0d1a0e; border: 1px solid #1e3322; border-radius: 4px; padding: 1px 5px; font-family: 'Consolas', monospace; font-size: 12px; color: #7dc882; }
        .md-spacer { height: 5px; }
        .md-table-wrap { overflow-x: auto; margin: 8px 0; border-radius: 8px; border: 1px solid #1e3322; }
        .md-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .md-table th { background: #141e15; color: #90c894; padding: 8px 12px; text-align: left; font-weight: 600; border-bottom: 1px solid #1e3322; }
        .md-table td { padding: 7px 12px; border-bottom: 1px solid #141e15; color: #9ab89e; }
        .md-table tr:last-child td { border-bottom: none; }
        .md-table tr:hover td { background: #111c12; }

        /* Typing */
        .typing { display: flex; gap: 4px; padding: 4px 0; }
        .typing span { width: 7px; height: 7px; border-radius: 50%; background: #3a7040; animation: bounce 1.2s infinite; }
        .typing span:nth-child(2) { animation-delay: 0.2s; }
        .typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }

        /* Preview */
        .img-preview {
          margin: 0 18px 8px; padding: 9px 12px; background: #0f1a10;
          border: 1px solid #2a4a30; border-radius: 10px;
          display: flex; align-items: center; gap: 10px;
        }
        .img-preview img, .preview-thumb-video { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; }
        .img-preview span { font-size: 13px; color: #6a9e70; flex: 1; }
        .img-preview button { background: none; border: none; color: #4a6e50; cursor: pointer; font-size: 17px; }
        .msg-video { max-width: 100%; border-radius: 8px; margin-bottom: 8px; display: block; }

        /* Input */
        .input-area { padding: 10px 18px 18px; background: #0a1410; border-top: 1px solid #141e15; }
        .input-row {
          display: flex; gap: 6px; align-items: flex-end;
          background: #0f1a10; border: 1px solid #243824; border-radius: 14px; padding: 7px;
          transition: border-color 0.15s;
        }
        .input-row:focus-within { border-color: #3a7040; }
        .input-actions { display: flex; gap: 3px; }
        .input-btn {
          width: 32px; height: 32px; border-radius: 7px; border: none;
          background: transparent; color: #4a6e50; cursor: pointer; font-size: 16px;
          display: flex; align-items: center; justify-content: center; transition: all 0.15s;
        }
        .input-btn:hover { color: #7dc882; background: #151f16; }
        .input-btn.recording { color: #e57373; animation: pulse 1s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        textarea {
          flex: 1; background: none; border: none; color: #e2f0dc; font-size: 14px;
          resize: none; outline: none; font-family: inherit; line-height: 1.5;
          min-height: 32px; max-height: 120px; padding: 5px 4px;
        }
        textarea::placeholder { color: #2e4e38; }
        .send-btn {
          width: 32px; height: 32px; border-radius: 7px; border: none;
          background: #27673a; color: white; cursor: pointer; font-size: 16px;
          display: flex; align-items: center; justify-content: center; transition: background 0.15s;
        }
        .send-btn:hover { background: #337a46; }
        .send-btn:disabled { background: #151f16; color: #2e4e38; cursor: default; }
        .send-btn.stop { background: #6a2d2d; }

        /* Modal */
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.75);
          display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px;
        }
        .modal {
          background: #0f1a10; border: 1px solid #243824; border-radius: 16px;
          padding: 22px; width: 100%; max-width: 360px;
        }
        .modal h2 { font-size: 16px; font-weight: 700; margin-bottom: 18px; color: #c8e6cc; }
        .field { margin-bottom: 12px; }
        .field label { display: block; font-size: 11px; color: #4a6e50; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px; }
        .field select, .field input {
          width: 100%; background: #0a1410; border: 1px solid #243824;
          color: #e2f0dc; border-radius: 8px; padding: 8px 11px; font-size: 14px; outline: none;
        }
        .field select:focus, .field input:focus { border-color: #3a7040; }
        .calc-result {
          background: #0a1410; border: 1px solid #2a4a30; border-radius: 10px;
          padding: 14px; margin: 14px 0; text-align: center;
        }
        .calc-result .big { font-size: 28px; font-weight: 700; color: #7dc882; }
        .calc-result .sub { font-size: 12px; color: #4a6e50; margin-top: 4px; }
        .modal-actions { display: flex; gap: 8px; margin-top: 4px; }
        .modal-actions button {
          flex: 1; padding: 9px; border-radius: 8px; border: none;
          cursor: pointer; font-size: 13px; font-weight: 600;
        }
        .btn-primary { background: #27673a; color: white; }
        .btn-primary:hover { background: #337a46; }
        .btn-primary:disabled { background: #1a2e1c; color: #3a5a3e; cursor: default; }
        .btn-secondary { background: #151f16; color: #7a9e80; border: 1px solid #243824 !important; }

        @media (max-width: 640px) {
          .sidebar { position: fixed; z-index: 50; height: 100dvh; top: 0; left: 0; }
          .sidebar.closed { width: 0; }
          .suggestions { grid-template-columns: 1fr; }
          .bubble-wrap { max-width: 90%; }
          .messages { padding: 14px 16px; }
        }
      `}</style>

      <div className="layout">
        {/* Sidebar */}
        <div className={`sidebar ${sidebarOpen ? '' : 'closed'}`}>
          <div className="sidebar-header">
            <div className="sidebar-logo">
              <div className="sidebar-logo-icon">🌾</div>
              <span className="sidebar-logo-text">Nauryz AI</span>
            </div>
          </div>
          <div style={{ padding: '0 8px' }}>
            <button className="new-chat-btn" onClick={createNewChat}>
              ✏️ Новый чат
            </button>
          </div>
          <div className="sidebar-list">
            {chats.slice().reverse().map(chat => (
              <div
                key={chat.id}
                className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`}
                onClick={() => switchChat(chat.id)}
              >
                <span style={{ fontSize: 14 }}>💬</span>
                <span className="chat-item-title">{chat.title}</span>
                <button className="chat-item-del" onClick={(e) => deleteChat(chat.id, e)}>✕</button>
              </div>
            ))}
            {chats.length === 0 && (
              <div style={{ color: '#2e4e38', fontSize: 12, padding: '12px 10px', textAlign: 'center' }}>
                Нет чатов
              </div>
            )}
          </div>
          {sessionCost > 0 && (
            <div className="sidebar-footer">
              <div className="cost-badge">💰 Сессия: ${sessionCost.toFixed(4)}</div>
            </div>
          )}
        </div>

        {/* Main */}
        <div className="main">
          <div className="header">
            <button className="sidebar-toggle" onClick={() => setSidebarOpen(p => !p)}>☰</button>
            <div>
              <div className="header-title">Nauryz AI</div>
              <div className="header-sub">Агро-ассистент для фермеров</div>
            </div>
            <div className="header-actions">
              <button className="btn-icon" title="Калькулятор корма" onClick={() => setShowCalc(true)}>🧮</button>
            </div>
          </div>

          <div className="toolbar">
            <button className={`toggle-btn ${searchMode ? 'on' : ''}`} onClick={() => setSearchMode(!searchMode)}>
              <span className="toggle-dot" />
              🌐 Поиск {searchMode ? 'ВКЛ' : 'ВЫКЛ'}
            </button>
            {sessionCost > 0 && <div className="session-cost">💰 ${sessionCost.toFixed(4)}</div>}
          </div>

          <div className="messages">
            {messages.length === 0 ? (
              <div className="welcome">
                <div className="welcome-icon">🌿</div>
                <h1>Привет! Я Nauryz AI</h1>
                <p>Задай вопрос о животных или растениях.<br />Прикрепи фото или видео — поставлю диагноз.</p>
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s.text} className="suggestion" onClick={() => sendMessage(s.text)}>
                      <span>{s.icon}</span><span>{s.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`msg ${msg.role}`}>
                  <div className={`avatar ${msg.role === 'assistant' ? 'ai' : 'user'}`}>
                    {msg.role === 'assistant' ? '🌾' : '👤'}
                  </div>
                  <div className="bubble-wrap">
                    <div className={`bubble ${msg.role === 'assistant' ? 'ai' : 'user'}`}>
                      {msg.videoPreview && <video src={msg.videoPreview} controls className="msg-video" />}
                      {msg.image && !msg.videoPreview && <img src={msg.image.preview} alt="фото" />}
                      {msg.role === 'assistant' ? (
                        msg.content === '' && isLoading ? (
                          <div className="typing"><span /><span /><span /></div>
                        ) : (
                          renderMarkdown(msg.content)
                        )
                      ) : msg.content}
                    </div>
                    <div className="msg-time">
                      {msg.timestamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      {msg.role === 'assistant' && typeof msg.costUsd === 'number' && (
                        <span className="msg-cost"> · ${msg.costUsd.toFixed(4)}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="msg">
                <div className="avatar ai">🌾</div>
                <div className="bubble ai"><div className="typing"><span /><span /><span /></div></div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {pendingImage && (
            <div className="img-preview">
              <img src={pendingImage.preview} alt="preview" />
              <span>📸 Фото прикреплено</span>
              <button onClick={() => setPendingImage(null)}>✕</button>
            </div>
          )}
          {isExtractingVideo && <div className="img-preview"><span>🎥 Обрабатываю видео...</span></div>}
          {pendingVideo && !isExtractingVideo && (
            <div className="img-preview">
              <video src={pendingVideo.preview} className="preview-thumb-video" muted />
              <span>🎥 Видео прикреплено ({pendingVideo.frames.length} кадров)</span>
              <button onClick={() => setPendingVideo(null)}>✕</button>
            </div>
          )}

          <div className="input-area">
            <div className="input-row">
              <div className="input-actions">
                <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleImage} />
                <button className="input-btn" onClick={() => fileRef.current?.click()} title="Фото/видео">📎</button>
                <button className={`input-btn ${isRecording ? 'recording' : ''}`} onClick={isRecording ? stopVoice : startVoice} title="Голос">
                  {isRecording ? '🔴' : '🎤'}
                </button>
              </div>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Опиши проблему или прикрепи фото..."
                rows={1}
              />
              {isLoading ? (
                <button className="send-btn stop" onClick={stopGeneration}>⏹</button>
              ) : (
                <button className="send-btn" onClick={() => sendMessage()} disabled={!input.trim() && !pendingImage && !pendingVideo}>➤</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showCalc && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowCalc(false)}>
          <div className="modal">
            <h2>🧮 Калькулятор корма</h2>
            <div className="field">
              <label>Вид животного</label>
              <select value={calcAnimal} onChange={(e) => setCalcAnimal(Number(e.target.value))}>
                {FEED_ANIMALS.map((a, i) => <option key={a.label} value={i}>{a.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Количество голов</label>
              <input type="number" placeholder="100" value={calcCount} onChange={(e) => setCalcCount(e.target.value)} min="1" />
            </div>
            <div className="field">
              <label>Период (дней)</label>
              <input type="number" value={calcDays} onChange={(e) => setCalcDays(e.target.value)} min="1" />
            </div>
            {calcCount && (
              <div className="calc-result">
                <div className="big">{calcResult().totalKg} кг</div>
                <div className="sub">{calcResult().animal} × {calcCount} гол × {calcDays} дн · {calcResult().perDay} кг/день</div>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowCalc(false)}>Закрыть</button>
              <button className="btn-primary" onClick={sendCalcToChat} disabled={!calcCount}>Спросить AI</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
