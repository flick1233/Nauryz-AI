// Local UI checks with mocked chat transport: never calls paid providers.
// Run against npm run start: node tests/ui-smoke.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:3000') ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:3000');
    await page.getByRole('textbox', { name: 'Опиши проблему или задай вопрос…' }).waitFor();
    assert.equal(await page.locator('.quick-grid:not(.secondary-grid) .quick-card').count(), 4);
    assert.equal(await page.locator('.more-topics').getAttribute('open'), null);
    const launcher = page.getByRole('button', { name: 'Калькулятор нормы корма', exact: true });
    await launcher.click();
    const dialog = page.getByRole('dialog', { name: 'Калькулятор нормы корма' });
    await dialog.waitFor();
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
    assert.equal(await dialog.getByRole('spinbutton').count(), 3);
    await dialog.getByRole('spinbutton', { name: 'Цена корма за кг, ₸ (необязательно)' }).fill('250');
    assert.match(await dialog.innerText(), /37[\s\u00a0]?500/);
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
    }
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    assert.equal(await launcher.evaluate(el => el === document.activeElement), true);
    await page.getByRole('button', { name: 'Скрыть историю' }).click();
    assert.equal(await page.locator('.sidebar').evaluate(el => el.inert), true);
    assert.equal(await page.getByRole('button', { name: 'Новый чат', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Язык: русский. Переключить на казахский' }).click();
    assert.equal(await page.locator('html').getAttribute('lang'), 'kk');
    await page.getByRole('button', { name: 'Тіл: қазақша. Орысшаға ауысу' }).click();
    const screenshotDir = '/tmp/nauryz-ui'; fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: `${screenshotDir}/desktop-light.png`, fullPage: true, animations: 'disabled' });
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow at ${width}`);
      await page.screenshot({ path: `${screenshotDir}/width-${width}.png`, fullPage: true, animations: 'disabled' });
      await page.getByRole('button', { name: 'Язык: русский. Переключить на казахский' }).click();
      await page.getByRole('button', { name: 'Веб-іздеу өшірулі', exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Kazakh search on overflow at ${width}`);
      await page.getByRole('button', { name: 'Веб-іздеу қосулы', exact: true }).click();
      await page.getByRole('button', { name: 'Тіл: қазақша. Орысшаға ауысу' }).click();
      await page.getByRole('button', { name: 'Веб-поиск выключен', exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Russian search on overflow at ${width}`);
      await page.getByRole('button', { name: 'Веб-поиск включён', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Тема', exact: true }).click();
    await page.screenshot({ path: `${screenshotDir}/desktop-dark.png`, fullPage: true, animations: 'disabled' });
    const calls = [];
    let legacySearchCalls = 0;
    await page.route('**/api/search', route => { legacySearchCalls++; return route.fulfill({ status: 500 }); });
    await page.route('**/api/chat', async route => {
      calls.push(route.request().postDataJSON());
      if (calls.length === 1) {
        await new Promise(resolve => setTimeout(resolve, 150));
        return route.fulfill({ status: 200, body: '\n___DIAGNOSIS___' + JSON.stringify({ inspection: 'Test finding', symptoms: ['limping'], causes: [], homeCare: [], recommendations: ['ветеринар'], needsVet: true }) + '\n___COST___{"costUsd":0.001,"historyTrimmed":false}\n___SOURCES___["Test source"]' });
      }
      return route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"Сервис занят. Попробуйте позже."}' });
    });
    await page.getByRole('button', { name: 'Веб-поиск выключен', exact: true }).click();
    const textbox = page.getByRole('textbox');
    await textbox.fill('Курица хромает');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await textbox.dispatchEvent('keydown', { key: 'Enter' });
    await page.locator('.diag-text').filter({ hasText: 'Test finding' }).waitFor();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].search, true);
    assert.equal(legacySearchCalls, 0);
    assert.equal(await page.getByText('Источники, переданные для ответа', { exact: false }).count(), 1);
    await textbox.fill('Какие подробности нужны?');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.locator('.request-error').waitFor();
    assert.match(calls[1].messages.find(m => m.role === 'assistant').content, /limping/);
    assert.match(await page.locator('.request-error').innerText(), /Сервис занят/);
    await page.getByRole('button', { name: 'Вернуть вопрос' }).click();
    assert.equal(await textbox.inputValue(), 'Какие подробности нужны?');
    await page.getByRole('button', { name: 'Показать историю' }).click();
    await page.getByRole('button', { name: 'Удалить чат', exact: true }).click();
    await page.waitForFunction(() => localStorage.getItem('nauryz-v4') === '[]');
    await page.reload();
    assert.equal(await page.locator('.chat-row').count(), 0);
    assert.deepEqual(errors, []);
    console.log('UI checks passed: dialog focus/trap/Escape/restore, numeric labels and calculator, inert sidebar, RU/KK document language, 360/768/1440 layouts, mocked one-call search, structured history, error recovery, deletion persistence; no page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
