/**
 * Rascunho de referência dos testes do Writer: aprovado em TODOS os critérios
 * da auditoria — tamanho, título, resumo, transições, frases curtas, Flesch,
 * parágrafos, subtítulos, imagem, link interno e três fontes externas.
 *
 * Ele é gerado em vez de escrito à mão porque o piso de 800 palavras tornaria
 * a fixture literal ingovernável. Cada teste parte daqui e estraga um critério
 * por vez, que é o que torna a asserção específica.
 */

/** Aberturas de frase, todas palavras de transição e todas diferentes entre si. */
const OPENERS = ['Além disso', 'No entanto', 'Por isso', 'Em resumo', 'Na prática', 'Por outro lado'];

/** Complementos curtos, de palavras curtas: mantêm o Flesch bem acima do piso. */
const CLAUSES = [
  'o chip usa rádio de baixo custo',
  'a placa liga em poucos segundos',
  'o consumo cai no modo de sono',
  'a rede aceita mais de um nó',
  'o teste roda numa bancada simples',
  'o firmware cabe na memória do chip',
];

/**
 * @param {number} index
 * @returns {string}
 */
function sentence(index) {
  return `${OPENERS[index % OPENERS.length]}, ${CLAUSES[index % CLAUSES.length]}.`;
}

/**
 * Corpo em blocos Gutenberg com o número de frases pedido, subtítulo a cada
 * quatro parágrafos e a seção de referências no fim.
 * @param {{ sentences?: number }} [options]
 * @returns {string}
 */
export function cleanContent({ sentences: total = 120 } = {}) {
  const blocks = [
    '<!-- wp:image -->',
    '<figure class="wp-block-image"><img src="" alt="Placa ESP32-C6 sobre bancada"/></figure>',
    '<!-- /wp:image -->',
    '',
  ];

  const perParagraph = 6;
  const paragraphs = Math.ceil(total / perParagraph);

  for (let p = 0; p < paragraphs; p++) {
    if (p % 4 === 0) {
      blocks.push(
        '<!-- wp:heading {"level":3} -->',
        `<h3 class="wp-block-heading">Seção ${p / 4 + 1}</h3>`,
        '<!-- /wp:heading -->',
        ''
      );
    }

    const text = Array.from({ length: perParagraph }, (_, s) => sentence(p * perParagraph + s)).join(' ');
    blocks.push('<!-- wp:paragraph -->', `<p>${text}</p>`, '<!-- /wp:paragraph -->', '');
  }

  blocks.push(
    '<!-- wp:heading {"level":3} -->',
    '<h3 class="wp-block-heading">Referências</h3>',
    '<!-- /wp:heading -->',
    '',
    '<!-- wp:paragraph -->',
    '<p>Por fim, veja a <a href="https://cienciaembarcada.com.br/lorawan">nota sobre LoRaWAN</a>, ' +
      'o <a href="https://docs.espressif.com/ds">datasheet da Espressif</a>, ' +
      'o <a href="https://www.rfc-editor.org/rfc/rfc7252">texto do CoAP</a> ' +
      'e o <a href="https://csa-iot.org/matter">guia do Matter</a>.</p>',
    '<!-- /wp:paragraph -->'
  );

  return blocks.join('\n');
}

/** Título de 26 caracteres, dentro do limite de 60. */
export const CLEAN_TITLE = 'ESP32-C6: o chip do Matter';

/** Resumo de 93 caracteres, dentro da faixa de 70 a 160 da meta description. */
export const CLEAN_EXCERPT =
  'O ESP32-C6 traz Wi-Fi 6 e Thread no mesmo chip, e por isso muda o projeto de nós Matter.';

/**
 * @param {{ sentences?: number }} [options]
 * @returns {{ title: string, excerpt: string, content: string }}
 */
export function cleanDraft(options) {
  return { title: CLEAN_TITLE, excerpt: CLEAN_EXCERPT, content: cleanContent(options) };
}

/**
 * O mesmo rascunho no envelope de marcadores, como o modelo devolveria.
 * @param {string} [title]
 * @param {{ sentences?: number }} [options]
 * @returns {string}
 */
export function seoReadyEnvelope(title = CLEAN_TITLE, options) {
  return [
    '===TITULO===',
    title,
    '',
    '===RESUMO===',
    CLEAN_EXCERPT,
    '',
    '===CATEGORIAS===',
    'iot, sistemas-embarcados',
    '',
    '===CONTEUDO===',
    cleanContent(options),
  ].join('\n');
}
