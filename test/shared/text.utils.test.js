import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitIntoChunks, normalizeWhitespace } from '../../src/shared/text.utils.js';

test('splitIntoChunks devolve o texto inteiro quando cabe no limite', () => {
  assert.deepEqual(splitIntoChunks('texto curto', 100), ['texto curto']);
});

test('splitIntoChunks quebra em fronteira de parágrafo', () => {
  const text = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`;
  const chunks = splitIntoChunks(text, 100);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], 'a'.repeat(60));
  assert.equal(chunks[1], 'b'.repeat(60));
});

test('splitIntoChunks respeita o limite mesmo com uma linha gigante sem espaços', () => {
  const chunks = splitIntoChunks('x'.repeat(250), 100);

  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 100));
  assert.equal(chunks.join(''), 'x'.repeat(250));
});

test('splitIntoChunks nunca perde conteúdo', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Parágrafo número ${i} com algum texto.`).join('\n\n');
  const chunks = splitIntoChunks(text, 120);

  assert.ok(chunks.every((chunk) => chunk.length <= 120));
  assert.equal(chunks.join('\n\n'), text);
});

test('splitIntoChunks devolve um array com string vazia para entrada vazia', () => {
  assert.deepEqual(splitIntoChunks('', 100), ['']);
});

test('normalizeWhitespace colapsa espaços e limpa as pontas', () => {
  assert.equal(normalizeWhitespace('  linha   um  \n\n\n\n  linha dois '), 'linha um\n\nlinha dois');
});
