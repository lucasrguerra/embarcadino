import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDraft, parseCategories, countWords } from '../../src/modules/writer/writer.service.js';
import { parseBriefing } from '../../src/modules/writer/handlers/index.js';

const ENVELOPE = `===TITULO===
ESP32-C6: o chip do Matter

===RESUMO===
O ESP32-C6 traz Wi-Fi 6 e Thread nativos.

===CATEGORIAS===
iot, sistemas-embarcados, hardware

===CONTEUDO===
<!-- wp:paragraph -->
<p>O ESP32-C6 traz Wi-Fi 6 e Thread nativos.</p>
<!-- /wp:paragraph -->`;

test('parseDraft separa as seções do envelope', () => {
  const draft = parseDraft(ENVELOPE);

  assert.equal(draft.title, 'ESP32-C6: o chip do Matter');
  assert.equal(draft.excerpt, 'O ESP32-C6 traz Wi-Fi 6 e Thread nativos.');
  assert.ok(draft.content.startsWith('<!-- wp:paragraph -->'));
});

test('parseDraft descarta categoria que não existe no blog', () => {
  assert.deepEqual(parseDraft(ENVELOPE).categories, ['iot', 'sistemas-embarcados']);
});

test('parseDraft usa o tema como título quando o marcador falta', () => {
  const draft = parseDraft('texto solto sem envelope nenhum', 'LoRaWAN');

  assert.equal(draft.title, 'LoRaWAN');
  assert.equal(draft.content, 'texto solto sem envelope nenhum');
});

test('parseCategories aceita quebra de linha, bullet e caixa alta', () => {
  assert.deepEqual(parseCategories('- IoT\n• Redes\nSeguranca'), ['iot', 'redes', 'seguranca']);
});

test('parseCategories remove duplicatas', () => {
  assert.deepEqual(parseCategories('iot, iot, redes'), ['iot', 'redes']);
});

test('countWords ignora blocos e tags do Gutenberg', () => {
  const content = '<!-- wp:paragraph -->\n<p>uma frase com cinco palavras</p>\n<!-- /wp:paragraph -->';
  assert.equal(countWords(content), 5);
});

test('parseBriefing separa tema, referência e observações', () => {
  const briefing = parseBriefing('ESP32-C6 | https://exemplo.com/spec | foca em bateria');

  assert.deepEqual(briefing, {
    theme: 'ESP32-C6',
    reference: 'https://exemplo.com/spec',
    notes: 'foca em bateria',
  });
});

test('parseBriefing reconhece a URL em qualquer posição', () => {
  const briefing = parseBriefing('tema | foca em bateria | https://exemplo.com');

  assert.equal(briefing.reference, 'https://exemplo.com');
  assert.equal(briefing.notes, 'foca em bateria');
});

test('parseBriefing aceita só o tema', () => {
  assert.deepEqual(parseBriefing('ESP32-C6'), { theme: 'ESP32-C6' });
});

test('parseBriefing devolve null sem tema', () => {
  assert.equal(parseBriefing('   '), null);
});
