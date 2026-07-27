import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ConversationStore } from '../../src/shared/conversation.store.js';

test('guarda e devolve o histórico de um chat', () => {
  const store = new ConversationStore({ maxMessages: 10, ttlMs: 60_000 });
  store.append(1, 'oi', 'olá');

  assert.deepEqual(store.get(1), [
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'olá' },
  ]);
});

test('isola o histórico por chat', () => {
  const store = new ConversationStore({ maxMessages: 10, ttlMs: 60_000 });
  store.append(1, 'pergunta do chat 1', 'resposta');

  assert.deepEqual(store.get(2), []);
});

test('mantém apenas as últimas mensagens dentro do limite', () => {
  const store = new ConversationStore({ maxMessages: 4, ttlMs: 60_000 });
  store.append(1, 'p1', 'r1');
  store.append(1, 'p2', 'r2');
  store.append(1, 'p3', 'r3');

  const messages = store.get(1);
  assert.equal(messages.length, 4);
  assert.equal(messages[0].content, 'p2');
  assert.equal(messages.at(-1).content, 'r3');
});

test('esquece a conversa depois do TTL', () => {
  const store = new ConversationStore({ maxMessages: 10, ttlMs: -1 });
  store.append(1, 'oi', 'olá');

  assert.deepEqual(store.get(1), []);
});

test('clear informa se havia algo para esquecer', () => {
  const store = new ConversationStore({ maxMessages: 10, ttlMs: 60_000 });
  store.append(1, 'oi', 'olá');

  assert.equal(store.clear(1), true);
  assert.equal(store.clear(1), false);
  assert.deepEqual(store.get(1), []);
});
