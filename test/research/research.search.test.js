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

const TRENDS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:ht="https://trends.google.com/trending/rss">
  <channel>
    <item>
      <title>esp32 matter</title>
      <ht:approx_traffic>10K+</ht:approx_traffic>
      <ht:news_item>
        <ht:news_item_title>Novo chip ESP32 com suporte a Matter 1.3</ht:news_item_title>
      </ht:news_item>
    </item>
  </channel>
</rss>`;

test('fetchGoogleTrends busca e faz parse das pesquisas em alta via RSS', async () => {
  const calls = mockFetch(() => ({ html: TRENDS_XML }));
  const client = new ResearchClient({ maxPageBytes: 1e6, timeoutMs: 5000 });

  const data = await client.fetchGoogleTrends('BR');

  assert.match(calls[0], /trends\.google\.com\/trending\/rss\?geo=BR/);
  assert.equal(data.geo, 'BR');
  assert.equal(data.trends.length, 1);
  assert.equal(data.trends[0].title, 'esp32 matter');
  assert.equal(data.trends[0].traffic, '10K+');
  assert.equal(data.trends[0].news[0].title, 'Novo chip ESP32 com suporte a Matter 1.3');
});
