import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { AiClient } from '../../src/modules/ai/ai.client.js';
import { LlmAuthError, LlmQuotaError } from '../../src/modules/ai/ai.errors.js';

const CONFIG = { baseUrl: 'https://llm.exemplo.com/v1', apiKey: 'chave', model: 'modelo-x' };

/** Resposta de sucesso mínima no formato da API da OpenAI. */
function okResponse(content = 'texto') {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Encadeia respostas: cada chamada de fetch consome a próxima da fila.
 * @param {Response[]} responses
 */
function stubFetch(responses) {
  const queue = [...responses];
  const fetchMock = mock.fn(async () => queue.shift() ?? okResponse());
  globalThis.fetch = fetchMock;
  return fetchMock;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('cota diária esgotada vira LlmQuotaError com a hora da liberação, sem retry', async () => {
  // O reset é amanhã: insistir só queimaria tempo e o usuário precisa saber a hora.
  const resetAt = Date.now() + 6 * 60 * 60 * 1000;
  const fetchMock = stubFetch([
    new Response(
      JSON.stringify({
        error: {
          message: 'Rate limit exceeded: free-models-per-day.',
          code: 429,
          metadata: { headers: { 'X-RateLimit-Limit': '50', 'X-RateLimit-Reset': String(resetAt) } },
        },
      }),
      { status: 429 }
    ),
  ]);

  await assert.rejects(
    () => new AiClient(CONFIG).chat([{ role: 'user', content: 'oi' }]),
    LlmQuotaError
  );

  assert.equal(fetchMock.mock.callCount(), 1, 'não deve tentar de novo um limite diário');
});

test('a hora da liberação fica acessível em resetAt', async () => {
  const resetAt = Date.now() + 6 * 60 * 60 * 1000;
  stubFetch([
    new Response(
      JSON.stringify({
        error: {
          message: 'Rate limit exceeded: free-models-per-day.',
          code: 429,
          metadata: { headers: { 'X-RateLimit-Reset': String(resetAt) } },
        },
      }),
      { status: 429 }
    ),
  ]);

  await assert.rejects(
    () => new AiClient(CONFIG).chat([{ role: 'user', content: 'oi' }]),
    (err) => {
      assert.ok(err instanceof LlmQuotaError);
      assert.equal(err.resetAt.getTime(), resetAt);
      return true;
    }
  );
});

test('limite por minuto é aguardado e a chamada é refeita sozinha', async () => {
  // Limite curto (Retry-After: 1s) é transitório: desistir aqui jogaria fora
  // uma redação de vários minutos por causa de 1 segundo de espera.
  const fetchMock = stubFetch([
    new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
      status: 429,
      headers: { 'retry-after': '1' },
    }),
    okResponse('deu certo'),
  ]);

  const { message } = await new AiClient(CONFIG).chat([{ role: 'user', content: 'oi' }]);

  assert.equal(message.content, 'deu certo');
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('erro 5xx do provedor é repetido com backoff', async () => {
  const fetchMock = stubFetch([
    new Response('upstream indisponível', { status: 503 }),
    okResponse('respondeu na segunda'),
  ]);

  const { message } = await new AiClient(CONFIG).chat([{ role: 'user', content: 'oi' }]);

  assert.equal(message.content, 'respondeu na segunda');
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('chave inválida vira LlmAuthError e não é repetida', async () => {
  const fetchMock = stubFetch([new Response('{"error":{"message":"invalid key"}}', { status: 401 })]);

  await assert.rejects(
    () => new AiClient(CONFIG).chat([{ role: 'user', content: 'oi' }]),
    LlmAuthError
  );
  assert.equal(fetchMock.mock.callCount(), 1, 'chave errada não melhora com repetição');
});

test('429 devolvido com status 200 no corpo também vira LlmQuotaError', async () => {
  // O OpenRouter responde 200 com `error` no corpo quando o provedor upstream
  // é que limitou — sem isso o erro vira "rascunho vazio" lá na frente.
  stubFetch([
    new Response(
      JSON.stringify({ error: { message: 'Provider rate limit exceeded', code: 429 } }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ),
  ]);

  await assert.rejects(
    () => new AiClient(CONFIG).chat([{ role: 'user', content: 'oi' }]),
    LlmQuotaError
  );
});
