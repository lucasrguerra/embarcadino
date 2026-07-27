import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ResearchClient } from '../../src/modules/research/research.client.js';

const DDG_HTML = `
<div class="result">
  <h2 class="result__title">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexemplo.com%2Fesp32">Resultado do DuckDuckGo</a>
  </h2>
  <div class="result__snippet">Resumo do resultado.</div>
</div>`;

const SEARXNG_JSON = {
  results: [{ title: 'Resultado do SearXNG', url: 'https://exemplo.com/searxng', content: 'Resumo.' }],
};

/**
 * @param {(url: string) => { ok?: boolean, json?: unknown, html?: string }} respond
 */
function mockFetch(respond) {
  const calls = [];

  mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    const { ok = true, json, html } = respond(url);

    if (!ok) return { ok: false, status: 502, text: async () => 'erro' };

    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': json ? 'application/json' : 'text/html' }),
      json: async () => json,
      body: (async function* () {
        yield new TextEncoder().encode(html ?? '');
      })(),
    };
  });

  return calls;
}

afterEach(() => mock.restoreAll());

test('usa o SearXNG quando ele está configurado', async () => {
  const calls = mockFetch(() => ({ json: SEARXNG_JSON }));
  const client = new ResearchClient({
    searxngBaseUrl: 'http://searxng:8080',
    maxPageBytes: 1e6,
    timeoutMs: 5000,
  });

  const results = await client.search('esp32');

  assert.match(calls[0], /^http:\/\/searxng:8080\/search\?/);
  assert.match(calls[0], /format=json/);
  assert.equal(results[0].title, 'Resultado do SearXNG');
});

test('cai para o DuckDuckGo quando o SearXNG está fora do ar', async () => {
  const calls = mockFetch((url) =>
    url.includes('searxng') ? { ok: false } : { html: DDG_HTML }
  );
  const client = new ResearchClient({
    searxngBaseUrl: 'http://searxng:8080',
    maxPageBytes: 1e6,
    timeoutMs: 5000,
  });

  const results = await client.search('esp32');

  assert.equal(calls.length, 2);
  assert.match(calls[1], /duckduckgo\.com/);
  assert.equal(results[0].title, 'Resultado do DuckDuckGo');
  assert.equal(results[0].url, 'https://exemplo.com/esp32');
});

test('sem SearXNG configurado, vai direto para o DuckDuckGo', async () => {
  const calls = mockFetch(() => ({ html: DDG_HTML }));
  const client = new ResearchClient({ maxPageBytes: 1e6, timeoutMs: 5000 });

  await client.search('esp32');

  assert.equal(calls.length, 1);
  assert.match(calls[0], /duckduckgo\.com/);
});

test('respeita o limite de resultados pedido', async () => {
  mockFetch(() => ({
    json: { results: Array.from({ length: 9 }, (_, i) => ({ title: `r${i}`, url: `https://x/${i}` })) },
  }));
  const client = new ResearchClient({
    searxngBaseUrl: 'http://searxng:8080',
    maxPageBytes: 1e6,
    timeoutMs: 5000,
  });

  assert.equal((await client.search('esp32', 3)).length, 3);
});
