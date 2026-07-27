import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_CHAT_IDS = '1018092188';

const { registerRoutes } = await import('../../src/bot/router.js');

function createFakeBot() {
  const commands = new Map();
  const actions = new Map();
  const onHandlers = [];
  const middlewares = [];
  let catchHandler = null;

  return {
    commands,
    actions,
    onHandlers,
    middlewares,
    use: (fn) => middlewares.push(fn),
    command: (name, fn) => commands.set(name, fn),
    action: (pattern, fn) => actions.set(pattern, fn),
    on: (type, fn) => onHandlers.push({ type, fn }),
    catch: (fn) => {
      catchHandler = fn;
    },
    getCatchHandler: () => catchHandler,
  };
}

function noopHandlers() {
  const handler = () => mock.fn(async () => {});
  return {
    ai: { ask: handler(), reset: handler() },
    blog: { search: handler(), latest: handler() },
    knowledge: {
      about: handler(),
      services: handler(),
      inbraille: handler(),
      espdocs: handler(),
      entryCallback: handler(),
    },
    research: { search: handler(), page: handler() },
    writer: { post: handler() },
  };
}

function createFakeCtx(overrides = {}) {
  return {
    chat: { id: 1018092188 },
    from: { id: 1018092188, username: 'lucas' },
    updateType: 'message',
    reply: mock.fn(async () => {}),
    sendChatAction: mock.fn(async () => {}),
    ...overrides,
  };
}

test('registra todos os comandos públicos e o restrito', () => {
  const bot = createFakeBot();
  registerRoutes(bot, noopHandlers());

  const expected = [
    'start',
    'help',
    'sobre',
    'servicos',
    'inbraille',
    'espdocs',
    'blog',
    'ultimos',
    'pesquisar',
    'pagina',
    'post',
    'ask',
    'reset',
  ];

  assert.deepEqual([...bot.commands.keys()].sort(), [...expected].sort());
});

test('texto solto sem barra é encaminhado para a IA', async () => {
  const bot = createFakeBot();
  const handlers = noopHandlers();
  registerRoutes(bot, handlers);

  const fallback = bot.onHandlers.find((entry) => entry.type === 'message');
  await fallback.fn(createFakeCtx({ message: { text: 'o que é LoRaWAN?' } }));

  assert.equal(handlers.ai.ask.mock.callCount(), 1);
});

test('comando desconhecido não vai para a IA', async () => {
  const bot = createFakeBot();
  const handlers = noopHandlers();
  registerRoutes(bot, handlers);

  const ctx = createFakeCtx({ message: { text: '/naoexiste' } });
  const fallback = bot.onHandlers.find((entry) => entry.type === 'message');
  await fallback.fn(ctx);

  assert.equal(handlers.ai.ask.mock.callCount(), 0);
  assert.equal(ctx.reply.mock.callCount(), 1);
});

test('/post é liberado para chat administrador', async () => {
  const bot = createFakeBot();
  const handlers = noopHandlers();
  registerRoutes(bot, handlers);

  await bot.commands.get('post')(createFakeCtx({ message: { text: '/post tema' } }));

  assert.equal(handlers.writer.post.mock.callCount(), 1);
});

test('/post é negado para qualquer outro chat', async () => {
  const bot = createFakeBot();
  const handlers = noopHandlers();
  registerRoutes(bot, handlers);

  const ctx = createFakeCtx({ chat: { id: 999 }, message: { text: '/post tema' } });
  await bot.commands.get('post')(ctx);

  assert.equal(handlers.writer.post.mock.callCount(), 0);
  assert.match(ctx.reply.mock.calls[0].arguments[0], /só do Lucas/);
});

test('handler que lança vira mensagem de erro, não exceção', async () => {
  const bot = createFakeBot();
  const handlers = noopHandlers();
  handlers.blog.search = mock.fn(async () => {
    throw new Error('API fora do ar');
  });
  registerRoutes(bot, handlers);

  const ctx = createFakeCtx({ message: { text: '/blog lora' } });
  await bot.commands.get('blog')(ctx);

  assert.equal(ctx.reply.mock.callCount(), 1);
  assert.match(ctx.reply.mock.calls[0].arguments[0], /Deu ruim/);
});
