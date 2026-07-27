import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { WriterHandlers } from '../../src/modules/writer/handlers/index.js';
import { WriterFormatter } from '../../src/modules/writer/writer.formatter.js';

const DRAFT = {
  title: 'ESP32-C6 e o Matter',
  excerpt: 'Resumo.',
  categories: ['iot'],
  content: '<!-- wp:paragraph -->\n<p>oi</p>\n<!-- /wp:paragraph -->',
  words: 1200,
};

function createCtx() {
  return {
    chat: { id: 1 },
    message: { text: '/post ESP32-C6 e o Matter' },
    reply: mock.fn(async () => {}),
    replyWithDocument: mock.fn(async () => {}),
    sendChatAction: mock.fn(async () => {}),
  };
}

function createHandlers(blogService) {
  const service = { write: mock.fn(async () => DRAFT) };
  return {
    handlers: new WriterHandlers(service, new WriterFormatter(), blogService),
    service,
  };
}

test('salva o rascunho no WordPress e responde com o link de edição', async () => {
  const blogService = {
    canWrite: true,
    createDraft: mock.fn(async () => ({
      id: 42,
      editLink: 'https://blog.exemplo.com/wp-admin/post.php?post=42&action=edit',
      categories: ['iot'],
    })),
  };
  const { handlers } = createHandlers(blogService);
  const ctx = createCtx();

  await handlers.post(ctx);

  assert.equal(blogService.createDraft.mock.callCount(), 1);
  assert.match(ctx.reply.mock.calls.at(-1).arguments[0], /Rascunho criado no WordPress/);
  // Com o rascunho salvo no blog, o arquivo seria redundante.
  assert.equal(ctx.replyWithDocument.mock.callCount(), 0);
});

test('sem credencial do WordPress, entrega o rascunho como arquivo', async () => {
  const { handlers } = createHandlers({ canWrite: false, createDraft: mock.fn() });
  const ctx = createCtx();

  await handlers.post(ctx);

  assert.equal(ctx.replyWithDocument.mock.callCount(), 1);
  assert.equal(
    ctx.replyWithDocument.mock.calls[0].arguments[0].filename,
    'esp32-c6-e-o-matter.html'
  );
});

test('se o WordPress recusar, o texto não se perde — vai no arquivo', async () => {
  const blogService = {
    canWrite: true,
    createDraft: mock.fn(async () => {
      throw new Error('401 Unauthorized');
    }),
  };
  const { handlers } = createHandlers(blogService);
  const ctx = createCtx();

  await handlers.post(ctx);

  assert.equal(ctx.replyWithDocument.mock.callCount(), 1);
  assert.ok(
    ctx.reply.mock.calls.some(({ arguments: [text] }) => /não consegui salvar o rascunho/i.test(text))
  );
});

test('falha na redação não tenta salvar nada no blog', async () => {
  const blogService = { canWrite: true, createDraft: mock.fn(async () => ({})) };
  const service = {
    write: mock.fn(async () => {
      throw new Error('modelo fora do ar');
    }),
  };
  const handlers = new WriterHandlers(service, new WriterFormatter(), blogService);
  const ctx = createCtx();

  await handlers.post(ctx);

  assert.equal(blogService.createDraft.mock.callCount(), 0);
  assert.match(ctx.reply.mock.calls.at(-1).arguments[0], /Não consegui fechar esse rascunho/);
});
