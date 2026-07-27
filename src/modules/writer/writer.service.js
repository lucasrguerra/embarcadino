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
const MAX_TOOL_ROUNDS = 10;

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
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const { message } = await this.#client.chat(messages, {
        tools: this.#tools,
        model: this.#model,
      });
      messages.push(message);

      if (!message.tool_calls?.length) {
        const content = message.content?.trim();
        if (!content) throw new Error('O modelo devolveu um rascunho vazio.');
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

    throw new Error('O modelo pesquisou demais e não chegou a escrever o rascunho.');
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
