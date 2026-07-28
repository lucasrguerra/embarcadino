import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AI_TOOLS, createToolDispatcher } from '../../src/modules/ai/ai.tools.js';
import { KnowledgeService } from '../../src/modules/knowledge/knowledge.service.js';

function createDispatcher(overrides = {}) {
  return createToolDispatcher({
    researchService: {
      search: async (query, limit) => [{ title: 'r', url: 'https://x', snippet: '', query, limit }],
      readPage: async (url) => ({ url, title: 't', description: '', text: 'conteúdo', truncated: false, links: [] }),
      ...overrides.researchService,
    },
    blogService: {
      search: async (query, limit) => [{ id: 1, title: 'post', query, limit }],
      latest: async (limit) => [{ id: 2, title: 'recente', limit }],
      getPost: async (id) => ({ id, content: 'texto' }),
      ...overrides.blogService,
    },
    knowledgeService: new KnowledgeService(),
  });
}

test('toda tool declarada tem implementação no dispatcher', () => {
  const dispatcher = createDispatcher();

  for (const tool of AI_TOOLS) {
    assert.equal(
      typeof dispatcher[tool.function.name],
      'function',
      `tool ${tool.function.name} não tem implementação`
    );
  }
});

test('o dispatcher não expõe nenhuma função além das tools declaradas', () => {
  const declared = AI_TOOLS.map((tool) => tool.function.name).sort();
  assert.deepEqual(Object.keys(createDispatcher()).sort(), declared);
});

test('web_search normaliza limite inválido para o padrão', async () => {
  const dispatcher = createDispatcher();

  const semLimite = await dispatcher.web_search({ query: 'esp32' });
  assert.equal(semLimite.results[0].limit, 8);

  const limiteAbsurdo = await dispatcher.web_search({ query: 'esp32', limit: 500 });
  assert.equal(limiteAbsurdo.results[0].limit, 10);

  const limiteTexto = await dispatcher.web_search({ query: 'esp32', limit: '3' });
  assert.equal(limiteTexto.results[0].limit, 3);
});

test('knowledge_lookup sem argumento devolve todos os projetos', async () => {
  const { projects } = await createDispatcher().knowledge_lookup({});

  assert.deepEqual(
    projects.map((project) => project.id),
    ['ciencia-embarcada', 'inbraille', 'espdocs']
  );
});

test('knowledge_lookup devolve o projeto pedido', async () => {
  const entry = await createDispatcher().knowledge_lookup({ project: 'inbraille' });

  assert.equal(entry.name, 'InBraille');
  assert.equal(entry.url, 'https://inbraille.cienciaembarcada.com.br');
});

test('knowledge_lookup avisa quando o projeto não existe, em vez de inventar', async () => {
  const result = await createDispatcher().knowledge_lookup({ project: 'inexistente' });

  assert.match(result.error, /desconhecido/);
  assert.deepEqual(result.known, ['ciencia-embarcada', 'inbraille', 'espdocs']);
});

test('o enum de knowledge_lookup cobre exatamente os projetos existentes', () => {
  const tool = AI_TOOLS.find((item) => item.function.name === 'knowledge_lookup');

  assert.deepEqual(tool.function.parameters.properties.project.enum, new KnowledgeService().ids());
});
