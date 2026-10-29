// Exercise the actual SDK/Next streaming route against a local fake provider.
// Does not send credentials, questions, or requests to an external service.
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
(async () => {
  const calls = [];
  let cancelled = false;
  const mock = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const payload = JSON.parse(body); calls.push(payload);
    const query = JSON.stringify(payload.messages.at(-1));
    if (query.includes('rate_limit')) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'private provider body' } })); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = data => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    event({ type: 'message_start', message: { id: 'msg_local', type: 'message', role: 'assistant', model: payload.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } } });
    event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    if (query.includes('slow_stream')) {
      const timer = setInterval(() => event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Streaming a local test answer. ' } }), 100);
      res.on('close', () => { clearInterval(timer); cancelled = true; }); return;
    }
    for (const text of ['Local ', 'SDK ', 'integration ', 'answer.']) {
      event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
    }
    event({ type: 'content_block_stop', index: 0 });
    event({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } });
    event({ type: 'message_stop' }); res.end();
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, ANTHROPIC_API_KEY: 'local-test-fixture-only', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}`, NEXT_TELEMETRY_DISABLED: '1', OPENAI_API_KEY: '' };
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3001'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; server.stdout.on('data', b => { logs += b; }); server.stderr.on('data', b => { logs += b; });
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch('http://127.0.0.1:3001')).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
      if (i === 99) throw new Error('Local test server did not start');
    }
    const send = (messages, search = false, signal) => fetch('http://127.0.0.1:3001/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, search }), signal });
    const media = { data: 'YQ==', mediaType: 'image/jpeg' };
    const reply = await send([{ role: 'user', content: 'old photo', image: media }, { role: 'assistant', content: 'old finding' }, { role: 'user', content: 'followup' }], true);
    assert.equal(reply.status, 200);
    const text = await reply.text(); assert.match(text, /Local SDK integration answer/); assert.match(text, /___COST___/);
    assert.equal(text.split('\n___COST___')[0], 'Local SDK integration answer.');
    const prompt = calls[0].system.map(block => block.text).join('\n');
    assert.match(prompt, /левая, правая или обе/);
    assert.match(prompt, /causesPreview оставь пустым/);
    const checkMediaAndTemperatureLimits = prompt => {
      assert.match(prompt, /Не предлагай определять лихорадку или температуру тела птицы на ощупь/);
      assert.match(prompt, /Не давай инструкций самостоятельного инвазивного измерения/);
      assert.match(prompt, /видео до 20 секунд/);
      assert.match(prompt, /отдельные кадры без звука/);
      assert.match(prompt, /При невозможности загрузить видео предложи фото/);
    };
    checkMediaAndTemperatureLimits(prompt);
    const videoReply = await send([{ role: 'user', content: 'Local video fixture', frames: [media, media] }]);
    assert.equal(videoReply.status, 200); await videoReply.text();
    const videoCall = calls.at(-1);
    checkMediaAndTemperatureLimits(videoCall.system.map(block => block.text).join('\n'));
    assert.equal(videoCall.messages[0].content.filter(block => block.type === 'image').length, 2);
    assert.match(videoCall.messages[0].content[0].text, /отдельные изображения без звука, не полный видеопоток/);
    assert.doesNotMatch(videoCall.messages[0].content[0].text, /Проанализируй последовательность кадров как видео/);
    const usage = JSON.parse(text.split('\n___COST___')[1]); assert.equal(usage.inputTokens, 20); assert.equal(usage.outputTokens, 8);
    assert.equal(calls[0].tools[0].max_uses, 1);
    assert.equal(calls[0].model, 'claude-haiku-4-5-20251001');
    assert.equal(typeof calls[0].messages[0].content, 'string');
    const limited = await send([{ role: 'user', content: 'rate_limit' }]);
    assert.equal(limited.status, 429); assert.ok(!(await limited.text()).includes('private provider body'));
    const ac = new AbortController();
    const slow = await send([{ role: 'user', content: 'slow_stream' }], false, ac.signal);
    const reader = slow.body.getReader(); await reader.read(); ac.abort(); await reader.cancel().catch(() => {});
    for (let i = 0; i < 50 && !cancelled; i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(cancelled, true);
    console.log('Local SDK integration passed: one-pass search tool, text-model follow-up without old media, token usage stream, sanitized 429 and upstream cancellation. All provider traffic stayed on loopback.');
  } finally {
    server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve));
    mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
