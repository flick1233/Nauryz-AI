import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClarifyJson, preserveLiteralResponse } from '../lib/clarify-response.ts';
const card = { title: 'Хромота у курицы — уточняющие вопросы', intro: 'Уточните признаки',
  groups: [{ heading: 'Какая лапа', itemsText: 'Левая, правая или обе?' }], causesPreview: [], closing: 'Пришлите фото' };
test('complete observed clarify schema works without type, with type, and in a complete JSON fence', () => {
  for (const data of [card, { type: 'clarify', ...card }]) {
    for (const raw of [JSON.stringify(data), '```json\n' + JSON.stringify(data) + '\n```']) {
      assert.deepEqual(parseClarifyJson(raw), card);
    }
  }
});
test('arbitrary, partial, wrongly typed and embedded JSON is not treated as a card', () => {
  for (const data of [{ title: 'example' }, { ...card, type: 'other' }, { ...card, groups: [] },
    { ...card, groups: [{ heading: 'x', itemsText: { code: 1 } }] }, { ...card, extra: true },
    { ...card, causesPreview: [1] }, null, [card]]) assert.throws(() => parseClarifyJson(JSON.stringify(data)));
  assert.throws(() => parseClarifyJson('Example:\n```json\n' + JSON.stringify(card) + '\n```'));
  assert.throws(() => parseClarifyJson('```json\n' + JSON.stringify(card)));
});
test('explicit code/JSON requests retain literal text, including follow-up turns', () => {
  for (const content of ['Покажи JSON карточки', 'Write code', 'JSON үлгісін көрсет', 'Пример кода']) {
    assert.equal(preserveLiteralResponse([{ role: 'user', content }, { role: 'user', content: 'Ещё пример' }]), true);
  }
  assert.equal(preserveLiteralResponse([{ role: 'user', content: 'Курица хромает, что делать?' },
    { role: 'assistant', content: JSON.stringify(card) }]), false);
});
