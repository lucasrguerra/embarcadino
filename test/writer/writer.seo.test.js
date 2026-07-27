import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  auditDraft,
  buildSeoRevisionRequest,
  fleschReadingEase,
  findConsecutiveSameStart,
  hasTransitionWord,
  splitSentences,
  stripBlocks,
} from '../../src/modules/writer/writer.seo.js';

/** Rascunho que passa em tudo, usado como base para variar um problema por vez. */
const CLEAN = {
  title: 'ESP32-C6: o chip do Matter',
  excerpt: 'O ESP32-C6 traz Wi-Fi 6 e Thread no mesmo chip, e por isso muda o projeto de nós Matter.',
  content: `<!-- wp:image -->
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
<!-- /wp:paragraph -->`,
};

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
  const content = CLEAN.content.replace(
    '<p>O ESP32-C6 traz Wi-Fi 6 e Thread. Por isso o projeto muda. Além disso, o rádio é único.</p>',
    '<p>Ele traz Wi-Fi 6. Ele traz Thread. Ele traz Zigbee.</p>'
  );
  assert.ok(codes({ content }).includes('consecutive-sentences'));
});

test('auditDraft reprova texto sem palavras de transição suficientes', () => {
  const content = CLEAN.content
    .replace('Por isso o projeto muda.', 'O projeto muda.')
    .replace('Além disso, o rádio é único.', 'O rádio é único.')
    .replace('No entanto, o custo sobe.', 'O custo sobe.')
    .replace('Em resumo, vale a pena.', 'Vale a pena.');

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
  const content = `<!-- wp:image --><figure><img src="" alt="x"/></figure><!-- /wp:image -->
<p>${'assim uma frase curta e clara. '.repeat(120)}</p>`;
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
  assert.match(request, /não reduza o número de palavras/i);
});
