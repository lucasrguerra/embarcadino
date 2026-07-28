import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SourceRegistry, sourceKey } from '../../src/modules/research/source.registry.js';

test('sourceKey ignora esquema, www, barra final, query e caixa', () => {
  const canonical = sourceKey('https://docs.espressif.com/guide/wdts.html');

  assert.equal(sourceKey('http://www.docs.espressif.com/guide/wdts.html'), canonical);
  assert.equal(sourceKey('https://docs.espressif.com/guide/wdts.html?lang=en#top'), canonical);
  assert.equal(sourceKey('https://DOCS.espressif.com/Guide/wdts.html/'), canonical);
});

test('sourceKey recusa o que não é endereço navegável', () => {
  assert.equal(sourceKey('magnet:?xt=urn:btih:abc'), '');
  assert.equal(sourceKey('/caminho/relativo'), '');
  assert.equal(sourceKey(''), '');
});

test('registry separa página vista na busca de página lida', () => {
  const registry = new SourceRegistry();
  registry.addSearchResults([{ url: 'https://a.com/x' }, { url: 'https://b.com/y' }]);
  registry.addRead('https://a.com/x');

  assert.ok(registry.wasSeen('https://b.com/y'));
  assert.ok(!registry.wasRead('https://b.com/y'));
  assert.ok(registry.wasRead('https://a.com/x'));
  assert.deepEqual(registry.readUrls(), ['https://a.com/x']);
  assert.equal(registry.readCount, 1);
});

test('registry não conta a mesma página duas vezes', () => {
  const registry = new SourceRegistry();
  registry.addRead('https://a.com/x');
  registry.addRead('https://www.a.com/x/');

  assert.equal(registry.readCount, 1);
});

test('clear zera o registro entre redações', () => {
  const registry = new SourceRegistry();
  registry.addRead('https://a.com/x');
  registry.clear();

  assert.equal(registry.readCount, 0);
  assert.ok(!registry.wasRead('https://a.com/x'));
});
