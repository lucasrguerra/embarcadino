/**
 * Módulo Writer — Auditoria de SEO e legibilidade (Camada de Aplicação).
 *
 * Responsabilidade única: medir o rascunho contra os mesmos critérios que o
 * plugin de SEO do WordPress aplica na hora da revisão, e descrever o que
 * precisa mudar numa linguagem que o modelo consiga executar.
 *
 * Por que medir em código em vez de só pedir no prompt: "título com até 60
 * caracteres" e "30% das frases com palavra de transição" são contas, e modelo
 * não conta. O prompt orienta; esta auditoria verifica e devolve o número real,
 * que é o que faz a revisão convergir.
 *
 * Os limiares vêm do analisador do Yoast (configuração pt-BR), que é o que
 * pontua os posts do blog:
 * - título até 60 caracteres, meta description até 160;
 * - pelo menos 30% das frases com palavra de transição;
 * - no máximo 25% das frases acima de 20 palavras;
 * - nunca 3 frases seguidas começando com a mesma palavra;
 * - Flesch (fórmula adaptada ao português) de no mínimo 60 — "razoavelmente
 *   fácil"; abaixo de 50 o plugin acusa "difícil de ler".
 */

const LIMITS = {
  /**
   * Piso de palavras do corpo. Não é critério do plugin de SEO — é a régua do
   * blog, que a seção "Tamanho" do prompt já definia e nada verificava. Sem
   * medir, o modelo entrega 600 palavras e o post fica raso.
   */
  minWords: 800,
  /**
   * Fontes externas citadas. Um post técnico com uma referência só é um post
   * que não foi pesquisado — e foi exatamente o sintoma que apareceu quando o
   * modelo pulou o read_page.
   */
  minExternalLinks: 3,
  titleChars: 60,
  excerptChars: 160,
  /** Abaixo disso o resumo desperdiça espaço da SERP; o plugin também reclama. */
  excerptMinChars: 70,
  transitionRatio: 0.3,
  /** Fração máxima de frases com mais de LONG_SENTENCE_WORDS palavras. */
  longSentenceRatio: 0.25,
  longSentenceWords: 20,
  consecutiveSameStart: 3,
  fleschScore: 60,
  paragraphWords: 150,
  /** Palavras máximas entre dois subtítulos. */
  subheadingGapWords: 300,
};

/**
 * Palavras e locuções de transição em português. Lista derivada da configuração
 * pt-BR do Yoast — é ela que o plugin usa pra calcular a porcentagem, então
 * usar outra lista faria a auditoria discordar do painel na hora da revisão.
 */
const TRANSITION_WORDS = [
  'acima de tudo', 'afinal', 'agora', 'aliás', 'além disso', 'ainda assim', 'ainda que',
  'ao contrário', 'ao mesmo tempo', 'ao passo que', 'apesar de', 'apesar disso', 'assim',
  'assim como', 'assim que', 'até porque', 'basicamente', 'bem como', 'certamente',
  'com efeito', 'com isso', 'como resultado', 'conforme', 'consequentemente', 'contudo',
  'de acordo com', 'de fato', 'de forma que', 'de imediato', 'de maneira geral',
  'de modo que', 'de novo', 'demais', 'dessa forma', 'desse modo', 'desta vez',
  'diante disso', 'do mesmo modo', 'em conclusão', 'em contrapartida', 'em geral',
  'em outras palavras', 'em primeiro lugar', 'em resumo', 'em seguida', 'em síntese',
  'em suma', 'em todo caso', 'enfim', 'enquanto', 'entretanto', 'então', 'especialmente',
  'evidentemente', 'finalmente', 'inclusive', 'igualmente', 'isto é', 'já que',
  'logo', 'mas', 'mesmo assim', 'na prática', 'na verdade', 'não obstante', 'nesse caso',
  'nesse sentido', 'no entanto', 'no fim das contas', 'ou seja', 'para que', 'pelo contrário',
  'per si', 'por causa de', 'por conseguinte', 'por enquanto', 'por exemplo', 'por fim',
  'por isso', 'por outro lado', 'por sua vez', 'porque', 'portanto', 'posteriormente',
  'primeiramente', 'principalmente', 'provavelmente', 'quando', 'que nem', 'sem dúvida',
  'similarmente', 'sobretudo', 'somado a isso', 'tal como', 'também', 'tanto que',
  'todavia', 'uma vez que', 'visto que',
];

/** Ordena por tamanho pra casar "no entanto" antes de "no". */
const TRANSITION_PATTERNS = [...TRANSITION_WORDS]
  .sort((a, b) => b.length - a.length)
  .map((word) => new RegExp(`(?:^|[^\\p{L}])${escapeRegExp(word)}(?:$|[^\\p{L}])`, 'iu'));

/**
 * Audita o rascunho e devolve os problemas encontrados, do mais grave ao menos.
 * Lista vazia significa rascunho aprovado.
 * @param {{ title: string, excerpt: string, content: string }} draft
 * @param {{ blogBaseUrl?: string, sources?: import('../research/source.registry.js').SourceRegistry }} [options]
 * @returns {Array<{ code: string, blocking: boolean, message: string, fix: string }>}
 */
export function auditDraft({ title, excerpt, content }, { blogBaseUrl, sources } = {}) {
  const issues = [];
  const text = stripBlocks(content);
  const sentences = splitSentences(text);
  const words = countWordsIn(text);

  // Tamanho vem primeiro na lista porque é o problema mais caro de corrigir e o
  // que mais muda o rascunho: o modelo precisa vê-lo antes dos ajustes de forma.
  if (words < LIMITS.minWords) {
    issues.push({
      code: 'content-short',
      blocking: true,
      message: `O texto tem ${words} palavras (mínimo: ${LIMITS.minWords}).`,
      fix:
        `Amplie o post para pelo menos ${LIMITS.minWords} palavras — faltam cerca de ${LIMITS.minWords - words}. ` +
        'Aprofunde cada seção existente: explique o mecanismo por trás do problema, dê o número concreto da ' +
        'especificação (tensão, tempo, tamanho de memória), mostre como identificar o sintoma no console e ' +
        'inclua o trecho de código ou o comando envolvido. Não adicione seções vazias nem repita o que já foi dito.',
    });
  }

  const titleLength = String(title ?? '').trim().length;
  if (titleLength > LIMITS.titleChars) {
    issues.push({
      code: 'title-length',
      blocking: true,
      message: `O título tem ${titleLength} caracteres (limite: ${LIMITS.titleChars}).`,
      fix: `Reescreva o título com no máximo ${LIMITS.titleChars} caracteres, mantendo o termo principal no começo.`,
    });
  }

  const excerptLength = String(excerpt ?? '').trim().length;
  if (excerptLength > LIMITS.excerptChars) {
    issues.push({
      code: 'excerpt-length',
      blocking: true,
      message: `O resumo tem ${excerptLength} caracteres (limite: ${LIMITS.excerptChars}).`,
      fix: `Reescreva o resumo com no máximo ${LIMITS.excerptChars} caracteres — uma frase só, com o termo principal. Ajuste também o primeiro parágrafo do conteúdo, que repete o resumo.`,
    });
  } else if (excerptLength > 0 && excerptLength < LIMITS.excerptMinChars) {
    issues.push({
      code: 'excerpt-short',
      blocking: true,
      message: `O resumo tem só ${excerptLength} caracteres (mínimo confortável: ${LIMITS.excerptMinChars}).`,
      fix: `Amplie o resumo para algo entre ${LIMITS.excerptMinChars} e ${LIMITS.excerptChars} caracteres.`,
    });
  }

  if (sentences.length > 0) {
    const withTransition = sentences.filter(hasTransitionWord).length;
    const ratio = withTransition / sentences.length;
    if (ratio < LIMITS.transitionRatio) {
      issues.push({
        code: 'transition-words',
        blocking: true,
        message: `Só ${percent(ratio)} das frases têm palavra de transição (mínimo: ${percent(LIMITS.transitionRatio)}).`,
        fix: `Abra pelo menos ${Math.ceil(sentences.length * LIMITS.transitionRatio) - withTransition} frases a mais com conectivos ("no entanto", "por isso", "além disso", "em resumo", "por outro lado", "na prática"), sem empilhar o mesmo conectivo.`,
      });
    }

    const long = sentences.filter((sentence) => countWordsIn(sentence) > LIMITS.longSentenceWords).length;
    const longRatio = long / sentences.length;
    if (longRatio > LIMITS.longSentenceRatio) {
      issues.push({
        code: 'sentence-length',
        blocking: true,
        message: `${percent(longRatio)} das frases passam de ${LIMITS.longSentenceWords} palavras (limite: ${percent(LIMITS.longSentenceRatio)}).`,
        fix: 'Quebre as frases longas em duas. Uma ideia por frase.',
      });
    }
  }

  const repeated = findConsecutiveSameStart(sentences);
  if (repeated.length > 0) {
    issues.push({
      code: 'consecutive-sentences',
      blocking: true,
      message: `Há ${LIMITS.consecutiveSameStart} ou mais frases seguidas começando com a mesma palavra: ${repeated.map((word) => `"${word}"`).join(', ')}.`,
      fix: `Varie o início dessas frases — troque a ordem dos termos ou comece por um conectivo diferente. Nunca ${LIMITS.consecutiveSameStart} frases seguidas com a mesma palavra inicial.`,
    });
  }

  const flesch = fleschReadingEase(text);
  if (flesch !== null && flesch < LIMITS.fleschScore) {
    issues.push({
      code: 'flesch',
      blocking: true,
      message: `A legibilidade Flesch está em ${flesch.toFixed(1)} (mínimo: ${LIMITS.fleschScore}).`,
      fix: 'Encurte as frases e troque palavras longas por equivalentes curtos ("utilizar" → "usar", "possibilita" → "permite"). Termo técnico pode ficar, desde que explicado em frase curta.',
    });
  }

  const longParagraph = paragraphs(content).find((p) => countWordsIn(p) > LIMITS.paragraphWords);
  if (longParagraph) {
    issues.push({
      code: 'paragraph-length',
      blocking: true,
      message: `Há parágrafo com mais de ${LIMITS.paragraphWords} palavras.`,
      fix: `Divida todo parágrafo acima de ${LIMITS.paragraphWords} palavras em dois blocos de parágrafo.`,
    });
  }

  const gap = largestSubheadingGap(content);
  if (gap > LIMITS.subheadingGapWords) {
    issues.push({
      code: 'subheading-distribution',
      blocking: true,
      message: `Há ${gap} palavras seguidas sem subtítulo (limite: ${LIMITS.subheadingGapWords}).`,
      fix: `Insira um subtítulo <h3> a cada ${LIMITS.subheadingGapWords} palavras, no máximo.`,
    });
  }

  const links = extractLinks(content);
  const internal = links.filter((href) => isInternal(href, blogBaseUrl));
  const external = links.filter((href) => !isInternal(href, blogBaseUrl));

  // Link interno depende de o blog_search ter encontrado post relacionado —
  // pode não haver o que linkar, então isso é aviso, não bloqueio.
  if (internal.length === 0) {
    issues.push({
      code: 'internal-links',
      blocking: false,
      message: 'O texto não tem link interno para outra publicação do blog.',
      fix: 'Use blog_search e linke pelo menos uma publicação relacionada do Ciência Embarcada, com a URL real retornada pela ferramenta.',
    });
  }

  // Referência que o modelo não abriu é o defeito mais grave que este módulo
  // detecta: o leitor clica e cai num 404, e o post perde a credibilidade
  // técnica inteira. Só entra na contagem de fontes o que passou pelo read_page.
  const verified = sources ? external.filter((href) => sources.wasRead(href)) : external;

  if (sources) {
    const unverified = external.filter((href) => !sources.wasRead(href));
    if (unverified.length > 0) {
      const readList = sources.readUrls();

      issues.push({
        code: 'unverified-links',
        blocking: true,
        message: `${unverified.length} link(s) apontam para páginas que você não leu: ${unverified
          .slice(0, 5)
          .join(', ')}.`,
        fix:
          'Remova esses links. Referência é só página aberta com read_page nesta redação' +
          (readList.length > 0
            ? `; as que você leu foram:\n${readList.map((url) => `   - ${url}`).join('\n')}`
            : ', e você não leu nenhuma — pesquise com web_search e leia as fontes antes de citar') +
          '. Se precisar de mais fontes, busque e leia agora; nunca escreva uma URL de memória.',
      });
    }
  }

  const uniqueExternal = new Set(verified.map(hostOf)).size;
  if (uniqueExternal < LIMITS.minExternalLinks) {
    issues.push({
      code: 'external-links',
      blocking: true,
      message: `O texto cita ${uniqueExternal} fonte(s) externa(s) distinta(s) e verificada(s) (mínimo: ${LIMITS.minExternalLinks}).`,
      fix:
        `Pesquise com web_search, abra as páginas com read_page e cite pelo menos ${LIMITS.minExternalLinks} ` +
        'referências externas de domínios diferentes na seção Referências — documentação oficial, datasheet do ' +
        'fabricante, aviso de segurança ou veículo técnico. Só conta o que você abriu de fato nesta redação.',
    });
  }

  if (!/<!--\s*wp:image/.test(String(content ?? ''))) {
    issues.push({
      code: 'images',
      blocking: true,
      message: 'O conteúdo não tem bloco de imagem.',
      fix: 'Comece o conteúdo com o bloco wp:image, com o alt descrevendo a ilustração em português.',
    });
  }

  return issues;
}

/**
 * Problemas de substância: o texto está curto ou as fontes não se sustentam.
 * Corrigi-los significa ACRESCENTAR — pesquisar, aprofundar, citar.
 */
const SUBSTANCE_CODES = new Set(['content-short', 'external-links', 'unverified-links', 'internal-links']);

/**
 * Escolhe o que cobrar do modelo nesta rodada.
 *
 * Pedir tudo de uma vez não funciona, e o motivo é simples: "amplie para 800
 * palavras" e "encurte as frases, suba o Flesch" na mesma mensagem são ordens
 * contraditórias. Na prática o modelo obedecia à segunda, o texto encolhia, a
 * revisão era descartada por cortar conteúdo e o ciclo terminava sem corrigir
 * nada. Substância primeiro, forma depois — nessa ordem os dois convergem.
 *
 * @param {Array<{ code: string, blocking: boolean }>} issues
 * @returns {{ stage: 'substance' | 'form', issues: Array<Object> }}
 */
export function nextRevisionBatch(issues) {
  const substance = issues.filter((issue) => SUBSTANCE_CODES.has(issue.code));
  const blockingSubstance = substance.filter((issue) => issue.blocking);

  // Os avisos de substância (link interno, por exemplo) pegam carona na rodada
  // de conteúdo, mas nunca provocam uma rodada sozinhos.
  if (blockingSubstance.length > 0) return { stage: 'substance', issues: substance };

  return { stage: 'form', issues: issues.filter((issue) => !SUBSTANCE_CODES.has(issue.code)) };
}

/**
 * Monta o pedido de revisão enviado ao modelo com os problemas encontrados.
 * @param {Array<{ message: string, fix: string }>} issues
 * @param {{ title: string, excerpt: string }} draft
 * @param {'substance' | 'form'} [stage]
 * @returns {string}
 */
export function buildSeoRevisionRequest(issues, { title, excerpt }, stage = 'form') {
  const list = issues.map(({ message, fix }, index) => `${index + 1}. ${message}\n   → ${fix}`).join('\n');

  const closing =
    stage === 'substance'
      ? 'Corrija SOMENTE os pontos acima. Nesta rodada não mexa em legibilidade, tamanho de frase nem ' +
        'palavras de transição — isso vem depois, e mexer agora faz você encurtar o texto justamente ' +
        'quando ele precisa crescer. Mantenha tudo o que já está escrito e acrescente por cima.'
      : 'Corrija os pontos acima sem tocar no conteúdo: nenhuma seção a menos, nenhum dado a menos, ' +
        'nenhuma referência a menos, e o mesmo número de palavras ou mais. Onde uma frase for longa ' +
        'demais, divida em duas em vez de apagar a informação.';

  return [
    stage === 'substance'
      ? 'O rascunho ainda não tem substância suficiente para publicar. Problemas medidos:'
      : 'O rascunho está bom de conteúdo, mas reprovou na análise de SEO e legibilidade do WordPress. Problemas medidos:',
    '',
    list,
    '',
    `Para referência, o título atual tem ${String(title ?? '').trim().length} caracteres e o resumo, ${String(excerpt ?? '').trim().length}.`,
    '',
    `${closing} Devolva o rascunho completo no mesmo envelope de marcadores, sem comentar as mudanças.`,
  ].join('\n');
}

/**
 * Resumo curto da auditoria, para a mensagem do Telegram.
 * @param {Array<{ blocking: boolean, message: string }>} issues
 * @returns {string[]}
 */
export function summarizeIssues(issues) {
  return (issues ?? []).map(({ message }) => message);
}

/**
 * Flesch Reading Ease adaptado ao português (Martins et al.), que é a fórmula
 * usada pelo analisador pt-BR do WordPress.
 * @param {string} text - Texto puro, sem HTML
 * @returns {number | null} Null quando não há texto medível
 */
export function fleschReadingEase(text) {
  const sentences = splitSentences(text);
  const words = wordsOf(text);
  if (sentences.length === 0 || words.length === 0) return null;

  const syllables = words.reduce((total, word) => total + countSyllables(word), 0);

  return 248.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);
}

/**
 * Conta sílabas por grupos de vogais — aproximação suficiente para a média de
 * um texto inteiro, que é o que a fórmula usa.
 * @param {string} word
 * @returns {number}
 */
export function countSyllables(word) {
  const groups = String(word ?? '')
    .toLowerCase()
    .match(/[aeiouáàâãéêíóôõúü]+/g);

  return groups ? groups.length : 1;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => countWordsIn(sentence) >= 3);
}

/**
 * Palavras iniciais que se repetem em 3 ou mais frases seguidas.
 * @param {string[]} sentences
 * @returns {string[]}
 */
export function findConsecutiveSameStart(sentences) {
  const found = new Set();
  let run = 1;

  for (let i = 1; i < sentences.length; i++) {
    const previous = firstWord(sentences[i - 1]);
    const current = firstWord(sentences[i]);

    if (current && current === previous) {
      run++;
      if (run >= LIMITS.consecutiveSameStart) found.add(current);
    } else {
      run = 1;
    }
  }

  return [...found];
}

/**
 * @param {string} sentence
 * @returns {boolean}
 */
export function hasTransitionWord(sentence) {
  const text = String(sentence ?? '').toLowerCase();
  return TRANSITION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Remove comentários de bloco e tags, deixando só o texto lido pelo humano.
 * @param {string} content
 * @returns {string}
 */
export function stripBlocks(content) {
  return String(content ?? '')
    .replace(/<!--[\s\S]*?-->/g, '\n')
    // O bloco de código sai antes de tudo: ele não é prosa e distorceria a
    // contagem de frases e sílabas. Precisa vir antes da quebra por tags, senão
    // o `<pre>` seria consumido como se fosse um `<p>`.
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<(?:h[1-6]|p|li|figcaption|td|th)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

/**
 * @param {string} content
 * @returns {string[]}
 */
function paragraphs(content) {
  return [...String(content ?? '').matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(([, inner]) =>
    inner.replace(/<[^>]*>/g, ' ')
  );
}

/**
 * Maior bloco de texto, em palavras, entre dois subtítulos.
 * @param {string} content
 * @returns {number}
 */
function largestSubheadingGap(content) {
  return String(content ?? '')
    .split(/<h[23][^>]*>/i)
    .map((chunk) => countWordsIn(stripBlocks(chunk)))
    .reduce((max, words) => Math.max(max, words), 0);
}

/**
 * @param {string} content
 * @returns {string[]}
 */
function extractLinks(content) {
  return [...String(content ?? '').matchAll(/<a\s[^>]*href="([^"]+)"/gi)].map(([, href]) => href);
}

/**
 * @param {string} href
 * @param {string} [blogBaseUrl]
 * @returns {boolean}
 */
function isInternal(href, blogBaseUrl) {
  if (/^[#/]/.test(href)) return true;
  if (!blogBaseUrl) return /cienciaembarcada\.com\.br/i.test(href);

  try {
    return new URL(href).host === new URL(blogBaseUrl).host;
  } catch {
    return false;
  }
}

/**
 * Host de uma URL, usado para contar fontes distintas — três links para a mesma
 * documentação são uma referência, não três.
 * @param {string} href
 * @returns {string}
 */
function hostOf(href) {
  try {
    return new URL(href).host.toLowerCase();
  } catch {
    return String(href ?? '').toLowerCase();
  }
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function wordsOf(text) {
  return String(text ?? '').match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
}

/**
 * @param {string} text
 * @returns {number}
 */
function countWordsIn(text) {
  return wordsOf(text).length;
}

/**
 * @param {string} sentence
 * @returns {string}
 */
function firstWord(sentence) {
  return (wordsOf(sentence)[0] ?? '').toLowerCase();
}

/**
 * @param {number} ratio
 * @returns {string}
 */
function percent(ratio) {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { LIMITS as SEO_LIMITS };
