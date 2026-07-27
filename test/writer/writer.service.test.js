import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDraft, parseCategories, countWords } from '../../src/modules/writer/writer.service.js';
import { parseBriefing } from '../../src/modules/writer/handlers/index.js';

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
  // nunca satisfaz (sem imagem, sem link, resumo curto).
  assert.ok(calls.length >= 2);
  // No primeiro call, toolChoice não foi 'none'
  assert.equal(calls[0].options.toolChoice, undefined);
  // No segundo call (retry), toolChoice foi 'none' para impedir novas chamadas a ferramentas
  assert.equal(calls[1].options.toolChoice, 'none');
  // Ambas as chamadas passaram o array de tools para manter validade de esquema da API
  assert.equal(calls[0].options.tools.length, 1);
  assert.equal(calls[1].options.tools.length, 1);
});

/**
 * Envelope aprovado na auditoria: título curto, resumo na faixa da meta
 * description, imagem, subtítulo, link interno, link externo e transições.
 * @param {string} title
 * @returns {string}
 */
function seoReadyEnvelope(title = 'ESP32-C6: o chip do Matter') {
  return `===TITULO===
${title}

===RESUMO===
O ESP32-C6 traz Wi-Fi 6 e Thread no mesmo chip, e por isso muda o projeto de nós Matter em rede.

===CATEGORIAS===
iot, sistemas-embarcados

===CONTEUDO===
<!-- wp:image -->
<figure class="wp-block-image"><img src="" alt="Placa ESP32-C6"/></figure>
<!-- /wp:image -->

<!-- wp:paragraph -->
<p>O ESP32-C6 traz Wi-Fi 6 e Thread. Por isso o projeto muda. Além disso, o rádio é único.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":3} -->
<h3>O rádio</h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>No entanto, o custo sobe. Em resumo, vale a pena. Veja a <a href="https://cienciaembarcada.com.br/lorawan">nota sobre LoRaWAN</a> e o <a href="https://espressif.com/ds">datasheet</a>.</p>
<!-- /wp:paragraph -->`;
}

test('WriterService devolve o rascunho ao modelo quando a auditoria de SEO reprova', async () => {
  const longTitle = 'ESP32-C6 e o protocolo Matter: tudo o que muda no projeto de nós de rede';
  const responses = [seoReadyEnvelope(longTitle), seoReadyEnvelope()];
  const calls = [];

  const mockClient = {
    async chat(messages, options) {
      calls.push({ last: messages[messages.length - 1], options });
      return { message: { role: 'assistant', content: responses[calls.length - 1] } };
    },
  };

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const service = new WriterService(mockClient, [{ type: 'function' }], {});
  const draft = await service.write({ theme: 'ESP32-C6' });

  assert.equal(calls.length, 2);
  assert.match(calls[1].last.content, /O título tem 72 caracteres/);
  assert.equal(calls[1].options.toolChoice, 'none');
  assert.equal(draft.title, 'ESP32-C6: o chip do Matter');
  assert.deepEqual(draft.seo, []);
});

test('WriterService não pede revisão quando o rascunho já passa na auditoria', async () => {
  let calls = 0;
  const mockClient = {
    async chat() {
      calls++;
      return { message: { role: 'assistant', content: seoReadyEnvelope() } };
    },
  };

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const service = new WriterService(mockClient, [], {});
  const draft = await service.write({ theme: 'ESP32-C6' });

  assert.equal(calls, 1);
  assert.deepEqual(draft.seo, []);
});

test('WriterService mantém o rascunho anterior quando a revisão corta o texto', async () => {
  const longTitle = 'ESP32-C6 e o protocolo Matter: tudo o que muda no projeto de nós de rede';
  const mutilated = `===TITULO===
Curto

===CONTEUDO===
<!-- wp:paragraph --><p>Nada.</p><!-- /wp:paragraph -->`;
  const responses = [seoReadyEnvelope(longTitle), mutilated];
  let calls = 0;

  const mockClient = {
    async chat() {
      return { message: { role: 'assistant', content: responses[calls++] } };
    },
  };

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const service = new WriterService(mockClient, [], {});
  const draft = await service.write({ theme: 'ESP32-C6' });

  assert.equal(draft.title, longTitle);
  assert.ok(draft.seo.some((issue) => issue.code === 'title-length'));
});

test('WriterService entrega o rascunho mesmo se a chamada de revisão falhar', async () => {
  const longTitle = 'ESP32-C6 e o protocolo Matter: tudo o que muda no projeto de nós de rede';
  let calls = 0;

  const mockClient = {
    async chat() {
      if (calls++ > 0) throw new Error('502 upstream');
      return { message: { role: 'assistant', content: seoReadyEnvelope(longTitle) } };
    },
  };

  const { WriterService } = await import('../../src/modules/writer/writer.service.js');
  const service = new WriterService(mockClient, [], {});
  const draft = await service.write({ theme: 'ESP32-C6' });

  assert.equal(draft.title, longTitle);
  assert.ok(draft.words > 0);
});
