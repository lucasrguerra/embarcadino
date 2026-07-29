import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDraft, parseCategories, countWords, parseTopics } from '../../src/modules/writer/writer.service.js';
import { parseBriefing } from '../../src/modules/writer/handlers/index.js';
import { seoReadyEnvelope } from './draft.fixture.js';

const ENVELOPE = `===TITULO===
ESP32-C6: o chip do Matter

===RESUMO===
O ESP32-C6 traz Wi-Fi 6 e Thread nativos.

===CATEGORIAS===
iot, sistemas-embarcados, hardware

===CONTEUDO===
<!-- wp:paragraph -->
<p>O ESP32-C6 traz Wi-Fi 6 e Thread nativos.</p>
<!-- /wp:paragraph -->`;

test('parseDraft separa as seções do envelope', () => {
  const draft = parseDraft(ENVELOPE);

  assert.equal(draft.title, 'ESP32-C6: o chip do Matter');
  assert.equal(draft.excerpt, 'O ESP32-C6 traz Wi-Fi 6 e Thread nativos.');
  assert.ok(draft.content.startsWith('<!-- wp:paragraph -->'));
});

test('parseDraft descarta categoria que não existe no blog', () => {
  assert.deepEqual(parseDraft(ENVELOPE).categories, ['iot', 'sistemas-embarcados']);
});

test('parseDraft usa o tema como título quando o marcador falta', () => {
  const draft = parseDraft('texto solto sem envelope nenhum', 'LoRaWAN');

  assert.equal(draft.title, 'LoRaWAN');
  assert.equal(draft.content, 'texto solto sem envelope nenhum');
});

test('parseCategories aceita quebra de linha, bullet e caixa alta', () => {
  assert.deepEqual(parseCategories('- IoT\n• Redes\nSeguranca'), ['iot', 'redes', 'seguranca']);
});

test('parseCategories remove duplicatas', () => {
  assert.deepEqual(parseCategories('iot, iot, redes'), ['iot', 'redes']);
});

test('countWords ignora blocos e tags do Gutenberg', () => {
  const content = '<!-- wp:paragraph -->\n<p>uma frase com cinco palavras</p>\n<!-- /wp:paragraph -->';
  assert.equal(countWords(content), 5);
});

test('parseBriefing separa tema, referência e observações', () => {
  const briefing = parseBriefing('ESP32-C6 | https://exemplo.com/spec | foca em bateria');

  assert.deepEqual(briefing, {
    theme: 'ESP32-C6',
    reference: 'https://exemplo.com/spec',
    notes: 'foca em bateria',
  });
});

test('parseBriefing reconhece a URL em qualquer posição', () => {
  const briefing = parseBriefing('tema | foca em bateria | https://exemplo.com');

  assert.equal(briefing.reference, 'https://exemplo.com');
  assert.equal(briefing.notes, 'foca em bateria');
});

test('parseBriefing aceita só o tema', () => {
  assert.deepEqual(parseBriefing('ESP32-C6'), { theme: 'ESP32-C6' });
});

test('parseBriefing devolve null sem tema', () => {
  assert.equal(parseBriefing('   '), null);
});

test('WriterService envia toolChoice: "none" após resposta sem marcadores', async () => {
  const calls = [];
  const mockClient = {
    async chat(messages, options) {
      calls.push({ messages: [...messages], options });
      if (calls.length === 1) {
        // Primeira resposta: sem marcadores
        return { message: { role: 'assistant', content: 'Texto sem marcadores' } };
      }
      // Segunda resposta: com marcadores
      return { message: { role: 'assistant', content: ENVELOPE } };
    },
  };

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const service = new WriterService(mockClient, [{ type: 'function' }], {});

  const draft = await service.write({ theme: 'ESP32-C6' });

  assert.equal(draft.title, 'ESP32-C6: o chip do Matter');
  // 2 chamadas de redação + as revisões de SEO, que o envelope mínimo do teste
  // nunca satisfaz (curto, sem imagem, sem fontes).
  assert.ok(calls.length >= 2);
  // No primeiro call, toolChoice não foi 'none'
  assert.equal(calls[0].options.toolChoice, undefined);
  // No segundo call (retry), toolChoice foi 'none' para impedir novas chamadas a ferramentas
  assert.equal(calls[1].options.toolChoice, 'none');
  // Ambas as chamadas passaram o array de tools para manter validade de esquema da API
  assert.equal(calls[0].options.tools.length, 1);
  assert.equal(calls[1].options.tools.length, 1);
});

/** Turno em que o modelo lê duas fontes — pré-requisito para o rascunho ser aceito. */
const READS_SOURCES = {
  role: 'assistant',
  tool_calls: [
    { id: '1', function: { name: 'read_page', arguments: '{}' } },
    { id: '2', function: { name: 'read_page', arguments: '{}' } },
  ],
};

/**
 * Cliente falso que devolve uma resposta por chamada, na ordem dada.
 * @param {Array<Object|string>} turns - String vira conteúdo de assistant
 * @returns {{ client: Object, calls: Array<Object> }}
 */
function conversation(turns) {
  const calls = [];
  const client = {
    async chat(messages, options) {
      const turn = turns[Math.min(calls.length, turns.length - 1)];
      calls.push({ last: messages[messages.length - 1], sent: [...messages], options });
      return { message: typeof turn === 'string' ? { role: 'assistant', content: turn } : turn };
    },
  };

  return { client, calls };
}

/** @returns {Record<string, Function>} */
function dispatcher() {
  return { read_page: async () => ({ text: 'conteúdo lido' }), web_search: async () => [] };
}

test('WriterService devolve o rascunho ao modelo quando a auditoria de SEO reprova', async () => {
  const longTitle = 'ESP32-C6 e o protocolo Matter: tudo o que muda no projeto de nós de rede';
  const { client, calls } = conversation([
    READS_SOURCES,
    seoReadyEnvelope(longTitle),
    seoReadyEnvelope(),
  ]);

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const draft = await new WriterService(client, [{ type: 'function' }], dispatcher()).write({
    theme: 'ESP32-C6',
  });

  assert.equal(calls.length, 3);
  assert.match(calls[2].last.content, /O título tem 72 caracteres/);
  assert.equal(calls[2].options.toolChoice, 'none');
  assert.equal(draft.title, 'ESP32-C6: o chip do Matter');
  assert.deepEqual(draft.seo, []);
});

test('WriterService não pede revisão quando o rascunho já passa na auditoria', async () => {
  const { client, calls } = conversation([READS_SOURCES, seoReadyEnvelope()]);

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const draft = await new WriterService(client, [], dispatcher()).write({ theme: 'ESP32-C6' });

  assert.equal(calls.length, 2);
  assert.deepEqual(draft.seo, []);
});

test('WriterService exige read_page antes de aceitar o rascunho', async () => {
  const { client, calls } = conversation([
    { role: 'assistant', tool_calls: [{ id: '1', function: { name: 'web_search', arguments: '{}' } }] },
    seoReadyEnvelope(),
    READS_SOURCES,
    seoReadyEnvelope(),
  ]);

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  await new WriterService(client, [{ type: 'function' }], dispatcher()).write({ theme: 'ESP32-C6' });

  // A terceira chamada carrega a cobrança de leitura de fontes.
  assert.match(calls[2].last.content, /read_page/);
  assert.match(calls[2].last.content, /fontes primárias/);
  // E as tools continuam liberadas, senão ele não teria como pesquisar.
  assert.notEqual(calls[2].options.toolChoice, 'none');
});

test('WriterService descarta revisão que corta o texto', async () => {
  const longTitle = 'ESP32-C6 e o protocolo Matter: tudo o que muda no projeto de nós de rede';
  const mutilated = `===TITULO===\nCurto\n\n===CONTEUDO===\n<!-- wp:paragraph --><p>Nada.</p><!-- /wp:paragraph -->`;
  const { client } = conversation([READS_SOURCES, seoReadyEnvelope(longTitle), mutilated]);

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const draft = await new WriterService(client, [], dispatcher()).write({ theme: 'ESP32-C6' });

  assert.equal(draft.title, longTitle);
  assert.ok(draft.words > 800, `esperava manter o texto longo, veio com ${draft.words}`);
  assert.ok(draft.seo.some((issue) => issue.code === 'title-length'));
});

test('WriterService rejeita revisão que perde mais de 5% do texto', async () => {
  const longTitle = 'ESP32-C6 e o protocolo Matter: tudo o que muda no projeto de nós de rede';
  const { client } = conversation([
    READS_SOURCES,
    seoReadyEnvelope(longTitle, { sentences: 200 }),
    // Mesmo rascunho, com 60% das frases: forma corrigida à custa de conteúdo.
    seoReadyEnvelope(undefined, { sentences: 120 }),
  ]);

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const draft = await new WriterService(client, [], dispatcher()).write({ theme: 'ESP32-C6' });

  assert.equal(draft.title, longTitle, 'a revisão encolhida deveria ter sido descartada');
});

test('WriterService entrega o rascunho mesmo se a chamada de revisão falhar', async () => {
  const longTitle = 'ESP32-C6 e o protocolo Matter: tudo o que muda no projeto de nós de rede';
  let calls = 0;
  const client = {
    async chat() {
      calls++;
      if (calls === 1) return { message: READS_SOURCES };
      if (calls === 2) return { message: { role: 'assistant', content: seoReadyEnvelope(longTitle) } };
      throw new Error('502 upstream');
    },
  };

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const draft = await new WriterService(client, [], dispatcher()).write({ theme: 'ESP32-C6' });

  assert.equal(draft.title, longTitle);
  assert.ok(draft.words > 800);
});

test('WriterService libera as ferramentas na revisão quando faltam fontes', async () => {
  // Rascunho com uma fonte externa só: reprova em external-links.
  const oneSource = seoReadyEnvelope().replace(
    /<a href="https:\/\/www\.rfc-editor\.org[^"]*"/,
    '<a href="https://docs.espressif.com/outro"'
  ).replace(/<a href="https:\/\/csa-iot\.org[^"]*"/, '<a href="https://docs.espressif.com/mais"');

  const { client, calls } = conversation([READS_SOURCES, oneSource, READS_SOURCES, seoReadyEnvelope()]);

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const draft = await new WriterService(client, [{ type: 'function' }], dispatcher()).write({
    theme: 'ESP32-C6',
  });

  // O pedido de revisão cobra as referências…
  assert.match(calls[2].last.content, /fonte\(s\) externa\(s\)/);
  // …e chega com as tools liberadas, senão o modelo não teria como ler a fonte.
  assert.notEqual(calls[2].options.toolChoice, 'none');
  assert.deepEqual(draft.seo, []);
});

test('WriterService bloqueia as ferramentas na revisão puramente de forma', async () => {
  const longTitle = 'ESP32-C6 e o protocolo Matter: tudo o que muda no projeto de nós de rede';
  const { client, calls } = conversation([READS_SOURCES, seoReadyEnvelope(longTitle), seoReadyEnvelope()]);

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  await new WriterService(client, [{ type: 'function' }], dispatcher()).write({ theme: 'ESP32-C6' });

  assert.equal(calls[2].options.toolChoice, 'none');
});

test('WriterService não conta read_page que falhou como pesquisa feita', async () => {
  const { client, calls } = conversation([
    // Duas "leituras" que devolvem erro: não deveriam satisfazer a exigência.
    {
      role: 'assistant',
      tool_calls: [
        { id: '1', function: { name: 'read_page', arguments: '{}' } },
        { id: '2', function: { name: 'read_page', arguments: '{}' } },
      ],
    },
    seoReadyEnvelope(),
    READS_SOURCES,
    seoReadyEnvelope(),
  ]);

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  await new WriterService(client, [{ type: 'function' }], {
    read_page: async () => ({ error: 'Não consegui ler: status 404.' }),
  }).write({ theme: 'ESP32-C6' });

  assert.match(calls[2].last.content, /fontes primárias/);
});

test('WriterService insiste depois de uma revisão que encolheu o texto', async () => {
  const longTitle = 'ESP32-C6 e o protocolo Matter: tudo o que muda no projeto de nós de rede';
  const { client, calls } = conversation([
    READS_SOURCES,
    seoReadyEnvelope(longTitle, { sentences: 200 }),
    seoReadyEnvelope(undefined, { sentences: 100 }), // encolheu: descartada
    seoReadyEnvelope(undefined, { sentences: 200 }), // segunda tentativa, íntegra
  ]);

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const draft = await new WriterService(client, [], dispatcher()).write({ theme: 'ESP32-C6' });

  // A quarta chamada existe porque o ciclo não desistiu na revisão ruim.
  assert.equal(calls.length, 4);
  // O aviso do encolhimento ficou no histórico, antes do novo pedido de revisão.
  assert.ok(calls[3].sent.some((m) => /cortou o texto/.test(m.content ?? '')));
  assert.equal(draft.title, 'ESP32-C6: o chip do Matter');
  assert.deepEqual(draft.seo, []);
});

test('WriterService corrige substância antes de forma, com as tools liberadas', async () => {
  // Rascunho curto: reprova em content-short (substância) e em flesch (forma).
  const short = seoReadyEnvelope(undefined, { sentences: 40 });
  const { client, calls } = conversation([
    READS_SOURCES,
    short,
    seoReadyEnvelope(undefined, { sentences: 200 }),
  ]);

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  await new WriterService(client, [{ type: 'function' }], dispatcher()).write({ theme: 'ESP32-C6' });

  const request = calls[2].last.content;
  assert.match(request, /O texto tem \d+ palavras/);
  // A rodada de substância não pode pedir ajuste de forma junto.
  assert.doesNotMatch(request, /legibilidade Flesch está em/);
  assert.match(request, /não mexa em legibilidade/i);
  // E vai com as ferramentas liberadas, porque ampliar exige fonte nova.
  assert.notEqual(calls[2].options.toolChoice, 'none');
});

test('parseTopics extrai os blocos de temas corretamente', () => {
  const topicsRaw = `===TEMA===
===TITULO===
ESP32-P4 e RISC-V industrial
===CATEGORIAS===
iot, sistemas-embarcados, invalid_category
===TENDENCIA===
Crescimento da arquitetura RISC-V na indústria.
===ENFOQUE===
Análise prática do processador duplo núcleo.

===TEMA===
===TITULO===
Matter 1.3: novidades para energia
===CATEGORIAS===
comunicacao, automacao
===TENDENCIA===
Lançamento da especificação com suporte a gestão de energia.
===ENFOQUE===
Como implementar relatórios de consumo.`;

  const topics = parseTopics(topicsRaw);

  assert.equal(topics.length, 2);
  assert.equal(topics[0].title, 'ESP32-P4 e RISC-V industrial');
  assert.deepEqual(topics[0].categories, ['iot', 'sistemas-embarcados']);
  assert.equal(topics[0].trend, 'Crescimento da arquitetura RISC-V na indústria.');
  assert.equal(topics[0].angle, 'Análise prática do processador duplo núcleo.');

  assert.equal(topics[1].title, 'Matter 1.3: novidades para energia');
  assert.deepEqual(topics[1].categories, ['comunicacao', 'automacao']);
});

test('parseTopics trata fallback para texto sem marcadores', () => {
  const raw = 'Sugestões livres de temas sobre segurança em IoT.';
  const topics = parseTopics(raw);

  assert.equal(topics.length, 1);
  assert.equal(topics[0].title, 'Sugestões de temas');
  assert.equal(topics[0].angle, raw);
});

test('WriterService.suggestTopics executa pesquisa e devolve os temas', async () => {
  const topicsResponse = `===TEMA===
===TITULO===
Cibersegurança em firmware ESP32
===CATEGORIAS===
seguranca, iot
===TENDENCIA===
Aumento de ataques direcionados a dispositivos de borda.
===ENFOQUE===
Práticas de Secure Boot e Flash Encryption.`;

  const { client, calls } = conversation([
    { role: 'assistant', tool_calls: [{ id: '1', function: { name: 'web_search', arguments: '{"query":"iot trends"}' } }] },
    topicsResponse,
  ]);

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const service = new WriterService(client, [{ type: 'function' }], dispatcher());

  const topics = await service.suggestTopics('seguranca');

  assert.equal(calls.length, 2);
  assert.equal(topics.length, 1);
  assert.equal(topics[0].title, 'Cibersegurança em firmware ESP32');
  assert.deepEqual(topics[0].categories, ['seguranca', 'iot']);
});
