/**
 * Módulo Writer — Serviço (Camada de Aplicação).
 *
 * Responsabilidade única: pedir ao modelo um rascunho de publicação — com o
 * mesmo loop de tool calling do assistente, para que ele pesquise antes de
 * escrever — e transformar a resposta no objeto do rascunho.
 *
 * O modelo devolve um envelope com marcadores de seção (===TITULO=== etc.) em
 * vez de JSON: o conteúdo é HTML de vários milhares de caracteres, cheio de
 * aspas e quebras de linha, e um único escape errado invalidaria o JSON inteiro.
 * Marcador de linha é bem mais difícil de o modelo quebrar — e, se quebrar, dá
 * pra recuperar o texto mesmo assim.
 */

import { logger } from '../../shared/logger.js';
import {
  WRITER_SYSTEM_PROMPT,
  SECTION_MARKERS,
  TOPIC_MARKERS,
  SUGGEST_TOPICS_SYSTEM_PROMPT,
  BLOG_CATEGORIES,
  buildWriterRequest,
  buildTopicsRequest,
} from './writer.prompt.js';
import { auditDraft, buildSeoRevisionRequest, nextRevisionBatch } from './writer.seo.js';

/** Redigir com pesquisa exige mais idas e vindas que responder uma pergunta. */
const MAX_TOOL_ROUNDS = 25;

/**
 * Quantos rounds antes do fim o modelo recebe um aviso para parar de pesquisar
 * e começar a redigir. Nos últimos FORCE_TEXT_ROUNDS, as tools são omitidas
 * da chamada, forçando o modelo a produzir texto.
 */
const NUDGE_ROUNDS_BEFORE_END = 3;
const FORCE_TEXT_ROUNDS = 2;

/** Número máximo de tentativas de pedir o formato de marcadores ao modelo. */
const MAX_MARKER_RETRIES = 2;

/**
 * Timeout para o round de redação (sem tools). Gerar 1000-3000 palavras de
 * HTML Gutenberg com todo o contexto de pesquisa leva bem mais que os 180s
 * padrão da API.
 */
const WRITE_TIMEOUT_MS = 300_000;

/** Teto de caracteres de um resultado de tool devolvido ao modelo. */
const MAX_TOOL_RESULT_CHARS = 20_000;

/**
 * Quantas vezes o rascunho volta para o modelo por reprovar na auditoria.
 *
 * Como a correção é escalonada (substância primeiro, forma depois), o ciclo
 * gasta pelo menos uma rodada em cada etapa — e uma tentativa descartada por
 * encolher o texto consome uma delas. Cinco dá folga para as duas etapas
 * fecharem mesmo com um tropeço no meio.
 */
const MAX_SEO_REVISIONS = 5;

/**
 * Piso de palavras aceito numa revisão, em relação ao rascunho anterior.
 *
 * Era 0.8, e isso transformava o ciclo numa bomba de encolhimento: cada rodada
 * podia perder 20% do texto, e "encurte as frases" é justamente o conselho que
 * o modelo executa cortando conteúdo. Duas rodadas levavam um post de 1.000
 * palavras a 640. A tolerância agora é de 5%, o suficiente para trocar
 * "possibilita a realização de" por "permite" sem abrir espaço para amputação.
 */
const MIN_REVISION_WORD_RATIO = 0.95;

/**
 * Leituras de página exigidas antes de aceitar o rascunho. Buscar sem ler
 * devolve título e snippet, e é com isso que o modelo escreve raso: sem número,
 * sem especificação e sem referência para citar.
 */
const MIN_PAGE_READS = 2;

/** Quantas vezes insistimos que o modelo pesquise antes de redigir. */
const MAX_RESEARCH_PUSHBACKS = 1;

/**
 * Idas ao modelo dentro de uma rodada de revisão. Mais de uma só é necessária
 * quando ele abre fonte nova para completar as referências.
 */
const MAX_REVISION_ROUNDS = 4;

export class WriterService {
  /** @type {import('../ai/ai.client.js').AiClient} */
  #client;
  /** @type {Array<Object>} */
  #tools;
  /** @type {Record<string, (args: Object) => Promise<unknown>>} */
  #dispatcher;
  /** @type {string | undefined} */
  #model;
  /** @type {string | undefined} */
  #blogBaseUrl;
  /** @type {import('../research/source.registry.js').SourceRegistry | undefined} */
  #sources;

  /**
   * @param {import('../ai/ai.client.js').AiClient} client
   * @param {Array<Object>} tools
   * @param {Record<string, (args: Object) => Promise<unknown>>} dispatcher
   * @param {{ model?: string, blogBaseUrl?: string, sources?: import('../research/source.registry.js').SourceRegistry }} [options]
   */
  constructor(client, tools, dispatcher, { model, blogBaseUrl, sources } = {}) {
    this.#client = client;
    this.#tools = tools;
    this.#dispatcher = dispatcher;
    this.#model = model;
    this.#blogBaseUrl = blogBaseUrl;
    this.#sources = sources;
  }

  /**
   * Redige um rascunho de publicação, já revisado contra os critérios de SEO e
   * legibilidade do WordPress.
   * @param {{ theme: string, notes?: string, reference?: string }} briefing
   * @returns {Promise<{ title: string, excerpt: string, categories: string[], content: string, words: number, seo: Array<Object> }>}
   */
  async write(briefing) {
    // O registro é por redação: fonte lida no post anterior não autoriza
    // referência no próximo.
    this.#sources?.clear();

    const messages = [
      { role: 'system', content: WRITER_SYSTEM_PROMPT },
      { role: 'user', content: buildWriterRequest(briefing) },
    ];

    const raw = await this.#runToolLoop(messages);
    const draft = parseDraft(raw, briefing.theme);

    return this.#reviseForSeo(messages, draft, briefing.theme);
  }

  /**
   * Analisa tendências e o histórico do blog para sugerir temas de publicações.
   * @param {string} [focus]
   * @returns {Promise<Array<{ title: string, categories: string[], trend: string, angle: string }>>}
   */
  async suggestTopics(focus) {
    const messages = [
      { role: 'system', content: SUGGEST_TOPICS_SYSTEM_PROMPT },
      { role: 'user', content: buildTopicsRequest(focus) },
    ];

    const raw = await this.#runToolLoopForTopics(messages);
    return parseTopics(raw);
  }

  /**
   * Devolve o rascunho ao modelo enquanto a auditoria apontar problema que ele
   * consegue corrigir reescrevendo. O rascunho entregue nunca é descartado: se
   * a revisão falhar ou vier mutilada, seguimos com a versão anterior e o
   * relatório de SEO vai junto, para o Lucas decidir na revisão manual.
   * @param {Array<Object>} messages
   * @param {{ title: string, excerpt: string, content: string, words: number }} initial
   * @param {string} theme
   * @returns {Promise<Object>}
   */
  async #reviseForSeo(messages, initial, theme) {
    let draft = initial;
    const options = { blogBaseUrl: this.#blogBaseUrl, sources: this.#sources };

    for (let attempt = 1; attempt <= MAX_SEO_REVISIONS; attempt++) {
      const issues = auditDraft(draft, options);
      const blocking = issues.filter((issue) => issue.blocking);

      if (blocking.length === 0) {
        logger.info('WRITER', `Rascunho aprovado na auditoria de SEO (${issues.length} avisos).`);
        return { ...draft, seo: issues };
      }

      // Uma rodada trata de substância OU de forma, nunca das duas: pedir
      // "amplie" e "encurte as frases" juntos trava o ciclo.
      const { stage, issues: batch } = nextRevisionBatch(issues);

      logger.info(
        'WRITER',
        `Auditoria de SEO reprovou (tentativa ${attempt}/${MAX_SEO_REVISIONS}, corrigindo ${stage}): ${blocking
          .map((issue) => issue.code)
          .join(', ')}`
      );

      messages.push({ role: 'user', content: buildSeoRevisionRequest(batch, draft, stage) });

      // Na rodada de substância as ferramentas ficam liberadas: ampliar o texto
      // e trocar referência exigem abrir fonte nova. Na de forma, bloqueadas,
      // para ele não recomeçar a pesquisa em vez de reescrever.
      const needsResearch = stage === 'substance';

      let content;
      try {
        content = await this.#completeRevision(messages, needsResearch);
      } catch (err) {
        logger.warn('WRITER', 'Falha na revisão de SEO, seguindo com o rascunho anterior', err);
        break;
      }

      if (!content?.includes(SECTION_MARKERS.content)) {
        logger.warn('WRITER', 'Revisão de SEO veio fora do envelope, seguindo com o rascunho anterior.');
        break;
      }

      const revised = parseDraft(content, theme);
      if (revised.words < draft.words * MIN_REVISION_WORD_RATIO) {
        // Descartar e desistir era o comportamento anterior, e ele entregava o
        // rascunho com TODAS as pendências de pé por causa de uma tentativa
        // ruim. Agora a tentativa é descartada e o modelo é avisado do que fez
        // de errado — ele ainda tem as rodadas restantes para acertar.
        logger.warn(
          'WRITER',
          `Revisão de SEO cortou o texto (${draft.words} → ${revised.words} palavras), descartando a tentativa.`
        );
        messages.push({
          role: 'user',
          content:
            `Essa revisão cortou o texto de ${draft.words} para ${revised.words} palavras, e conteúdo não pode ` +
            'ser removido. Refaça a partir da versão anterior, mantendo todas as seções, todos os dados e todas ' +
            'as referências. Se precisar encurtar frases, divida uma frase em duas — isso não reduz o número de ' +
            'palavras. Apagar parágrafo, item de lista ou referência para "melhorar a métrica" é o oposto do que ' +
            'estou pedindo.',
        });
        continue;
      }

      // As categorias não são reavaliadas pela auditoria; se a revisão vier sem
      // elas, as do rascunho original continuam valendo.
      draft = { ...revised, categories: revised.categories.length ? revised.categories : draft.categories };
    }

    const remaining = auditDraft(draft, options);
    if (remaining.some((issue) => issue.blocking)) {
      logger.warn(
        'WRITER',
        `Rascunho entregue com pendências de SEO: ${remaining.map((issue) => issue.code).join(', ')}`
      );
    }

    return { ...draft, seo: remaining };
  }

  /**
   * @param {Array<Object>} messages
   * @returns {Promise<string>}
   */
  async #runToolLoop(messages) {
    let markerRetries = 0;
    let pageReads = 0;
    let researchPushbacks = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const remainingRounds = MAX_TOOL_ROUNDS - round;

      // Nos últimos rounds ou após o primeiro rascunho sem marcadores,
      // forçamos o modelo a responder com texto (tool_choice: 'none').
      // Manter a lista de `tools` na requisição é OBRIGATÓRIO para que as APIs
      // (OpenAI/OpenRouter) validem os `tool_calls` presentes no histórico.
      const forceText = remainingRounds <= FORCE_TEXT_ROUNDS || markerRetries > 0;

      // Quando faltam poucos rounds e ainda não recebemos o rascunho,
      // injetamos um aviso para o modelo encerrar a pesquisa.
      if (remainingRounds === NUDGE_ROUNDS_BEFORE_END && !forceText) {
        logger.info('WRITER', 'Injetando nudge para o modelo parar de pesquisar e redigir.');
        messages.push({
          role: 'user',
          content:
            'Você já pesquisou o suficiente. Pare de chamar ferramentas e escreva o rascunho ' +
            'completo AGORA, no envelope de marcadores combinado (===TITULO===, ===RESUMO===, ' +
            '===CATEGORIAS===, ===CONTEUDO===). Use as informações que já coletou.',
        });
      }

      const { message } = await this.#client.chat(messages, {
        tools: this.#tools,
        model: this.#model,
        ...(forceText ? { toolChoice: 'none', timeout: WRITE_TIMEOUT_MS } : {}),
      });
      messages.push(message);

      if (!message.tool_calls?.length) {
        const content = message.content?.trim();
        if (!content) throw new Error('O modelo devolveu um rascunho vazio.');

        // Se o rascunho não contiver os marcadores obrigatórios, o modelo pode ter
        // dado uma resposta intermediária/conversacional ou esquecido o formato.
        // Solicitamos que ele gere o texto no formato esperado.
        const hasMarkers = content.includes(SECTION_MARKERS.title) && content.includes(SECTION_MARKERS.content);
        if (!hasMarkers) {
          markerRetries++;
          if (markerRetries > MAX_MARKER_RETRIES) {
            logger.warn('WRITER', `Modelo não enviou marcadores após ${markerRetries} tentativas, aceitando texto cru.`);
            return content;
          }
          logger.info('WRITER', `Modelo não enviou marcadores (tentativa ${markerRetries}/${MAX_MARKER_RETRIES}), solicitando formato correto...`);
          messages.push({
            role: 'user',
            content: `Escreva o rascunho completo da publicação sobre o tema proposto, seguindo estritamente a estrutura e o envelope de marcadores combinados:
${SECTION_MARKERS.title}
[Título da publicação]

${SECTION_MARKERS.excerpt}
[Resumo de uma ou duas frases]

${SECTION_MARKERS.categories}
[Categorias]

${SECTION_MARKERS.content}
[Corpo do texto com os blocos Gutenberg do WordPress]

Não adicione comentários, introduções ou explicações fora do envelope. Comece direto no marcador ${SECTION_MARKERS.title}.`
          });
          continue;
        }

        // Rascunho entregue sem ter aberto fonte nenhuma: o modelo se contentou
        // com os snippets da busca. Mandamos de volta uma vez, com as tools
        // ainda disponíveis — é a diferença entre um post com especificação e
        // um post genérico.
        const reads = this.#sources?.readCount ?? pageReads;
        if (reads < MIN_PAGE_READS && researchPushbacks < MAX_RESEARCH_PUSHBACKS && !forceText) {
          researchPushbacks++;
          logger.info('WRITER', `Rascunho antes da pesquisa (${reads} leitura(s)), exigindo read_page.`);
          messages.push({
            role: 'user',
            content:
              `Antes de fechar o rascunho: você abriu ${reads} página(s) com read_page. ` +
              `Leia ao menos ${MIN_PAGE_READS} fontes primárias agora (documentação oficial, datasheet, ` +
              'aviso do fabricante, relatório técnico) sobre os pontos centrais do tema. ' +
              'Depois reescreva o rascunho completo usando os dados concretos que encontrar — número, ' +
              'versão, especificação, limite — e cite essas fontes na seção Referências.',
          });
          continue;
        }

        return content;
      }

      for (const toolCall of message.tool_calls) {
        const result = await this.#runTool(toolCall);

        // Só leitura bem-sucedida conta. A tool devolve `{ error }` em vez de
        // estourar quando a URL não existe, e sem esse filtro dois palpites
        // errados satisfariam a exigência de pesquisa. Páginas repetidas também
        // não contam duas vezes — daí preferir o registro, que deduplica.
        if (toolCall.function?.name === 'read_page' && !result?.error) pageReads++;

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: truncateJson(result),
        });
      }
    }

    throw new Error('O modelo não gerou o rascunho no formato correto após várias tentativas ou pesquisou demais.');
  }

  /**
   * Uma rodada de revisão: pede o rascunho corrigido e, se o modelo resolver
   * pesquisar antes, executa as ferramentas e volta a pedir. Sem esse laço, a
   * resposta com tool_calls chegaria aqui como "revisão fora do envelope" e a
   * correção seria descartada.
   * @param {Array<Object>} messages
   * @param {boolean} allowTools
   * @returns {Promise<string>} Conteúdo textual da revisão
   */
  async #completeRevision(messages, allowTools) {
    for (let round = 0; round < MAX_REVISION_ROUNDS; round++) {
      const lastRound = round === MAX_REVISION_ROUNDS - 1;

      const { message } = await this.#client.chat(messages, {
        tools: this.#tools,
        model: this.#model,
        // Na última rodada o texto é obrigatório, senão a revisão se perde em
        // pesquisa e volta sem rascunho nenhum.
        ...(allowTools && !lastRound ? {} : { toolChoice: 'none' }),
        timeout: WRITE_TIMEOUT_MS,
      });
      messages.push(message);

      if (!message.tool_calls?.length) return message.content?.trim() ?? '';

      for (const toolCall of message.tool_calls) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: truncateJson(await this.#runTool(toolCall)),
        });
      }
    }

    return '';
  }

  /**
   * Executa o loop de ferramentas específico para pesquisa de temas.
   * @param {Array<Object>} messages
   * @returns {Promise<string>}
   */
  async #runToolLoopForTopics(messages) {
    const MAX_TOPICS_TOOL_ROUNDS = 8;

    for (let round = 0; round < MAX_TOPICS_TOOL_ROUNDS; round++) {
      const remainingRounds = MAX_TOPICS_TOOL_ROUNDS - round;
      const forceText = remainingRounds <= 1;

      const { message } = await this.#client.chat(messages, {
        tools: this.#tools,
        model: this.#model,
        ...(forceText ? { toolChoice: 'none' } : {}),
      });
      messages.push(message);

      if (!message.tool_calls?.length) {
        const content = message.content?.trim();
        if (!content) throw new Error('O modelo devolveu uma resposta vazia ao sugerir temas.');
        return content;
      }

      for (const toolCall of message.tool_calls) {
        const result = await this.#runTool(toolCall);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: truncateJson(result),
        });
      }
    }

    throw new Error('O modelo não concluiu a pesquisa de temas a tempo.');
  }

  /**
   * @param {{ id: string, function: { name: string, arguments: string } }} toolCall
   * @returns {Promise<unknown>}
   */
  async #runTool(toolCall) {
    const { name, arguments: rawArgs } = toolCall.function;
    const fn = this.#dispatcher[name];

    if (!fn) return { error: `Tool desconhecida: ${name}` };

    try {
      logger.info('WRITER', `tool=${name} args=${rawArgs ?? '{}'}`);
      return await fn(rawArgs ? JSON.parse(rawArgs) : {});
    } catch (err) {
      logger.warn('WRITER', `Falha na tool ${name}`, err);
      return { error: err.message };
    }
  }
}

/**
 * Extrai título, resumo, categorias e conteúdo do envelope devolvido pelo modelo.
 * Tolerante de propósito: se um marcador faltar, o que dá pra aproveitar é
 * aproveitado — perder 2.000 palavras de rascunho por causa de um cabeçalho
 * ausente seria o pior desfecho possível.
 * @param {string} raw
 * @param {string} theme
 * @returns {{ title: string, excerpt: string, categories: string[], content: string, words: number }}
 */
export function parseDraft(raw, theme = '') {
  const text = String(raw ?? '').replace(/\r/g, '');

  const title = section(text, SECTION_MARKERS.title, SECTION_MARKERS.excerpt).trim();
  const excerpt = section(text, SECTION_MARKERS.excerpt, SECTION_MARKERS.categories).trim();
  const categoriesRaw = section(text, SECTION_MARKERS.categories, SECTION_MARKERS.content);
  const content = section(text, SECTION_MARKERS.content, null).trim();

  // Sem o marcador de conteúdo, o corpo é o que sobrou da resposta — mesmo
  // desformatado, é preferível entregar ao Lucas do que descartar.
  const body = content || text.trim();

  return {
    title: title || theme,
    excerpt,
    categories: parseCategories(categoriesRaw),
    content: body,
    words: countWords(body),
  };
}

/**
 * @param {string} text
 * @param {string} start
 * @param {string | null} end
 * @returns {string}
 */
function section(text, start, end) {
  const from = text.indexOf(start);
  if (from === -1) return '';

  const contentStart = from + start.length;
  const to = end ? text.indexOf(end, contentStart) : -1;

  return text.slice(contentStart, to === -1 ? undefined : to);
}

/**
 * Aceita apenas categorias que existem de fato no WordPress do blog — o modelo
 * às vezes inventa uma ("hardware", "tutorial") e uma categoria inexistente
 * viraria um rascunho impossível de publicar sem edição manual.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseCategories(raw) {
  const candidates = String(raw ?? '')
    .split(/[,\n]/)
    .map((value) => value.trim().toLowerCase().replace(/^[-•*]\s*/, ''))
    .filter(Boolean);

  return [...new Set(candidates.filter((value) => BLOG_CATEGORIES.includes(value)))];
}

/**
 * @param {string} content
 * @returns {number}
 */
export function countWords(content) {
  const text = String(content ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ');

  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * @param {unknown} result
 * @returns {string}
 */
function truncateJson(result) {
  const json = JSON.stringify(result ?? null);
  return json.length <= MAX_TOOL_RESULT_CHARS
    ? json
    : `${json.slice(0, MAX_TOOL_RESULT_CHARS)}… [resultado truncado]`;
}

/**
 * Extrai a lista de tópicos sugeridos pelo modelo a partir dos marcadores TOPIC_MARKERS.
 * @param {string} raw
 * @returns {Array<{ title: string, categories: string[], trend: string, angle: string }>}
 */
export function parseTopics(raw) {
  const text = String(raw ?? '').replace(/\r/g, '');
  const blocks = text.split(TOPIC_MARKERS.item).map((b) => b.trim()).filter(Boolean);

  const topics = [];

  for (const block of blocks) {
    const title = extractTopicSection(block, TOPIC_MARKERS.title, TOPIC_MARKERS.categories).trim();
    const categoriesRaw = extractTopicSection(block, TOPIC_MARKERS.categories, TOPIC_MARKERS.trend);
    const trend = extractTopicSection(block, TOPIC_MARKERS.trend, TOPIC_MARKERS.angle).trim();
    const angle = extractTopicSection(block, TOPIC_MARKERS.angle, null).trim();

    if (title || trend || angle) {
      topics.push({
        title: title || 'Tema sem título',
        categories: parseCategories(categoriesRaw),
        trend: trend || '',
        angle: angle || '',
      });
    }
  }

  if (topics.length === 0 && text.trim()) {
    return [
      {
        title: 'Sugestões de temas',
        categories: [],
        trend: '',
        angle: text.trim(),
      },
    ];
  }

  return topics;
}

/**
 * @param {string} text
 * @param {string} startMarker
 * @param {string | null} endMarker
 * @returns {string}
 */
function extractTopicSection(text, startMarker, endMarker) {
  const from = text.indexOf(startMarker);
  if (from === -1) return '';

  const contentStart = from + startMarker.length;
  const to = endMarker ? text.indexOf(endMarker, contentStart) : -1;

  return text.slice(contentStart, to === -1 ? undefined : to);
}

