import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { BlogClient } from '../../src/modules/blog/blog.client.js';
import { BlogService } from '../../src/modules/blog/blog.service.js';

const CREDENTIALS = { baseUrl: 'https://blog.exemplo.com', username: 'lucas', appPassword: 'abcd EFGH ijkl' };

/**
 * Substitui o fetch global, registrando as chamadas feitas.
 * @param {(url: string, options: Object) => unknown} respond
 */
function mockFetch(respond) {
  const calls = [];

  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, options });
    const body = respond(url, options);

    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });

  return calls;
}

afterEach(() => mock.restoreAll());

test('canWrite é falso sem credenciais', () => {
  assert.equal(new BlogClient({ baseUrl: 'https://blog.exemplo.com' }).canWrite, false);
});

test('canWrite é verdadeiro com usuário e senha de aplicação', () => {
  assert.equal(new BlogClient(CREDENTIALS).canWrite, true);
});

test('createDraft envia Basic Auth com os espaços da senha removidos', async () => {
  const calls = mockFetch(() => ({ id: 42, link: 'https://blog.exemplo.com/?p=42', status: 'draft' }));

  await new BlogClient(CREDENTIALS).createDraft({ title: 'T', excerpt: 'R', content: '<p>c</p>' });

  const esperado = `Basic ${Buffer.from('lucas:abcdEFGHijkl').toString('base64')}`;
  assert.equal(calls[0].options.headers.Authorization, esperado);
});

test('createDraft sempre cria como rascunho, nunca publica', async () => {
  const calls = mockFetch(() => ({ id: 42, status: 'draft' }));

  await new BlogClient(CREDENTIALS).createDraft({ title: 'T', excerpt: 'R', content: '<p>c</p>' });

  assert.equal(JSON.parse(calls[0].options.body).status, 'draft');
  assert.equal(calls[0].options.method, 'POST');
});

test('createDraft devolve o link de edição no painel', async () => {
  mockFetch(() => ({ id: 42, link: 'https://blog.exemplo.com/?p=42', status: 'draft' }));

  const created = await new BlogClient(CREDENTIALS).createDraft({ title: 'T', excerpt: '', content: '' });

  assert.equal(created.editLink, 'https://blog.exemplo.com/wp-admin/post.php?post=42&action=edit');
});

test('createDraft recusa quando não há credencial configurada', async () => {
  const client = new BlogClient({ baseUrl: 'https://blog.exemplo.com' });

  await assert.rejects(() => client.createDraft({ title: 'T', excerpt: '', content: '' }), /não configuradas/);
});

test('a busca de publicações não manda credencial junto', async () => {
  const calls = mockFetch(() => []);

  await new BlogClient(CREDENTIALS).listPosts({ search: 'lora' });

  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test('as categorias são buscadas uma vez só e reaproveitadas', async () => {
  const calls = mockFetch(() => [{ id: 6, name: 'IoT', slug: 'iot' }]);
  const client = new BlogClient(CREDENTIALS);

  await Promise.all([client.listCategories(), client.listCategories()]);
  await client.listCategories();

  assert.equal(calls.length, 1);
});

test('createDraft traduz slug de categoria para o id do WordPress', async () => {
  const calls = mockFetch((url) =>
    url.includes('/categories')
      ? [
          { id: 6, name: 'IoT', slug: 'iot' },
          { id: 20, name: 'Redes', slug: 'redes' },
        ]
      : { id: 42, link: '', status: 'draft' }
  );

  const service = new BlogService(new BlogClient(CREDENTIALS));
  const created = await service.createDraft({
    title: 'T',
    excerpt: 'R',
    content: '<p>c</p>',
    categories: ['iot', 'redes', 'inexistente'],
  });

  const enviado = JSON.parse(calls.at(-1).options.body);
  assert.deepEqual(enviado.categories, [6, 20]);
  assert.deepEqual(created.categories, ['iot', 'redes']);
});
