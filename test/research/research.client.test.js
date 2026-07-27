import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeUrl,
  unwrapDuckDuckGoUrl,
  isDuckDuckGoAd,
} from '../../src/modules/research/research.client.js';

test('normalizeUrl completa o esquema quando o usuário não digita', () => {
  assert.equal(normalizeUrl('cienciaembarcada.com.br'), 'https://cienciaembarcada.com.br/');
});

test('normalizeUrl preserva uma URL completa', () => {
  assert.equal(
    normalizeUrl('https://espdocs.cienciaembarcada.com.br/series'),
    'https://espdocs.cienciaembarcada.com.br/series'
  );
});

test('normalizeUrl rejeita entrada vazia', () => {
  assert.throws(() => normalizeUrl('   '), /vazia/);
});

test('unwrapDuckDuckGoUrl extrai a URL real do redirecionador', () => {
  const href = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.espressif.com%2Fen%2Fproducts&rut=abc';

  assert.equal(unwrapDuckDuckGoUrl(href), 'https://www.espressif.com/en/products');
});

test('unwrapDuckDuckGoUrl devolve a própria URL quando ela não é um redirecionamento', () => {
  assert.equal(unwrapDuckDuckGoUrl('https://exemplo.com/pagina'), 'https://exemplo.com/pagina');
});

test('unwrapDuckDuckGoUrl devolve vazio para href vazio', () => {
  assert.equal(unwrapDuckDuckGoUrl(''), '');
});

test('isDuckDuckGoAd reconhece o rastreador de anúncio', () => {
  assert.equal(isDuckDuckGoAd('https://duckduckgo.com/y.js?ad_domain=aliexpress.com'), true);
});

test('isDuckDuckGoAd deixa passar uma fonte de verdade', () => {
  assert.equal(isDuckDuckGoAd('https://docs.espressif.com/esp-matter/'), false);
});
