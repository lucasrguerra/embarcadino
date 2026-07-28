import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createToolDispatcher, describeReadFailure, queryFromUrl } from '../../src/modules/ai/ai.tools.js';

/**
 * @param {Object} researchService
 * @returns {Record<string, Function>}
 */
function dispatcherWith(researchService) {
  return createToolDispatcher({
    researchService,
    blogService: {},
    knowledgeService: { list: () => [], ids: () => [] },
  });
}

test('queryFromUrl deriva termos do host e do caminho', () => {
  assert.equal(
    queryFromUrl('https://randomnerdtutorials.com/esp32-brownout-detector-was-triggered/'),
    'randomnerdtutorials esp32 brownout detector was triggered'
  );
  assert.equal(queryFromUrl('https://docs.espressif.com/guide/fatal-errors.html'), 'docs guide fatal errors');
  assert.equal(queryFromUrl('não é url ::'), '');
});

test('describeReadFailure trata 404 como URL inventada', () => {
  const found = describeReadFailure('https://x.com/y', new Error('Requisição para https://x.com/y falhou com status 404.'));
  assert.match(found.hint, /não existe/);
  assert.match(found.hint, /web_search/);

  const network = describeReadFailure('https://x.com/y', new Error('fetch failed'));
  assert.match(network.hint, /não respondeu/);
});

test('read_page devolve sugestões reais quando a URL não existe', async () => {
  const searched = [];
  const tools = dispatcherWith({
    async readPage() {
      throw new Error('Requisição para https://randomnerdtutorials.com/x/ falhou com status 404.');
    },
    async search(query) {
      searched.push(query);
      return [{ title: 'Brownout no ESP32', url: 'https://real.com/brownout', snippet: '' }];
    },
  });

  const result = await tools.read_page({ url: 'https://randomnerdtutorials.com/esp32-brownout/' });

  assert.match(result.error, /404/);
  assert.match(result.hint, /não existe/);
  assert.deepEqual(result.suggestions, [{ title: 'Brownout no ESP32', url: 'https://real.com/brownout' }]);
  assert.match(searched[0], /esp32 brownout/);
});

test('read_page não vira erro de tool quando a busca de sugestão também falha', async () => {
  const tools = dispatcherWith({
    async readPage() {
      throw new Error('fetch failed');
    },
    async search() {
      throw new Error('SearXNG fora do ar');
    },
  });

  const result = await tools.read_page({ url: 'https://x.com/y' });

  assert.deepEqual(result.suggestions, []);
  assert.match(result.error, /fetch failed/);
});

test('read_page devolve a página quando a leitura funciona', async () => {
  const tools = dispatcherWith({
    async readPage(url) {
      return { url, title: 'T', description: 'D', text: 'conteúdo', truncated: false, links: [] };
    },
  });

  const result = await tools.read_page({ url: 'https://ok.com' });

  assert.equal(result.content, 'conteúdo');
  assert.equal(result.error, undefined);
});

test('o dispatcher registra o que a busca devolveu e o que foi lido', async () => {
  const { SourceRegistry } = await import('../../src/modules/research/source.registry.js');
  const sources = new SourceRegistry();

  const tools = createToolDispatcher({
    researchService: {
      async search() {
        return [{ title: 'A', url: 'https://a.com/x', snippet: '' }];
      },
      async readPage(url) {
        // A leitura segue redirecionamento: registra a URL final, não a pedida.
        return { url: `${url}/final`, title: '', description: '', text: '', truncated: false, links: [] };
      },
    },
    blogService: { async search() { return [{ url: 'https://blog/post' }]; } },
    knowledgeService: { list: () => [], ids: () => [] },
    sources,
  });

  await tools.web_search({ query: 'esp32' });
  await tools.blog_search({ query: 'esp32' });
  await tools.read_page({ url: 'https://a.com/x' });

  assert.ok(sources.wasSeen('https://a.com/x'));
  assert.ok(sources.wasSeen('https://blog/post'));
  assert.ok(sources.wasRead('https://a.com/x/final'));
  assert.ok(!sources.wasRead('https://a.com/x'), 'só a URL final conta como lida');
});

test('read_page que falha não entra no registro de fontes', async () => {
  const { SourceRegistry } = await import('../../src/modules/research/source.registry.js');
  const sources = new SourceRegistry();

  const tools = createToolDispatcher({
    researchService: {
      async readPage() { throw new Error('Requisição falhou com status 404.'); },
      async search() { return []; },
    },
    blogService: {},
    knowledgeService: { list: () => [], ids: () => [] },
    sources,
  });

  await tools.read_page({ url: 'https://inventada.com/x' });

  assert.equal(sources.readCount, 0);
});
