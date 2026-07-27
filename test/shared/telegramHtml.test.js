import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeForTelegramHtml } from '../../src/shared/telegramHtml.js';

test('converte markdown que o modelo insiste em usar', () => {
  assert.equal(sanitizeForTelegramHtml('**forte** e `codigo`'), '<b>forte</b> e <code>codigo</code>');
});

test('mantém as tags permitidas', () => {
  const input = '<b>ok</b> <a href="https://exemplo.com">link</a>';
  assert.equal(sanitizeForTelegramHtml(input), input);
});

test('escapa tags desconhecidas em vez de deixá-las quebrar a mensagem', () => {
  assert.equal(sanitizeForTelegramHtml('<div>oi</div>'), '&lt;div&gt;oi&lt;/div&gt;');
});

test('remove toda formatação quando as tags não fecham', () => {
  assert.equal(sanitizeForTelegramHtml('<b>sem fechar'), 'sem fechar');
});

test('remove formatação quando o aninhamento está trocado', () => {
  assert.equal(sanitizeForTelegramHtml('<b><i>x</b></i>'), 'x');
});

test('escapa & solto mas preserva entidades já escapadas', () => {
  assert.equal(sanitizeForTelegramHtml('A &amp; B & C'), 'A &amp; B &amp; C');
});

test('nunca lança, mesmo com entrada nula', () => {
  assert.equal(sanitizeForTelegramHtml(null), '');
  assert.equal(sanitizeForTelegramHtml(undefined), '');
});

test('tag truncada vira texto literal', () => {
  assert.equal(sanitizeForTelegramHtml('valor <cod'), 'valor &lt;cod');
});
