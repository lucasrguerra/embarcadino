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
import { WRITER_SYSTEM_PROMPT, SECTION_MARKERS, BLOG_CATEGORIES, buildWriterRequest } from './writer.prompt.js';

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

export class WriterService {
  /** @type {import('../ai/ai.client.js').AiClient} */
  #client;
  /** @type {Array<Object>} */
  #tools;
  /** @type {Record<string, (args: Object) => Promise<unknown>>} */
  #dispatcher;
  /** @type {string | undefined} */
  #model;

  /**
   * @param {import('../ai/ai.client.js').AiClient} client
   * @param {Array<Object>} tools
   * @param {Record<string, (args: Object) => Promise<unknown>>} dispatcher
   * @param {{ model?: string }} [options]
   */
  constructor(client, tools, dispatcher, { model } = {}) {
    this.#client = client;
    this.#tools = tools;
    this.#dispatcher = dispatcher;
    this.#model = model;
  }

  /**
   * Redige um rascunho de publicação.
   * @param {{ theme: string, notes?: string, reference?: string }} briefing
   * @returns {Promise<{ title: string, excerpt: string, categories: string[], content: string, words: number }>}
   */
  async write(briefing) {
    const messages = [
      { role: 'system', content: WRITER_SYSTEM_PROMPT },
      { role: 'user', content: buildWriterRequest(briefing) },
    ];

    const raw = await this.#runToolLoop(messages);
    return parseDraft(raw, briefing.theme);
  }

  /**
   * @param {Array<Object>} messages
   * @returns {Promise<string>}
   */
  async #runToolLoop(messages) {
    let markerRetries = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const remainingRounds = MAX_TOOL_ROUNDS - round;

      // Nos últimos rounds, omitir as tools força o modelo a produzir texto.
      const sendTools = remainingRounds > FORCE_TEXT_ROUNDS;

      // Quando faltam poucos rounds e ainda não recebemos o rascunho,
      // injetamos um aviso para o modelo encerrar a pesquisa.
      if (remainingRounds === NUDGE_ROUNDS_BEFORE_END && sendTools) {
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
        tools: sendTools ? this.#tools : [],
        model: this.#model,
        ...(!sendTools ? { timeout: WRITE_TIMEOUT_MS } : {}),
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

        return content;
      }

      for (const toolCall of message.tool_calls) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: truncateJson(await this.#runTool(toolCall)),
        });
      }
    }

    throw new Error('O modelo não gerou o rascunho no formato correto após várias tentativas ou pesquisou demais.');
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
