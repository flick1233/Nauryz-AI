'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Menu, Plus, Camera, Mic, Send, X, Square, Globe, Calculator, ChevronLeft, Sun, Moon } from 'lucide-react';
import './nauryz.css';

interface ImageData { data: string; mediaType: string; preview: string }
type Severity = 'low' | 'medium' | 'high' | 'critical';
interface Cause { name: string; pct: number; severity: Severity }
interface DiagnosisData {
  inspection: string; symptoms: string[]; causes: Cause[];
  homeCare: string[]; recommendations: string[]; needsVet: boolean;
}
interface ClarifyGroup { heading: string; itemsText: string }
interface ClarifyData { title: string; intro: string; groups: ClarifyGroup[]; causesPreview: string[]; closing: string }
interface Message {
  id: string; role: 'user' | 'assistant'; content: string;
  image?: ImageData; frames?: ImageData[]; videoPreview?: string;
  diagnosis?: DiagnosisData;
  clarify?: ClarifyData;
  isCalcCard?: boolean;
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
  { id: 'lame', emoji: '🐔', text: 'Курица хромает, что делать?', textKk: 'Тауық ақсайды, не істеу керек?' },
  { id: 'eggs', emoji: '🥚', text: 'Куры перестали нести яйца', textKk: 'Тауықтар жұмыртқа баспай қалды' },
  { id: 'feed', emoji: '💊', text: 'Норма корма для бройлеров', textKk: 'Бройлерге жем нормасы' },
  { id: 'vitamin', emoji: '🌿', text: 'Признаки авитаминоза у кур', textKk: 'Тауықтардағы авитаминоз белгілері' },
  { id: 'newcastle', emoji: '🦠', text: 'Болезнь Ньюкасла — симптомы', textKk: 'Ньюкасл ауруы — белгілері' },
  { id: 'subsidy', emoji: '📋', text: 'Субсидии МСХ РК 2026', textKk: 'ҚР АШМ субсидиялары 2026' },
  { id: 'bizplan', emoji: '🌾', text: 'Бизнес-план птицефабрики', textKk: 'Құс фабрикасының бизнес-жоспары' },
  { id: 'breeding', emoji: '🔬', text: 'Селекция бройлеров — кроссы', textKk: 'Бройлер селекциясы — кросстар' },
];

// Инлайн-калькулятор в чате (клик на "Норма корма для бройлеров") — design_handoff README.
const AGE_GROUPS = [
  { id: 'd1', label: '1–7 дней', min: 15, max: 20, protein: '22–24%' },
  { id: 'd2', label: '8–21 день', min: 40, max: 60, protein: '20–22%' },
  { id: 'd3', label: '22–35 дней', min: 80, max: 120, protein: '18–20%' },
  { id: 'd4', label: '36+ дней', min: 130, max: 160, protein: '16–18%' },
];

// Полноценный калькулятор (кнопка "⚖️ Калькулятор" в шапке).
type BirdType = 'broiler' | 'layer' | 'young';
const BIRD_TYPE_IDS: BirdType[] = ['broiler', 'layer', 'young'];
function feedCalcRange(birdType: BirdType, ageValue: number, ageUnit: 'days' | 'weeks') {
  const ageDays = ageUnit === 'weeks' ? ageValue * 7 : ageValue;
  if (birdType === 'layer') return { min: 110, max: 120 };
  if (birdType === 'young') {
    if (ageDays <= 28) return { min: 10, max: 20 };
    if (ageDays <= 56) return { min: 30, max: 50 };
    if (ageDays <= 112) return { min: 50, max: 70 };
    return { min: 70, max: 90 };
  }
  if (ageDays <= 7) return { min: 15, max: 20 };
  if (ageDays <= 21) return { min: 40, max: 60 };
  if (ageDays <= 35) return { min: 80, max: 120 };
  return { min: 130, max: 160 };
}
function fmtRu(n: number) { return (Math.round(n * 10) / 10).toString().replace('.', ','); }

const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_KK = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];
function formatChatDate(d: Date, lang: 'ru' | 'kk') {
  const now = new Date();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const today = lang === 'kk' ? 'Бүгін' : 'Сегодня';
  const yesterdayLabel = lang === 'kk' ? 'Кеше' : 'Вчера';
  if (sameDay(d, now)) return `${today}, ${time}`;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `${yesterdayLabel}, ${time}`;
  const months = lang === 'kk' ? MONTHS_KK : MONTHS_RU;
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

// design_handoff_nauryz_ai/README.md — "переключатель ҚАЗ/RU для UI-подписей... глубокий
// контент (диагнозы/рекомендации) пока остаётся только на русском — осознанное ограничение".
interface UiDict {
  subtitle: string; emptyHeading: string; emptySubtitle: string;
  inputPlaceholder: string; recording: string; photoBtn: string; voiceBtn: string;
  ariaHideHistory: string; ariaShowHistory: string; ariaClose: string; ariaRemove: string; ariaStop: string; ariaSend: string; ariaDeleteChat: string; ariaTheme: string;
  newChat: string; newChatTitle: string; chatFallback: string; historySection: string; noChats: string; farmer: string;
  searchOn: string; searchOff: string; feedCalcBtn: string;
  tagInspection: string; tagSymptoms: string; tagCauses: string; detailBtn: string; tagClarify: string; probableDirections: string;
  diagnosisTitle: string; causesHeading: string; homeCareHeading: string; vetHeading: string; doneSaveBtn: string;
  inlineCalcTitle: string; calcAgeLabel: string; calcHeadsLabel: string; calcResultPrefix: string; calcProteinLabel: string; calcWaterNote: string; calcHeadsShort: string;
  feedCalcTitle: string; birdTypeLabel: string; ageLabel: string; headsLabel: string; priceLabel: string; pricePlaceholder: string;
  resultLabel: string; perHeadSub: string; dailySub: string; monthlySub: string; costSub: string; waterSub: string; doneBtn: string;
  birdBroiler: string; birdLayer: string; birdYoung: string; unitDays: string; unitWeeks: string;
  analyzingTitle: string; analyzingCaption: string;
  langToggle: string;
}

const UI: Record<'ru' | 'kk', UiDict> = {
  ru: {
    subtitle: 'Агро-ассистент', emptyHeading: 'Сәлем! Чем помочь?', emptySubtitle: 'Задай вопрос о птицеводстве или прикрепи фото курицы/птичника — поставлю диагноз и подскажу решение',
    inputPlaceholder: 'Опиши проблему или задай вопрос…', recording: 'Запись…', photoBtn: 'Фото', voiceBtn: 'Голос',
    ariaHideHistory: 'Скрыть историю', ariaShowHistory: 'Показать историю', ariaClose: 'Закрыть', ariaRemove: 'Убрать', ariaStop: 'Остановить', ariaSend: 'Отправить', ariaDeleteChat: 'Удалить чат', ariaTheme: 'Тема',
    newChat: 'Новый чат', newChatTitle: 'Новый чат', chatFallback: 'Чат', historySection: 'История', noChats: 'Нет чатов', farmer: 'Фермер',
    searchOn: 'Поиск ВКЛ', searchOff: 'Поиск ВЫКЛ', feedCalcBtn: 'Калькулятор нормы корма',
    tagInspection: 'Осмотр', tagSymptoms: 'Симптомы', tagCauses: 'Вероятные причины', detailBtn: 'Подробный разбор →', tagClarify: 'Уточняющие вопросы', probableDirections: '⚠️ Вероятные направления',
    diagnosisTitle: 'Результат диагностики', causesHeading: 'Возможные причины', homeCareHeading: '🏠 Лечение в домашних условиях', vetHeading: 'Когда обращаться к ветеринару', doneSaveBtn: 'Понятно, сохранить в историю',
    inlineCalcTitle: '🧮 Калькулятор корма для бройлеров', calcAgeLabel: 'Возраст птицы', calcHeadsLabel: 'Поголовье (голов)', calcResultPrefix: 'Суточная норма для', calcProteinLabel: 'Белок в корме:', calcWaterNote: 'Вода нужна примерно вдвое больше объёма корма, особенно в жару.', calcHeadsShort: 'гол.',
    feedCalcTitle: 'Калькулятор нормы корма', birdTypeLabel: 'Тип птицы', ageLabel: 'Возраст', headsLabel: 'Количество голов', priceLabel: 'Цена корма за кг, ₸ (необязательно)', pricePlaceholder: 'Например, 250',
    resultLabel: 'Результат', perHeadSub: 'на голову в сутки', dailySub: 'кг/сутки на всё стадо', monthlySub: 'кг в месяц', costSub: 'в месяц на корм', waterSub: 'Ориентировочный расход воды в сутки', doneBtn: 'Готово',
    birdBroiler: 'Бройлер', birdLayer: 'Несушка', birdYoung: 'Молодняк', unitDays: 'Дни', unitWeeks: 'Недели',
    analyzingTitle: '📸 Анализирую фото…', analyzingCaption: 'Определяю симптомы по изображению…',
    langToggle: 'ҚАЗ',
  },
  kk: {
    subtitle: 'Агро-көмекші', emptyHeading: 'Сәлем! Немен көмектесейін?', emptySubtitle: 'Құс шаруашылығы туралы сұрақ қой немесе тауық/құсхананың фотосын тіркеп жібер — диагноз қоямын және шешім айтамын',
    inputPlaceholder: 'Мәселені сипаттаңыз немесе сұрақ қойыңыз…', recording: 'Жазылуда…', photoBtn: 'Фото', voiceBtn: 'Дауыс',
    ariaHideHistory: 'Тарихты жасыру', ariaShowHistory: 'Тарихты көрсету', ariaClose: 'Жабу', ariaRemove: 'Алып тастау', ariaStop: 'Тоқтату', ariaSend: 'Жіберу', ariaDeleteChat: 'Чатты жою', ariaTheme: 'Тақырып',
    newChat: 'Жаңа чат', newChatTitle: 'Жаңа чат', chatFallback: 'Чат', historySection: 'Тарих', noChats: 'Чаттар жоқ', farmer: 'Фермер',
    searchOn: 'Іздеу ҚОСУЛЫ', searchOff: 'Іздеу ӨШІРУЛІ', feedCalcBtn: 'Жем нормасының калькуляторы',
    tagInspection: 'Қарау', tagSymptoms: 'Белгілер', tagCauses: 'Ықтимал себептер', detailBtn: 'Толық талдау →', tagClarify: 'Нақтылау сұрақтары', probableDirections: '⚠️ Ықтимал бағыттар',
    diagnosisTitle: 'Диагностика нәтижесі', causesHeading: 'Ықтимал себептер', homeCareHeading: '🏠 Үй жағдайында емдеу', vetHeading: 'Ветеринарға қашан жүгіну керек', doneSaveBtn: 'Түсінікті, тарихқа сақтау',
    inlineCalcTitle: '🧮 Бройлерге арналған жем калькуляторы', calcAgeLabel: 'Құстың жасы', calcHeadsLabel: 'Бас саны', calcResultPrefix: 'Тәуліктік норма', calcProteinLabel: 'Жемдегі белок:', calcWaterNote: 'Су жемнің көлемінен шамамен екі есе көп қажет, әсіресе ысықта.', calcHeadsShort: 'бас',
    feedCalcTitle: 'Жем нормасының калькуляторы', birdTypeLabel: 'Құс түрі', ageLabel: 'Жасы', headsLabel: 'Бас саны', priceLabel: 'Жемнің 1 кг бағасы, ₸ (міндетті емес)', pricePlaceholder: 'Мысалы, 250',
    resultLabel: 'Нәтиже', perHeadSub: 'бір басқа тәулігіне', dailySub: 'кг/тәулігіне бүкіл үйірге', monthlySub: 'кг айына', costSub: 'айына жемге', waterSub: 'Тәуліктік судың болжамды шығыны', doneBtn: 'Дайын',
    birdBroiler: 'Бройлер', birdLayer: 'Жұмыртқашы', birdYoung: 'Жас құс', unitDays: 'Күн', unitWeeks: 'Апта',
    analyzingTitle: '📸 Фотоны талдап жатырмын…', analyzingCaption: 'Суреттен белгілерді анықтап жатырмын…',
    langToggle: 'RU',
  },
};

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

// design_handoff README: "swaps a set of CSS custom properties... on the root container
// with a .25s transition; accent hues stay the same in both themes". Values copied 1:1
// from the prototype's darkThemeVars(). --color-accent-onbg is the token used for any
// accent-colored text sitting directly on the page/card background (see SEVERITY_STYLE
// and .chat-del:hover for why: accent-700/800 text hardcoded on a bg that flips dark
// would go near-invisible — this token flips instead so the text stays readable).
function themeVars(darkMode: boolean): React.CSSProperties {
  if (!darkMode) return { ['--color-accent-onbg' as any]: '#8c491a' };
  return {
    ['--color-accent-onbg' as any]: '#f6a06b',
    ['--color-bg' as any]: '#2e2b25',
    ['--color-surface' as any]: '#474238',
    ['--color-text' as any]: '#f9f4ed',
    ['--color-divider' as any]: 'color-mix(in srgb, #f9f4ed 16%, transparent)',
    ['--color-neutral-100' as any]: '#2e2b25',
    ['--color-neutral-200' as any]: '#474238',
    ['--color-neutral-300' as any]: '#645c50',
    ['--color-neutral-400' as any]: '#82796a',
    ['--color-neutral-500' as any]: '#a19786',
    ['--color-neutral-600' as any]: '#c0b6a5',
    ['--color-neutral-700' as any]: '#dcd3c4',
    ['--color-neutral-800' as any]: '#eee7db',
    ['--color-neutral-900' as any]: '#f9f4ed',
  };
}

// Низкоопаcity фоновый паттерн (пшеница/лист/яйцо/перо) — design_handoff README
// "Background ornaments". data-URI строится через encodeURIComponent (не ручной
// #→%23), иначе спецсимволы ломают background-image.
function ornamentBg(darkMode: boolean): string {
  const c = darkMode ? { wheat: '#f6a06b', leaf: '#b9c79a', op: '0.09' } : { wheat: '#c67139', leaf: '#7a8a5e', op: '0.06' };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260">`
    + `<g fill="none" stroke="${c.wheat}" stroke-width="1.6" stroke-linecap="round" opacity="${c.op}">`
    + `<line x1="30" y1="20" x2="30" y2="80"/>`
    + `<ellipse cx="25" cy="30" rx="5" ry="9" transform="rotate(-20 25 30)"/><ellipse cx="35" cy="30" rx="5" ry="9" transform="rotate(20 35 30)"/>`
    + `<ellipse cx="25" cy="45" rx="5" ry="9" transform="rotate(-20 25 45)"/><ellipse cx="35" cy="45" rx="5" ry="9" transform="rotate(20 35 45)"/>`
    + `<ellipse cx="25" cy="60" rx="5" ry="9" transform="rotate(-20 25 60)"/><ellipse cx="35" cy="60" rx="5" ry="9" transform="rotate(20 35 60)"/>`
    + `</g>`
    + `<g fill="none" stroke="${c.leaf}" stroke-width="1.6" opacity="${c.op}">`
    + `<path d="M170 50 C190 55 198 75 185 95 C170 85 165 65 170 50Z"/>`
    + `<line x1="170" y1="50" x2="185" y2="95"/>`
    + `</g>`
    + `<g fill="none" stroke="${c.wheat}" stroke-width="1.4" opacity="${c.op}">`
    + `<ellipse cx="70" cy="180" rx="16" ry="21"/>`
    + `</g>`
    + `<g fill="none" stroke="${c.leaf}" stroke-width="1.4" opacity="${c.op}">`
    + `<path d="M200 180 C215 185 220 200 212 212 C200 215 190 202 200 180Z"/>`
    + `<path d="M200 180 C198 195 200 205 206 212" stroke-width="1"/>`
    + `</g>`
    + `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function DiagnosisCard({ diagnosis, onOpen, ui }: { diagnosis: DiagnosisData; onOpen: () => void; ui: UiDict }) {
  const topCauses = diagnosis.causes.slice(0, 2);
  return (
    <div className="diag-card">
      <span className="tag tag-accent">{ui.tagInspection}</span>
      <div className="diag-text">{diagnosis.inspection}</div>
      <span className="tag tag-accent-2">{ui.tagSymptoms}</span>
      <ul className="diag-symptoms">{diagnosis.symptoms.map((s, i) => <li key={i}>{s}</li>)}</ul>
      {topCauses.length > 0 && (
        <>
          <span className="tag tag-neutral">{ui.tagCauses}</span>
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
      <button className="pill-btn" style={{ marginTop: 2, alignSelf: 'flex-start' }} onClick={onOpen}>{ui.detailBtn}</button>
    </div>
  );
}

function DiagnosisModal({ diagnosis, onClose, ui }: { diagnosis: DiagnosisData; onClose: () => void; ui: UiDict }) {
  return (
    <div className="dlg-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dlg-sheet">
        <div className="dlg-header">
          <span>{ui.diagnosisTitle}</span>
          <button className="icon-btn" onClick={onClose} aria-label={ui.ariaClose}><X size={14} strokeWidth={2.75} /></button>
        </div>
        <div className="dlg-body">
          <div className="dlg-inspection">
            <span className="tag tag-accent">{ui.tagInspection}</span>
            <div className="dlg-inspection-text">{diagnosis.inspection}</div>
          </div>

          <div>
            <h4 className="dlg-h4">{ui.tagSymptoms}</h4>
            <div className="dlg-symptom-chips">{diagnosis.symptoms.map((s, i) => <span key={i} className="tag tag-neutral">{s}</span>)}</div>
          </div>

          {diagnosis.causes.length > 0 && (
            <div>
              <h4 className="dlg-h4">{ui.causesHeading}</h4>
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
              <h4 className="dlg-h4">{ui.homeCareHeading}</h4>
              <div className="dlg-numbered">
                {diagnosis.homeCare.map((t, i) => <div key={i} className="dlg-numbered-row"><span className="dlg-num dlg-num-care">{i + 1}</span><span>{t}</span></div>)}
              </div>
            </div>
          )}

          {diagnosis.recommendations.length > 0 && (
            <div>
              <h4 className="dlg-h4">{ui.vetHeading}</h4>
              <div className="dlg-numbered">
                {diagnosis.recommendations.map((t, i) => <div key={i} className="dlg-numbered-row"><span className="dlg-num dlg-num-vet">{i + 1}</span><span>{t}</span></div>)}
              </div>
            </div>
          )}
        </div>
        <div className="dlg-actions">
          <button className="sb-new" style={{ width: 'auto', padding: '10px 20px' }} onClick={onClose}>{ui.doneSaveBtn}</button>
        </div>
      </div>
    </div>
  );
}

// Уточняющие вопросы вместо мгновенного диагноза при неполном описании симптомов
// (TASK_DESIGN_IMPLEMENTATION.md п.4 — реальное поведение бэкенда, см. CLARIFY_JSON_INSTRUCTIONS
// в app/api/chat/route.ts). Ответ пользователя на эти вопросы — обычное следующее сообщение
// в том же чате; модель сама увидит, что деталей достаточно, и даст обычный markdown-разбор.
function ClarifyCard({ clarify, ui }: { clarify: ClarifyData; ui: UiDict }) {
  return (
    <div className="diag-card">
      <span className="tag tag-accent">{ui.tagClarify}</span>
      <div className="calc-card-title" style={{ fontSize: 16 }}>{clarify.title}</div>
      <div className="diag-text">{clarify.intro}</div>
      {clarify.groups.map((g, i) => (
        <div key={i}>
          <div className="clarify-group-heading">{g.heading}</div>
          <div className="diag-text">{g.itemsText}</div>
        </div>
      ))}
      {clarify.causesPreview.length > 0 && (
        <>
          <div className="clarify-group-heading">{ui.probableDirections}</div>
          <div className="clarify-causes-preview">
            {clarify.causesPreview.map((c, i) => <div key={i}>• {c}</div>)}
          </div>
        </>
      )}
      <div className="clarify-closing">{clarify.closing}</div>
    </div>
  );
}

// Живой калькулятор в самом сообщении чата — реальное состояние, не заскриптованный текст
// (design_handoff README: "Норма корма для бройлеров" quick question).
function InlineCalcCard({ ageId, heads, onAgeChange, onHeadsChange, ui }: {
  ageId: string; heads: number; onAgeChange: (id: string) => void; onHeadsChange: (n: number) => void; ui: UiDict;
}) {
  const group = AGE_GROUPS.find(g => g.id === ageId) || AGE_GROUPS[0];
  const resultText = heads > 0 ? `${fmtRu(heads * group.min / 1000)}–${fmtRu(heads * group.max / 1000)} кг/сутки` : '—';
  return (
    <div className="diag-card">
      <div className="calc-card-title">{ui.inlineCalcTitle}</div>
      <div className="calc-field">
        <label className="calc-label">{ui.calcAgeLabel}</label>
        <div className="calc-seg-wrap">
          {AGE_GROUPS.map(g => (
            <button key={g.id} className={`calc-seg-btn ${g.id === ageId ? 'active' : ''}`} onClick={() => onAgeChange(g.id)}>{g.label}</button>
          ))}
        </div>
      </div>
      <div className="calc-field">
        <label className="calc-label">{ui.calcHeadsLabel}</label>
        <input className="calc-input" type="number" min={0} value={heads} onChange={e => onHeadsChange(Math.max(0, parseInt(e.target.value, 10) || 0))} />
      </div>
      <div className="calc-result">
        <div className="calc-result-label">{ui.calcResultPrefix} {heads} {ui.calcHeadsShort} ({group.label})</div>
        <div className="calc-result-big">{resultText}</div>
        <div className="calc-result-sub">{ui.calcProteinLabel} {group.protein}</div>
      </div>
      <div className="calc-note">{ui.calcWaterNote}</div>
    </div>
  );
}

function FeedCalcModal({ onClose, ui }: { onClose: () => void; ui: UiDict }) {
  const [birdType, setBirdType] = useState<BirdType>('broiler');
  const [ageValue, setAgeValue] = useState(14);
  const [ageUnit, setAgeUnit] = useState<'days' | 'weeks'>('days');
  const [heads, setHeads] = useState(100);
  const [price, setPrice] = useState(0);

  const range = feedCalcRange(birdType, ageValue, ageUnit);
  const avgG = (range.min + range.max) / 2;
  const dailyKg = (avgG * heads) / 1000;
  const monthlyKg = (avgG * heads * 30) / 1000;
  const monthlyCost = Math.round(monthlyKg * price);
  const waterL = dailyKg * 2;
  const birdLabel: Record<BirdType, string> = { broiler: ui.birdBroiler, layer: ui.birdLayer, young: ui.birdYoung };

  return (
    <div className="dlg-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dlg-sheet" style={{ width: 'min(460px, 100%)' }}>
        <div className="dlg-header">
          <span>{ui.feedCalcTitle}</span>
          <button className="icon-btn" onClick={onClose} aria-label={ui.ariaClose}><X size={14} strokeWidth={2.75} /></button>
        </div>
        <div className="dlg-body">
          <div className="calc-field">
            <label className="calc-label">{ui.birdTypeLabel}</label>
            <div className="calc-seg-wrap">
              {BIRD_TYPE_IDS.map(id => (
                <button key={id} className={`calc-seg-btn flex1 ${id === birdType ? 'active' : ''}`} onClick={() => setBirdType(id)}>{birdLabel[id]}</button>
              ))}
            </div>
          </div>
          <div className="calc-field">
            <label className="calc-label">{ui.ageLabel}</label>
            <div className="calc-age-row">
              <input className="calc-input" type="number" min={0} value={ageValue} onChange={e => setAgeValue(Math.max(0, parseInt(e.target.value, 10) || 0))} style={{ flex: 1 }} />
              <div className="calc-seg-wrap">
                <button className={`calc-seg-btn ${ageUnit === 'days' ? 'active' : ''}`} onClick={() => setAgeUnit('days')}>{ui.unitDays}</button>
                <button className={`calc-seg-btn ${ageUnit === 'weeks' ? 'active' : ''}`} onClick={() => setAgeUnit('weeks')}>{ui.unitWeeks}</button>
              </div>
            </div>
          </div>
          <div className="calc-field">
            <label className="calc-label">{ui.headsLabel}</label>
            <input className="calc-input" type="number" min={0} value={heads} onChange={e => setHeads(Math.max(0, parseInt(e.target.value, 10) || 0))} />
          </div>
          <div className="calc-field">
            <label className="calc-label">{ui.priceLabel}</label>
            <input className="calc-input" type="number" min={0} placeholder={ui.pricePlaceholder} value={price || ''} onChange={e => setPrice(Math.max(0, parseFloat(e.target.value) || 0))} />
          </div>

          <div className="calc-result">
            <div className="calc-result-label">{ui.resultLabel}</div>
            <div className="calc-result-big">{range.min}–{range.max} г</div>
            <div className="calc-result-sub">{ui.perHeadSub}</div>
            <div className="calc-hr" />
            <div className="calc-result-mid">{fmtRu(dailyKg)} кг</div>
            <div className="calc-result-sub">{ui.dailySub}</div>
            <div className="calc-result-mid">{Math.round(monthlyKg)} кг</div>
            <div className="calc-result-sub">{ui.monthlySub}</div>
            {price > 0 && (
              <>
                <div className="calc-result-mid">{monthlyCost.toLocaleString('ru-RU')} ₸</div>
                <div className="calc-result-sub">{ui.costSub}</div>
              </>
            )}
          </div>

          <div className="calc-water-card">
            <div className="calc-water-title">💧 {fmtRu(waterL)} л</div>
            <div className="calc-result-sub">{ui.waterSub}</div>
          </div>
        </div>
        <div className="dlg-actions">
          <button className="sb-new" style={{ width: 'auto', padding: '10px 20px' }} onClick={onClose}>{ui.doneBtn}</button>
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
  const [showFeedCalc, setShowFeedCalc] = useState(false);
  const [calcAgeId, setCalcAgeId] = useState('d1');
  const [calcHeads, setCalcHeads] = useState(50);
  const [searchMode, setSearchMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [lang, setLang] = useState<'ru' | 'kk'>('ru');
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
      const savedDark = localStorage.getItem('nauryz-dark'); if (savedDark) setDarkMode(savedDark === '1');
      const savedLang = localStorage.getItem('nauryz-lang'); if (savedLang === 'kk' || savedLang === 'ru') setLang(savedLang);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('nauryz-dark', darkMode ? '1' : '0'); } catch {} }, [darkMode]);
  useEffect(() => { try { localStorage.setItem('nauryz-lang', lang); } catch {} }, [lang]);
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
        const cli = text2.indexOf('\n___CLARIFY___');
        const ci = text2.indexOf('\n___COST___');
        const markers = [di, cli, ci].filter(i => i >= 0);
        const cut = markers.length ? Math.min(...markers) : -1;
        setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: cut >= 0 ? text2.slice(0, cut) : text2 } : m));
      }
      const di = text2.indexOf('\n___DIAGNOSIS___');
      const cli = text2.indexOf('\n___CLARIFY___');
      const ci = text2.indexOf('\n___COST___');
      const afterMarker = (start: number) => {
        const following = [di, cli, ci].filter(i => i > start);
        return following.length ? Math.min(...following) : undefined;
      };
      let diagnosis: DiagnosisData | undefined;
      if (di >= 0) {
        try { diagnosis = JSON.parse(text2.slice(di + '\n___DIAGNOSIS___'.length, afterMarker(di))); } catch {}
      }
      let clarify: ClarifyData | undefined;
      if (cli >= 0) {
        try { clarify = JSON.parse(text2.slice(cli + '\n___CLARIFY___'.length, afterMarker(cli))); } catch {}
      }
      const firstMarker = [di, cli, ci].filter(i => i >= 0);
      const plainContent = text2.slice(0, firstMarker.length ? Math.min(...firstMarker) : undefined);
      if (ci >= 0) { try { const { costUsd } = JSON.parse(text2.slice(ci + '\n___COST___'.length)); setMessages(prev => prev.map(m => m.id === aid ? { ...m, costUsd } : m)); setSessionCost(p => p + costUsd); } catch {} }
      setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: plainContent, diagnosis, clarify } : m));
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: [...newMsgs, { id: aid, role: 'assistant' as const, content: plainContent, diagnosis, clarify, timestamp: new Date() }] } : c));
    } catch (err: any) {
      if (err.name !== 'AbortError') setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: '❌ Ошибка. Проверьте API ключ.', timestamp: new Date() }]);
    } finally { setIsLoading(false); setAbortController(null); }
  }, [input, pendingImage, pendingVideo, messages, searchMode, activeChatId]);

  // "Норма корма для бройлеров" — живой калькулятор в чате, а не запрос к API
  // (design_handoff README: "implement as real client-side state bound to number inputs").
  const askQuickQuestion = (s: { id: string; text: string }) => {
    if (s.id !== 'feed') { sendMessage(s.text); return; }
    let chatId = activeChatId;
    if (!chatId) {
      const id = Date.now().toString();
      setChats(prev => [...prev, { id, title: s.text, messages: [], createdAt: new Date() }]);
      setActiveChatId(id); chatId = id;
    }
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: s.text, timestamp: new Date() };
    const calcMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '', isCalcCard: true, timestamp: new Date() };
    const newMsgs = [...messages, userMsg, calcMsg];
    setMessages(newMsgs);
    if (messages.length === 0) setChats(prev => prev.map(c => c.id === chatId ? { ...c, title: s.text } : c));
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: newMsgs } : c));
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
  const ui = UI[lang];

  const Composer = (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={textareaRef} value={input} rows={1}
          onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder={ui.inputPlaceholder}
        />
        <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleFile} />
        <button className="c-btn c-btn-photo" onClick={() => fileRef.current?.click()}><Camera size={15} strokeWidth={2.75} />{ui.photoBtn}</button>
        <button className={`c-btn c-btn-voice ${isRecording ? 'rec' : ''}`} onClick={isRecording ? () => { recognitionRef.current?.stop(); setIsRecording(false); } : startVoice}>
          <Mic size={15} strokeWidth={2.75} />{isRecording ? ui.recording : ui.voiceBtn}
        </button>
        {isLoading
          ? <button className="c-send stop" onClick={() => { abortController?.abort(); setIsLoading(false); }} aria-label={ui.ariaStop}><Square size={15} strokeWidth={2.75} fill="currentColor" /></button>
          : <button className="c-send" onClick={() => sendMessage()} disabled={!input.trim() && !pendingImage && !pendingVideo} aria-label={ui.ariaSend}><Send size={16} strokeWidth={2.75} /></button>}
      </div>
    </div>
  );

  return (
    <>
      <div className="layout" style={{ ...themeVars(darkMode), position: 'relative' }}>
        <div className="ornament-layer" style={{ backgroundImage: ornamentBg(darkMode) }} />
        {sidebarOpen && <div className="sb-overlay" onClick={() => setSidebarOpen(false)} />}

        {/* SIDEBAR */}
        <div className={`sidebar ${sidebarOpen ? '' : 'closed'}`}>
          <div className="sb-brand">
            <div className="sb-brand-icon"><Logo size={19} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sb-brand-name">Nauryz AI</div>
              <div className="sb-brand-sub">{ui.subtitle}</div>
            </div>
            <button className="sb-hide-btn" onClick={() => setSidebarOpen(false)} aria-label={ui.ariaHideHistory}><ChevronLeft size={16} strokeWidth={2.75} /></button>
          </div>

          <button className="sb-new" onClick={createNewChat}><Plus size={14} strokeWidth={2.75} />{ui.newChat}</button>

          <div className="sb-section-label">{ui.historySection}</div>
          <div className="sb-chats">
            {chats.length === 0 && <div style={{ padding: '12px 10px', fontSize: 11, color: 'var(--color-neutral-500)', textAlign: 'center' }}>{ui.noChats}</div>}
            {chats.slice().reverse().map(chat => {
              const lastMsg = chat.messages[chat.messages.length - 1];
              return (
                <div key={chat.id} className={`chat-row ${chat.id === activeChatId ? 'act' : ''}`} onClick={() => switchChat(chat.id)}>
                  <div className="chat-row-title">{chat.title}</div>
                  <div className="chat-row-snippet">{lastMsg?.diagnosis?.inspection.slice(0, 40) || lastMsg?.content.slice(0, 40) || ''}</div>
                  <div className="chat-row-date">{formatChatDate(chat.createdAt, lang)}</div>
                  <button className="chat-del" onClick={e => deleteChat(chat.id, e)} aria-label={ui.ariaDeleteChat}><X size={12} strokeWidth={2.75} /></button>
                </div>
              );
            })}
          </div>

          <div className="sb-footer">
            <div className="sb-avatar">Ф</div>
            <span className="sb-footer-label">{ui.farmer}</span>
            {sessionCost > 0 && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-neutral-500)' }}>${sessionCost.toFixed(4)}</span>}
          </div>
        </div>

        {/* MAIN */}
        <div className="main">
          <div className="topbar">
            {!sidebarOpen && <button className="icon-btn" onClick={() => setSidebarOpen(true)} aria-label={ui.ariaShowHistory}><Menu size={16} strokeWidth={2.75} /></button>}
            <div className="topbar-title">{isEmpty ? ui.newChatTitle : (messages[0]?.content || ui.chatFallback)}</div>
            <div className="topbar-spacer" />
            <button className={`pill-btn ${searchMode ? 'on' : ''}`} onClick={() => setSearchMode(!searchMode)}>
              <Globe size={14} strokeWidth={2.75} />{searchMode ? ui.searchOn : ui.searchOff}
            </button>
            <button className="pill-btn" onClick={() => setShowFeedCalc(true)}><Calculator size={14} strokeWidth={2.75} />{ui.feedCalcBtn}</button>
            <button className="icon-btn" onClick={() => setDarkMode(d => !d)} aria-label={ui.ariaTheme}>
              {darkMode ? <Moon size={16} strokeWidth={2.75} /> : <Sun size={16} strokeWidth={2.75} />}
            </button>
            <button className="icon-btn lang-btn" onClick={() => setLang(l => l === 'ru' ? 'kk' : 'ru')} aria-label="Language">{ui.langToggle}</button>
          </div>

          <div className="content">
            {isEmpty ? (
              <div className="empty">
                <div className="empty-badge"><Logo size={34} strokeWidth={2.5} /></div>
                <h2 className="empty-heading">{ui.emptyHeading}</h2>
                <p className="empty-sub">{ui.emptySubtitle}</p>
                <div className="quick-grid">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={s.id} className="quick-card" style={{ animationDelay: `${i * 0.06}s` }} onClick={() => askQuickQuestion(s)}>
                      <span className="quick-emoji">{s.emoji}</span>
                      <span className="quick-text">{lang === 'kk' ? s.textKk : s.text}</span>
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
                          <DiagnosisCard diagnosis={msg.diagnosis} onOpen={() => setActiveDiagnosis(msg.diagnosis!)} ui={ui} />
                        ) : msg.clarify ? (
                          <ClarifyCard clarify={msg.clarify} ui={ui} />
                        ) : msg.isCalcCard ? (
                          <InlineCalcCard ageId={calcAgeId} heads={calcHeads} onAgeChange={setCalcAgeId} onHeadsChange={setCalcHeads} ui={ui} />
                        ) : msg.content === '' && isLoading && msg.id === lastMsg?.id ? (
                          isAnalyzingPhoto ? (
                            <div className="analyzing-card">
                              <div className="analyzing-title">{ui.analyzingTitle}</div>
                              <div className="analyzing-track"><div className="analyzing-bar" /></div>
                              <div className="analyzing-caption">{ui.analyzingCaption}</div>
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

      {showFeedCalc && <FeedCalcModal onClose={() => setShowFeedCalc(false)} ui={ui} />}

      {activeDiagnosis && <DiagnosisModal diagnosis={activeDiagnosis} onClose={() => setActiveDiagnosis(null)} ui={ui} />}
    </>
  );
}
