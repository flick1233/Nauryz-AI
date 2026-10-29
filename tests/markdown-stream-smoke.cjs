// Local browser regression for the actual page renderer; no server or paid APIs.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setContent('<div id="root"></div>');
    for (const file of ['react/umd/react.development.js', 'react-dom/umd/react-dom.development.js']) {
      const path = require('node:path');
      await page.addScriptTag({ path: path.join(path.dirname(require.resolve(file.split('/')[0])), file.split('/').slice(1).join('/')) });
    }
    const source = fs.readFileSync('app/page.tsx', 'utf8');
    const renderer = source.slice(source.indexOf('function renderMarkdown('), source.indexOf('export default function NauryzAI'));
    const protocol = fs.readFileSync('lib/chat-protocol.ts', 'utf8').replace('export function', 'function');
    const code = ts.transpileModule(renderer + '\n' + protocol, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText;
    await page.addScriptTag({ content: code + ';window.root = ReactDOM.createRoot(document.getElementById("root"));' });
    const result = await page.evaluate(() => {
      const text = '## Возраст\n\n- Сколько недель?\n* Как долго хромает?\n- Подстилка мокрая?\n\n## Поведение\n\n1. Ест нормально?\n2. Другие птицы болеют?\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```\nпример\n```\n\nПовтор допустим.\n\nПовтор допустим.';
      const render = content => ReactDOM.flushSync(() => root.render(React.createElement('div', null, renderMarkdown(content))));
      const reset = () => ReactDOM.flushSync(() => root.render(null));
      render(text);
      const expected = document.getElementById('root').innerHTML;
      reset();
      // Cumulative snapshots, as passed by the React state update after each read.
      for (let i = 1; i <= text.length; i++) render(text.slice(0, i));
      const cumulative = document.getElementById('root').innerHTML;
      reset();
      // Transport deltas are accumulated once; protocol parser receives the snapshot.
      let received = '';
      const wire = text + '\n___COST___{"costUsd":0}';
      for (const delta of wire) { received += delta; render(readChatStream(received).content); }
      const delta = document.getElementById('root').innerHTML;
      for (let i = 0; i < 5; i++) render(text);
      const rerender = document.getElementById('root').innerHTML;
      // Interrupted answer followed by a fresh retry replaces the previous tree.
      render(text.slice(0, 45)); render(''); render(text);
      const retry = document.getElementById('root').innerHTML;
      const selection = window.getSelection(); const range = document.createRange();
      range.selectNodeContents(document.getElementById('root')); selection.removeAllRanges(); selection.addRange(range);
      return { expected, cumulative, delta, rerender, retry, copied: selection.toString() };
    });
    for (const mode of ['cumulative', 'delta', 'rerender', 'retry']) assert.equal(result[mode], result.expected, mode);
    assert.equal(result.copied.match(/Сколько недель\?/g).length, 1);
    assert.equal(result.copied.match(/Повтор допустим\./g).length, 2, 'Do not deduplicate real model text');
    assert.deepEqual(errors, []);
    console.log('Markdown streaming passed: cumulative snapshots, accumulated deltas, rerenders, retry, DOM copy, intentional repetition; no duplicate-key errors.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
