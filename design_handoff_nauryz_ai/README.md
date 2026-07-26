# Handoff: Nauryz AI — Interface Redesign

## Overview
Redesign of Nauryz AI, an AI chat assistant for Kazakhstani poultry farmers (Next.js app with a Claude vision photo analyzer and a RAG knowledge base). Warm, earthy "agro" visual direction (not corporate SaaS). Two interactive prototypes are included: a mobile (iPhone-frame) version and a desktop/web version with a persistent sidebar. Both share the same interaction logic and content.

## About the Design Files
The files in this bundle (`Nauryz AI - Mobile.dc.html`, `Nauryz AI - Web.dc.html`) are **design references built in HTML** — clickable prototypes showing intended look, content, and behavior. They are **not production code to copy directly**. The task is to **recreate these designs inside the actual Next.js codebase**, using React components, the project's existing data/state layer (chat messages, photo upload, RAG results), and real API calls to the vision/chat backend, following whatever component/styling conventions the codebase already has (or, if none exist yet, using plain CSS/Tailwind matching the tokens below).

## Fidelity
**High-fidelity.** Colors, type, spacing, and copy are final-direction; treat hex values and layout measurements below as the source of truth. Icons are simple hand-drawn placeholder SVGs — swap for a proper icon set (e.g. Lucide) at implementation time. Photo thumbnails use a placeholder drag-and-drop image slot — wire this to the real upload/vision pipeline.

## Screens / Views

### 1. Empty state (chat not yet started)
- **Purpose**: First thing the user sees on opening a chat / "New chat".
- **Layout**: Centered column, small circular logo badge (60–64px, sage-tinted background `--color-accent-2-100`), heading, one-line subtext, then a responsive grid of "quick question" cards (2 columns on mobile, 4 on desktop).
- **Components**:
  - Heading: Caprasimo, ~21–26px, "Сәлем! Чем помочь?" (editable via prop `greeting`).
  - Subtext: Figtree ~13–14px, muted (`--color-neutral-700`).
  - Quick-question card: rounded card (`.card` + `.elev-sm`), emoji icon ~19–22px, label 12.5–13px/600 weight. 8 cards total (health questions, feed norms, subsidies, business plan, breeding). Hover: lifts 2px (`translateY(-2px)`), background/shadow transition .18s.

### 2. Chat thread
- **Purpose**: Main conversation — user messages right-aligned, assistant left-aligned.
- **Layout**: Scrollable column, message bubbles `gap:12px` (mobile) / `16px` (desktop), each message fades/slides in on arrival (`msgIn` keyframes, .3s).
- **User message**: pill bubble, `background:var(--color-accent)`, `color:var(--color-bg)`, radius `18px 18px 4px 18px`. Text or a photo thumbnail (image-slot component) inside a same-colored padded frame.
- **Assistant message**: small circular avatar (logo mark) + stacked content:
  - **Typing indicator**: 3 bouncing dots (`bounceDot` keyframes, staggered .15s/.3s delays) inside a `.card`.
  - **Analyzing (photo) indicator**: card with "📸 Анализирую фото…", an animated indeterminate progress bar (`barslide` keyframes, 1.1s loop), and a caption.
  - **Diagnosis summary card** (structured health answer): tag-labeled sections — `Осмотр` (`.tag.tag-accent`), `Симптомы` (`.tag.tag-accent-2`, bullet list), `Вероятные причины` (`.tag.tag-neutral`, top 2 causes only with % bars), then a "Подробный разбор →" button that opens the full diagnosis modal.
  - **Info card** (non-health Q&A: feed norms, subsidies, business plan, breeding): `.card-title` + bullet list + a highlighted note line.
  - Timestamp under each message, 10–11px, `--color-neutral-600`.

### 3. Diagnosis detail (modal / full screen)
- **Mobile**: full-screen sheet sliding up (`sheetUp` keyframes, .26s), back-chevron header "Результат диагностики".
- **Desktop**: centered `.dialog` over `.dialog-backdrop` (fade + scale-in, `dialogIn`/`backdropIn` keyframes, ~.2s).
- **Content** (both): 
  - Осмотр card tinted `--color-accent-100` bg, `--color-accent-800` text, ~15–16px/600.
  - Симптомы: wrapped `.tag.tag-neutral` chips.
  - Возможные причины: one card per cause, background/text color driven by severity (see Design Tokens → Severity below), name ~14–14.5px/700, percentage ~17–18px/800 (large — this is the key number), thin progress bar underneath.
  - **🏠 Лечение в домашних условиях**: numbered list of concrete home-care actions the farmer can do without a vet (dosage-level detail: what to add to feed, how to isolate, what bedding to use).
  - **Когда обращаться к ветеринару**: a separate numbered list — the vet-escalation criteria, kept distinct from home care so farmers know which list is DIY vs. "call a professional now."
  - Primary button "Понятно, сохранить в историю" closes the modal.

### 4. Photo upload / analysis
- Not a separate screen — it's the **user photo message + "Анализирую фото…" assistant placeholder** described in Chat thread above, followed ~2.2s later by a diagnosis summary card. Implement as: upload → call vision API → show analyzing state → render structured diagnosis on response.

#### Real photo-analysis integration (replacing the scripted flow)
The prototype's `sendPhoto()` is a fixed-timeout simulation (2.2s → always returns the same `RAW.lamePhoto` object) with no real image ever leaving the browser. To wire up the actual Claude vision pipeline:

1. **Capture the file.** `image-slot.js` already gets a real `File` in the browser (drag-drop or the file-picker `sendPhoto()` now auto-opens via `openFilePicker()`) — in production, listen for that file (the component's `change`/`drop` internals aren't exposed as a public event today, so either add a `slot-change` `CustomEvent` dispatch to `image-slot.js` after `_ingest()`, or replace the slot with your own `<input type="file">`/dropzone that both previews the image AND hands the `File`/base64 to your upload handler).
2. **Upload + encode.** Convert the file to base64 (or upload to storage and pass a signed URL) and call your backend endpoint, which forwards to the Claude API as an image content block alongside a text prompt, e.g.: "You are a poultry health assistant for Kazakhstani farmers. Given this photo of a chicken/coop, identify visible symptoms and return a diagnosis as JSON matching this schema: { inspection: string, symptoms: string[], causes: [{name, pct, severity: 'low'|'medium'|'high'|'critical'}], homeCare: string[], recommendations: string[] }". Keep `pct` values summing sensibly (they don't need to sum to 100 — the prototype's don't) and pick `severity` conservatively (reserve `critical` for reportable/contagious disease patterns like Newcastle).
2b. **RAG augmentation.** If the existing RAG knowledge base has poultry-disease entries, retrieve the top-k relevant chunks by the photo's likely topic (or a first-pass cheap classification) and inject them into the prompt as grounding context before the causes/recommendations are generated — this is what should make the causes list trustworthy rather than the model guessing from image alone.
3. **Map the response onto the UI.** The returned JSON should be passed straight into the same `buildDiagnosis(raw)` shape the prototype uses (`inspection`, `symptoms[]`, `causes[]` with `pct`/`severity`, `homeCare[]`, `recommendations[]`) so the existing diagnosis card and modal markup need no changes — only `sendPhoto()`'s body changes, from the `setTimeout` simulation to an `async` call: show the analyzing card immediately on upload, `await` the API response, then swap it for the diagnosis card (or an error state — see below).
4. **Loading state timing.** Keep the existing "📸 Анализирую фото…" card and indeterminate progress bar as-is for the real request — real vision calls commonly take 2–10s, so the indeterminate bar (not a fake fixed-duration one) is the right pattern; just drive it off the actual pending promise instead of a timer.
5. **Error / low-confidence handling** (not in the prototype — add for production): if the model can't confidently identify a health issue from the photo (blurry image, no bird visible, healthy-looking bird), return a distinct low-confidence response and render it as an info-style card ("Не удалось точно определить проблему по фото — опишите симптомы текстом или пришлите более чёткое фото") rather than forcing a diagnosis card with fabricated percentages. Also handle upload failures (network, file-too-large, unsupported format) with a simple inline error state on the photo bubble.
6. **Clarifying-question parity.** The text-based "Курица хромает" flow asks clarifying questions before diagnosing (see above) — for photos, prefer letting the model ask ONE short follow-up question in the same visual slot (reuse the `kindClarify` card, populated from the model's own follow-up instead of the static `CLARIFY.lame` object) when the image alone is ambiguous, rather than always forcing a full diagnosis from a single photo.

### 5. History
- **Mobile**: hamburger icon in header opens a full-screen list (slides in from the left, `drawerIn` keyframes, .24s) with a "+ Новый чат" button and a scrollable list of past chats (`.card.elev-sm` rows: title 13px/700, date 10px muted, snippet 11.5px muted).
- **Desktop**: persistent left sidebar (272px), same content, plus a collapse/expand toggle (chevron button collapses sidebar to 0 width with a `width .28s ease` transition; a hamburger button reappears in the header when collapsed). Active/selected chat row gets a tinted background (`--color-accent-100`).

## Interactions & Behavior
- **Quick question click** → pushes a user text bubble, shows typing indicator ~1s, then renders the scripted assistant response (diagnosis, info card, or calculator) for that topic. Exception: "Курица хромает, что делать?" first shows a **clarifying-questions card** (age, which leg/wing, posture, other signs, housing conditions, plus a probable-directions preview) instead of an instant diagnosis — the assistant should not guess without enough detail. The user's next reply (any typed text) then triggers the full diagnosis for that topic; sending a photo instead goes straight to the photo-analysis flow.
- **Норма корма для бройлеров** quick question opens a **live inline calculator card** in the chat (not scripted text): pick an age segment, type a head count, and the numbers (kg/day, protein %) recompute instantly from the input — implement as real client-side state bound to number inputs, not canned copy.
- A separate **⚖️ Калькулятор нормы корма** button lives in the header next to the dark-mode toggle (not in the quick-questions grid) and opens a bigger standalone calculator as a modal/full-screen sheet: bird type (бройлер/несушка/молодняк), age (value + days/weeks unit toggle), head count, and an optional feed price per kg — computing per-head daily grams, daily kg for the whole flock, monthly kg, optional monthly cost, and an approximate daily water use line.
- **Photo button** → pushes a user photo bubble + analyzing indicator ~2.2s, then renders a diagnosis card.
- **Free-text input** (Enter key or send button) → user bubble, typing indicator ~0.9s, generic clarifying-question fallback response.
- **"Подробный разбор →"** on a diagnosis summary card opens the diagnosis modal/sheet with the full cause list and recommendations for that message.
- **History row click** → loads that conversation's scripted Q/A into the main thread and closes the history panel/collapses back.
- **"+ Новый чат"** resets to the empty state.
- **Dark mode toggle** (sun/moon icon button, header) — swaps a set of CSS custom properties (background, surface, text, and the full neutral-100…900 ramp, reversed) on the root container with a .25s transition; accent hues (terracotta/sage) stay the same in both themes so brand color is preserved. A dedicated `--color-accent-onbg` token (light: `#8c491a`, dark: `#f6a06b`) is used for any accent-colored text sitting directly on the page/card background (as opposed to accent-tinted chip backgrounds, which don't need to change) — this was a real bug found during review and is the pattern to replicate: never hardcode an accent-700/800 text color directly on a background that flips in dark mode.
- **Sidebar collapse (desktop only)** — width-based expand/collapse transition, not a hide/show toggle, so it animates smoothly.
- **Language toggle** (ҚАЗ/RU button, header) — switches all UI chrome (labels, buttons, tags, section headings, calculators, empty-state copy, quick-question titles) between Russian and Kazakh instantly via a `UI` string dictionary keyed by `lang`, exposed to the template as a single `ui` object (`{{ui.subtitle}}` etc.) so every static label is a lookup rather than hardcoded text. **Scope limit**: the deep diagnosis/info content (RAW/INFO objects — symptom lists, causes, recommendations, business-plan bullets, etc.) stays Russian-only in this prototype; only chrome and quick-question titles are bilingual. Full content translation is a follow-up task, not yet done.
- **Background ornaments** — a very low-opacity (6% light / 9% dark) repeating SVG pattern (wheat ear, leaf, egg, feather motifs in terracotta/sage) sits behind all screens via an absolutely-positioned `z-index:-1` layer with `background-image` set to a data-URI built at runtime (`ornamentBg()`, encodes via `encodeURIComponent` — build it that way, not manual `#`→`%23` replace, or special characters break the style attribute). Regenerates per dark/light theme.
- **Welcome entrance animation** — on the empty state, the logo badge, greeting heading and subtext fade up (`welcomeIn` keyframes, .55s, staggered ~0.05s apart) and the quick-question cards cascade in individually (`cardIn` keyframes, .5s each, staggered 0.06s per card via an index-based `animation-delay`). Total sequence stays under ~1s. A global `@media (prefers-reduced-motion: reduce)` rule collapses all animation/transition durations to near-zero for accessibility — keep this rule when porting to production CSS.

## State Management
Minimal state needed to reproduce:
- `screen`: `'empty' | 'chat'`
- `messages[]`: `{ id, isUser, kind: 'text'|'photo'|'diagnosis'|'info'|'typing'|'analyzing', text?, photoUrl?, diagnosis?, info?, time }`
- `diagnosisOpen: boolean`, `activeDiagnosis: object|null`
- `showHistory` (mobile) / `sidebarOpen` (desktop): boolean
- `activeChatId` (desktop, to highlight the selected history row)
- `darkMode: boolean`
- `lang: 'ru' | 'kk'`
- `inputText: string`

In production this should be backed by real chat/session state and actual API responses (chat completion + vision analysis + RAG lookup) rather than the scripted content used in the prototype.

## Design Tokens
Sourced from the bound "Organic" design system (`_ds/organic-.../styles.css`) — do not invent new values, reuse these:
- `--color-bg: #f5ead8` (cream) / dark mode: `#2e2b25`
- `--color-surface: #ebddc5` / dark mode: `#474238`
- `--color-text: #201e1d` / dark mode: `#f9f4ed`
- `--color-accent: #c67139` (terracotta) — unchanged in dark mode
- `--color-accent-2: #7a8a5e` (sage) — unchanged in dark mode
- Tonal ramps `--color-neutral-100…900`, `--color-accent-100…900`, `--color-accent-2-100…900` (see styles.css) — in dark mode the neutral ramp is reversed (100↔900, 200↔800, 300↔700, 400↔600, 500 stays)
- `--font-heading: "Caprasimo"` (headings/wordmark only), `--font-body: "Figtree"` (everything else)
- Radii: `--radius-sm: 8px`, `--radius-md: 16px`, `--radius-lg: 28px`; buttons/tags/inputs are pill-shaped (999px)
- Elevation: `--shadow-sm/md/lg`

### Severity colors (diagnosis causes)
- `high`: bar `--color-accent-500`, text `--color-accent-800`, card bg `--color-accent-100`
- `critical` (e.g. Newcastle disease): bar `--color-accent-700`, text `--color-accent-900`, card bg `--color-accent-200`
- `medium`: bar `--color-accent-2-500`, text `--color-accent-2-800`, card bg `--color-accent-2-100`
- `low`: bar `--color-neutral-400`, text `--color-neutral-700`, card bg `--color-neutral-100`

## Assets
- No photography used. Logo is an inline SVG abstract sprout mark (two leaf blobs + stem) in `--color-accent-2-500` / `--color-accent-500` — replace with the real Nauryz AI logo if one exists.
- Icons are hand-drawn inline SVGs (hamburger, camera, mic, send, back chevron, sun/moon, plus). Swap for a proper icon set (Lucide, stroke-width 2.75, per the design system's guidance) during implementation.
- Photo thumbnails use a placeholder drag-and-drop `<image-slot>` component (`image-slot.js`) — for reference only, replace with the real upload UI.

## Files
- `Nauryz AI - Mobile.dc.html` — iPhone-frame prototype (all 5 required screens/states)
- `Nauryz AI - Web.dc.html` — desktop/web prototype (sidebar layout, same logic)
- `ios-frame.jsx` — iPhone device bezel used by the mobile file (reference only, not needed in production)
- `image-slot.js` — placeholder image drop component (reference only)
- `_ds/` — the bound "Organic" design system: `styles.css` (all tokens/component classes), `_ds_bundle.js` (React component bundle used by the prototypes), `readme.md` (full design system guide)
- `support.js` — prototype runtime shim (not needed in production; ignore)

To view the prototypes: open either `.dc.html` file directly in a browser.
