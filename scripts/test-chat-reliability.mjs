import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function loadTsModule(file) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const context = { exports: {}, DOMException, ReadableStream, TextDecoder, TextEncoder, console };
  vm.runInNewContext(output, context, { filename: file });
  return context.exports;
}

const root = process.cwd();
const context = loadTsModule(path.join(root, 'lib', 'chat-context.ts'));
const stream = loadTsModule(path.join(root, 'lib', 'chat-stream.ts'));
const encoder = new TextEncoder();

function bodyFrom(chunks, failAt = -1) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index === failAt) return controller.error(new Error('mock stream drop'));
      if (index >= chunks.length) return controller.close();
      controller.enqueue(encoder.encode(chunks[index++]));
    },
  });
}

async function rejects(promise, name) {
  let thrown;
  try { await promise; } catch (error) { thrown = error; }
  assert.ok(thrown, `${name} must reject`);
  return thrown;
}

// diagnosis -> next request, clarify -> answer, long history, and only current media
const oldImage = { data: 'old-image', mediaType: 'image/jpeg' };
const messages = Array.from({ length: 14 }, (_, index) => ({
  role: index % 2 ? 'assistant' : 'user', content: `m${index}`,
  image: index === 0 ? oldImage : undefined,
  diagnosis: index === 10 ? { inspection: 'photo finding', symptoms: ['s'], causes: [{ name: 'possible cause', severity: 'medium' }], homeCare: ['isolate'], recommendations: ['vet'] } : undefined,
  clarify: index === 11 ? { title: 'clarify', intro: 'why', groups: [{ heading: 'age', itemsText: 'days' }], causesPreview: ['direction'], closing: 'reply' } : undefined,
}));
messages.push({ role: 'user', content: 'new answer' });
const request = context.buildChatContext(messages);
assert.equal(request.length, context.MAX_CONTEXT_MESSAGES);
assert.equal(request.at(-1).content, 'new answer');
assert.ok(request.some(message => message.content.includes('photo finding')));
assert.ok(request.some(message => message.content.includes('clarify')));
assert.ok(request.slice(0, -1).every(message => !message.image && !message.frames));

// HTTP and non-JSON failures are gated before a stream is read.
for (const response of [{ ok: false, body: null }, { ok: true, body: null }]) {
  await rejects(Promise.resolve().then(() => stream.requireStreamBody(response)), 'bad HTTP/body');
}

// A normal stream exposes only user text while control markers remain hidden.
let visible = '';
const success = await stream.readChatStream(
  bodyFrom(['Привет', '\n___COST___{"costUsd":0}']), new AbortController().signal,
  text => { visible = stream.visibleStreamText(text); },
);
assert.equal(visible, 'Привет');
assert.ok(stream.hasCompleteStream(success));

// A mid-stream drop preserves the partial text and rejects for the client retry path.
let partial = '';
const dropped = await rejects(stream.readChatStream(
  bodyFrom(['частичный ответ'], 1), new AbortController().signal,
  text => { partial = stream.visibleStreamText(text); },
), 'stream drop');
assert.match(String(dropped), /mock stream drop/);
assert.equal(partial, 'частичный ответ');

// Abort during a stream is observable immediately; a new request can start after it.
const controller = new AbortController();
const aborted = await rejects(stream.readChatStream(
  bodyFrom(['первый фрагмент', 'второй фрагмент']), controller.signal,
  () => controller.abort(),
), 'abort');
assert.equal(aborted.name, 'AbortError');
const followUp = await stream.readChatStream(bodyFrom(['новый ответ', '\n___COST___{}']), new AbortController().signal, () => {});
assert.ok(stream.hasCompleteStream(followUp));

// Retrying removes exactly the previous transport error and keeps the original user request once.
const retryInput = [{ role: 'user', content: 'вопрос' }, { role: 'assistant', content: 'network error', transportError: true }];
const retryMessages = context.messagesForRetry(retryInput, true);
assert.equal(retryMessages.length, 1);
assert.equal(retryMessages[0].content, 'вопрос');
assert.equal(context.messagesForRetry(retryMessages, false).length, 1);

// RU/KK client strings and the request-id guard are kept in the live component.
const page = fs.readFileSync(path.join(root, 'app', 'page.tsx'), 'utf8');
assert.match(page, /Ошибка сети или потока ответа/);
assert.match(page, /Желіде немесе жауап ағынында қате болды/);
assert.match(page, /requestIdRef\.current/);
assert.match(page, /requireStreamBody\(res\)/);

console.log('chat reliability mock regressions passed: context, media cap, HTTP/body error, stream drop, abort+follow-up, retry, RU/KK, request guard');
