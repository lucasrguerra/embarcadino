import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LlmAuthError, LlmQuotaError, describeLlmFailure } from '../../src/modules/ai/ai.errors.js';

test('cota que só volta amanhã informa o horário, não manda tentar de novo', () => {
  const resetAt = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const message = describeLlmFailure(new LlmQuotaError('free-models-per-day', { resetAt }));

  assert.match(message, /cota/i);
  assert.doesNotMatch(message, /tenta de novo/i);
  // O horário vai no fuso de São Paulo, que é o do Lucas.
  assert.match(message, /\d{2}:\d{2}/);
});

test('cota sem horário informado ainda diz que o problema é limite, não o tema', () => {
  const message = describeLlmFailure(new LlmQuotaError('rate limited'));

  assert.match(message, /limite/i);
});

test('credencial inválida é apontada como configuração, não como falha passageira', () => {
  const message = describeLlmFailure(new LlmAuthError('invalid api key', { status: 401 }));

  assert.match(message, /chave/i);
  assert.doesNotMatch(message, /daqui a pouco/i);
});

test('erro comum não vira mensagem especializada', () => {
  assert.equal(describeLlmFailure(new Error('qualquer outra coisa')), null);
});
