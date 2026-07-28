import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  auditDraft,
  buildSeoRevisionRequest,
  nextRevisionBatch,
  fleschReadingEase,
  findConsecutiveSameStart,
  hasTransitionWord,
  splitSentences,
  stripBlocks,
} from '../../src/modules/writer/writer.seo.js';
import { cleanDraft, cleanContent } from './draft.fixture.js';
import { SourceRegistry } from '../../src/modules/research/source.registry.js';

/** Rascunho que passa em todos os critérios; cada teste estraga um de cada vez. */
const CLEAN = cleanDraft();

/**
 * @param {Object} overrides
 * @returns {string[]}
 */
function codes(overrides = {}) {
  return auditDraft({ ...CLEAN, ...overrides }).map((issue) => issue.code);
}

test('auditDraft aprova um rascunho dentro dos limites', () => {
  assert.deepEqual(codes(), []);
});

test('auditDraft reprova título acima de 60 caracteres', () => {
  const title = 'ESP32-C6 e o protocolo Matter: tudo o que muda no projeto de nós de rede';
  assert.ok(title.length > 60);
  assert.ok(codes({ title }).includes('title-length'));
});

test('auditDraft reprova resumo acima de 160 caracteres', () => {
  const excerpt = 'a'.repeat(161);
  assert.ok(codes({ excerpt }).includes('excerpt-length'));
});

test('auditDraft reprova resumo curto demais para a meta description', () => {
  assert.ok(codes({ excerpt: 'Chip novo da Espressif.' }).includes('excerpt-short'));
});

test('auditDraft reprova 3 frases seguidas com a mesma palavra inicial', () => {
  const content = `${CLEAN.content}\n<!-- wp:paragraph -->\n<p>Ele traz Wi-Fi 6. Ele traz Thread. Ele traz Zigbee.</p>\n<!-- /wp:paragraph -->`;
  assert.ok(codes({ content }).includes('consecutive-sentences'));
});

test('auditDraft reprova texto sem palavras de transição suficientes', () => {
  // Remove o conectivo que abre cada frase da fixture, mantendo o resto igual.
  const content = CLEAN.content.replace(
    /(Além disso|No entanto|Por isso|Em resumo|Na prática|Por outro lado), /g,
    ''
  );

  assert.ok(codes({ content }).includes('transition-words'));
});

test('auditDraft reprova conteúdo sem bloco de imagem', () => {
  const content = CLEAN.content.replace(/<!-- wp:image[\s\S]*?<!-- \/wp:image -->/, '');
  assert.ok(codes({ content }).includes('images'));
});

test('auditDraft avisa sobre falta de link interno sem travar a entrega', () => {
  const content = CLEAN.content.replace('https://cienciaembarcada.com.br/lorawan', 'https://outro.com/x');
  const issue = auditDraft({ ...CLEAN, content }).find((i) => i.code === 'internal-links');

  assert.ok(issue);
  assert.equal(issue.blocking, false);
});

test('auditDraft usa o host configurado do blog para classificar o link', () => {
  const content = CLEAN.content.replace('https://cienciaembarcada.com.br/lorawan', 'https://blog.local/lorawan');
  const found = auditDraft({ ...CLEAN, content }, { blogBaseUrl: 'https://blog.local' }).map((i) => i.code);

  assert.ok(!found.includes('internal-links'));
});

test('auditDraft reprova parágrafo longo demais', () => {
  const long = `<!-- wp:paragraph -->\n<p>${'palavra '.repeat(200)}</p>\n<!-- /wp:paragraph -->`;
  assert.ok(codes({ content: CLEAN.content + long }).includes('paragraph-length'));
});

test('auditDraft reprova trecho longo sem subtítulo', () => {
  const content = CLEAN.content.replace(/<h3[^>]*>[^<]*<\/h3>/g, '');
  assert.ok(codes({ content }).includes('subheading-distribution'));
});

test('fleschReadingEase pontua frase curta acima de frase longa e difícil', () => {
  const easy = fleschReadingEase('O chip é novo. Ele usa Wi-Fi. O custo é baixo.');
  const hard = fleschReadingEase(
    'A implementação da infraestrutura de comunicação sem fio possibilita a interoperabilidade dos dispositivos heterogêneos utilizados na automação predial contemporânea.'
  );

  assert.ok(easy > hard);
  assert.ok(easy > 60);
  assert.ok(hard < 60);
});

test('fleschReadingEase devolve null sem texto medível', () => {
  assert.equal(fleschReadingEase('   '), null);
});

test('hasTransitionWord reconhece locução composta e ignora prefixo casual', () => {
  assert.ok(hasTransitionWord('No entanto, o custo sobe.'));
  assert.ok(hasTransitionWord('O custo, por outro lado, sobe.'));
  assert.ok(!hasTransitionWord('O custo do chip sobe.'));
});

test('findConsecutiveSameStart só acusa a partir de três frases', () => {
  assert.deepEqual(findConsecutiveSameStart(['Ele faz isso', 'Ele faz aquilo']), []);
  assert.deepEqual(findConsecutiveSameStart(['Ele faz isso', 'Ele faz aquilo', 'Ele faz mais']), ['ele']);
});

test('splitSentences descarta fragmento curto e separa por pontuação', () => {
  assert.deepEqual(splitSentences('O chip é novo. Ele usa Wi-Fi. Sim.'), [
    'O chip é novo.',
    'Ele usa Wi-Fi.',
  ]);
});

test('stripBlocks remove comentários do Gutenberg, tags e código', () => {
  const text = stripBlocks('<!-- wp:code --><pre><code>x=1;</code></pre><!-- /wp:code --><p>Texto real</p>');

  assert.ok(text.includes('Texto real'));
  assert.ok(!text.includes('wp:code'));
  assert.ok(!text.includes('x=1'));
});

test('buildSeoRevisionRequest lista os problemas e proíbe encurtar o texto', () => {
  const request = buildSeoRevisionRequest(
    [{ message: 'O título tem 72 caracteres.', fix: 'Reescreva com até 60.' }],
    CLEAN
  );

  assert.ok(request.includes('O título tem 72 caracteres.'));
  assert.ok(request.includes('Reescreva com até 60.'));
  assert.match(request, /o mesmo número de palavras ou mais/i);
});

test('a rodada de substância proíbe mexer na forma', () => {
  const request = buildSeoRevisionRequest(
    [{ message: 'O texto tem 600 palavras.', fix: 'Amplie.' }],
    CLEAN,
    'substance'
  );

  assert.match(request, /não mexa em legibilidade/i);
  assert.match(request, /acrescente por cima/i);
});

test('nextRevisionBatch trata substância antes de forma', () => {
  const short = { code: 'content-short', blocking: true };
  const flesch = { code: 'flesch', blocking: true };
  const internal = { code: 'internal-links', blocking: false };

  const first = nextRevisionBatch([short, flesch, internal]);
  assert.equal(first.stage, 'substance');
  // Forma fica de fora, e o aviso de link interno pega carona.
  assert.deepEqual(first.issues.map((i) => i.code), ['content-short', 'internal-links']);

  const second = nextRevisionBatch([flesch, internal]);
  assert.equal(second.stage, 'form');
  assert.deepEqual(second.issues.map((i) => i.code), ['flesch']);
});

test('nextRevisionBatch não abre rodada de substância só por um aviso', () => {
  // internal-links não é bloqueante: sozinho, não segura o ciclo na substância.
  const batch = nextRevisionBatch([{ code: 'internal-links', blocking: false }, { code: 'flesch', blocking: true }]);

  assert.equal(batch.stage, 'form');
});

test('auditDraft reprova texto abaixo do piso de 800 palavras', () => {
  const issue = auditDraft(cleanDraft({ sentences: 30 })).find((i) => i.code === 'content-short');

  assert.ok(issue);
  assert.equal(issue.blocking, true);
  assert.match(issue.fix, /Amplie/);
});

test('auditDraft aprova o tamanho quando o texto passa de 800 palavras', () => {
  assert.ok(!auditDraft(cleanDraft()).some((i) => i.code === 'content-short'));
});

test('auditDraft exige 3 fontes externas distintas', () => {
  const content = CLEAN.content
    .replace(/<a href="https:\/\/www\.rfc-editor\.org[^<]*<\/a>/, 'o texto do CoAP')
    .replace(/<a href="https:\/\/csa-iot\.org[^<]*<\/a>/, 'o guia do Matter');
  const issue = auditDraft({ ...CLEAN, content }).find((i) => i.code === 'external-links');

  assert.ok(issue);
  assert.equal(issue.blocking, true);
  assert.match(issue.message, /1 fonte/);
});

test('auditDraft conta fontes por domínio, não por link', () => {
  // Três links, todos do mesmo host: uma referência só.
  const content = CLEAN.content
    .replace(/<a href="https:\/\/www\.rfc-editor\.org[^"]*"/, '<a href="https://docs.espressif.com/outro"')
    .replace(/<a href="https:\/\/csa-iot\.org[^"]*"/, '<a href="https://docs.espressif.com/mais"');
  const issue = auditDraft({ ...CLEAN, content }).find((i) => i.code === 'external-links');

  assert.match(issue.message, /1 fonte/);
});

test('auditDraft reprova link para página que não foi lida', () => {
  const sources = new SourceRegistry();
  sources.addRead('https://docs.espressif.com/ds');

  const issue = auditDraft(CLEAN, { sources }).find((i) => i.code === 'unverified-links');

  assert.ok(issue);
  assert.equal(issue.blocking, true);
  // O rfc-editor e o csa-iot da fixture não foram lidos.
  assert.match(issue.message, /rfc-editor/);
  // E a correção mostra ao modelo o que ele de fato leu.
  assert.match(issue.fix, /docs\.espressif\.com\/ds/);
});

test('auditDraft aceita link cujo endereço difere só em www e barra final', () => {
  const sources = new SourceRegistry();
  for (const url of ['https://www.docs.espressif.com/ds/', 'https://www.rfc-editor.org/rfc/rfc7252', 'https://csa-iot.org/matter']) {
    sources.addRead(url);
  }

  assert.ok(!auditDraft(CLEAN, { sources }).some((i) => i.code === 'unverified-links'));
});

test('auditDraft não conta como fonte a página que não foi lida', () => {
  const sources = new SourceRegistry();
  sources.addRead('https://docs.espressif.com/ds');

  const issue = auditDraft(CLEAN, { sources }).find((i) => i.code === 'external-links');

  assert.ok(issue, 'as três fontes da fixture deveriam cair para uma verificada');
  assert.match(issue.message, /1 fonte/);
});

test('sem registro de fontes a auditoria não cobra verificação', () => {
  assert.ok(!auditDraft(CLEAN).some((i) => i.code === 'unverified-links'));
});
