/**
 * Módulo AI — Cliente HTTP (Camada de Infraestrutura).
 *
 * Responsabilidade única: comunicação com o provedor de LLM (qualquer API no
 * formato da OpenAI — OpenRouter, Google AI Studio, Groq…). Não contém lógica
 * de negócio nem conhece Telegram.
 *
 * Falha transitória é repetida aqui dentro, não lá em cima: uma redação de
 * /post são dezenas de chamadas em sequência e um único 429 de um segundo
 * derrubaria vários minutos de pesquisa já feita. O que NÃO é transitório
 * (cota diária, chave inválida) sobe imediatamente como erro tipado, porque
 * insistir nesses casos só gasta tempo.
 */

import { logger } from '../../shared/logger.js';
import { LlmAuthError, LlmError, LlmQuotaError } from './ai.errors.js';

const TIMEOUT_MS = 180_000;

/** Tentativas totais (a primeira mais as repetições) por chamada. */
const MAX_ATTEMPTS = 3;

/**
 * Teto de espera por uma repetição. Acima disso não vale a pena segurar a
 * chamada: o limite deixou de ser "por minuto" e virou cota, e quem chamou
 * precisa saber disso agora — não daqui a meia hora.
 */
const MAX_RETRY_WAIT_MS = 30_000;

/** Espera base do backoff exponencial quando o provedor não diz quanto esperar. */
const BACKOFF_BASE_MS = 2_000;

export class AiClient {
  /** @type {string} */
  #baseUrl;
  /** @type {string} */
  #apiKey;
  /** @type {string} */
  #model;
  /** @type {Record<string, string>} */
  #attributionHeaders;

  /**
   * @param {{ baseUrl: string, apiKey: string, model: string, appUrl?: string, appName?: string }} config
   */
  constructor({ baseUrl, apiKey, model, appUrl, appName }) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#apiKey = apiKey;
    this.#model = model;
    // Cabeçalhos opcionais do OpenRouter usados só para atribuição do app.
    this.#attributionHeaders = {
      ...(appUrl ? { 'HTTP-Referer': appUrl } : {}),
      ...(appName ? { 'X-Title': appName } : {}),
    };
  }

  /**
   * Envia uma requisição de chat completion, com suporte a tool calling.
   * @param {Array<Object>} messages
   * @param {{ tools?: Array<Object>, toolChoice?: string | Object, model?: string, temperature?: number, maxTokens?: number, timeout?: number }} [options]
   * @returns {Promise<{ message: Object, finishReason: string }>}
   * @throws {LlmQuotaError} cota/rate limit que não adianta repetir agora
   * @throws {LlmAuthError} credencial inválida
   * @throws {LlmError} demais falhas do provedor
   */
  async chat(messages, { tools = [], toolChoice, model, temperature, maxTokens, timeout } = {}) {
    const body = {
      model: model ?? this.#model,
      messages,
    };

    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = toolChoice ?? 'auto';
    }
    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;

    for (let attempt = 1; ; attempt++) {
      const lastAttempt = attempt >= MAX_ATTEMPTS;

      try {
        return await this.#attempt(body, timeout);
      } catch (err) {
        const waitMs = retryDelay(err, attempt);

        if (lastAttempt || waitMs === null) throw err;

        logger.warn(
          'AI',
          `Falha transitória (tentativa ${attempt}/${MAX_ATTEMPTS}), repetindo em ${Math.round(waitMs / 1000)}s`,
          err
        );
        await sleep(waitMs);
      }
    }
  }

  /**
   * Uma única ida ao provedor, já traduzindo a resposta em erro tipado.
   * @param {Object} body
   * @param {number} [timeout]
   * @returns {Promise<{ message: Object, finishReason: string }>}
   */
  async #attempt(body, timeout) {
    let response;

    try {
      response = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeout ?? TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
          ...this.#attributionHeaders,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Timeout e queda de conexão são transitórios por natureza.
      throw new LlmError(`Falha de rede ao falar com o provedor de LLM: ${err.message}`, { cause: err });
    }

    const raw = await response.text().catch(() => '');
    const data = parseJson(raw);

    if (!response.ok) {
      throw errorFor(response.status, data, raw, response.headers);
    }

    // O provedor pode devolver 200 com `error` no corpo quando quem limitou foi
    // o upstream dele — sem tratar isso, o erro vira um "resposta vazia"
    // silencioso lá na frente, no meio da redação.
    if (data?.error) {
      const status = Number(data.error.code) || response.status;
      throw errorFor(status, data, raw, response.headers);
    }

    const choice = data?.choices?.[0];

    return {
      message: choice?.message ?? { role: 'assistant', content: '' },
      finishReason: choice?.finish_reason ?? 'stop',
    };
  }
}

/**
 * Traduz uma resposta de erro do provedor no erro tipado correspondente.
 * @param {number} status
 * @param {Object | null} data
 * @param {string} raw
 * @param {Headers} headers
 * @returns {LlmError}
 */
function errorFor(status, data, raw, headers) {
  const message = data?.error?.message ?? raw.slice(0, 300) ?? '';

  if (status === 401 || status === 403) {
    return new LlmAuthError(`Credencial recusada pelo provedor de LLM (${status}): ${message}`, { status });
  }

  if (status === 429) {
    return new LlmQuotaError(`Limite do provedor de LLM atingido: ${message}`, {
      status,
      resetAt: resetTime(data, headers),
    });
  }

  return new LlmError(`Provedor de LLM respondeu ${status}: ${message}`, { status });
}

/**
 * Descobre quando a cota volta. Cada provedor conta essa história de um jeito:
 *   - `Retry-After` (segundos ou data HTTP) — padrão HTTP, usado pelo AI Studio;
 *   - `X-RateLimit-Reset` em epoch de milissegundos — usado pelo OpenRouter,
 *     que ainda por cima o entrega dentro do corpo, em `error.metadata.headers`.
 * @param {Object | null} data
 * @param {Headers} headers
 * @returns {Date | null}
 */
export function resetTime(data, headers) {
  const bodyHeaders = data?.error?.metadata?.headers ?? {};

  const retryAfter = headers?.get?.('retry-after') ?? bodyHeaders['Retry-After'];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return new Date(Date.now() + seconds * 1000);

    const date = new Date(retryAfter);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const reset = headers?.get?.('x-ratelimit-reset') ?? bodyHeaders['X-RateLimit-Reset'];
  if (reset) {
    const epoch = Number(reset);
    // Valor abaixo de ~1e11 é epoch em segundos, não em milissegundos.
    if (Number.isFinite(epoch) && epoch > 0) {
      return new Date(epoch < 1e11 ? epoch * 1000 : epoch);
    }
  }

  return null;
}

/**
 * Quanto esperar antes de repetir — ou `null` quando repetir não faz sentido.
 *
 * Regra: cota com liberação distante e credencial inválida não melhoram com
 * insistência; rate limit curto e falha de rede/5xx melhoram.
 * @param {unknown} err
 * @param {number} attempt
 * @returns {number | null}
 */
export function retryDelay(err, attempt) {
  if (err instanceof LlmAuthError) return null;

  if (err instanceof LlmQuotaError) {
    if (!err.resetAt) return null;

    const waitMs = err.resetAt.getTime() - Date.now();
    if (waitMs > MAX_RETRY_WAIT_MS) return null;

    // Meio segundo de folga: o relógio do provedor não é o nosso.
    return Math.max(waitMs, 0) + 500;
  }

  if (err instanceof LlmError) {
    // 4xx que não é 429 é erro da nossa requisição — repetir devolve o mesmo erro.
    if (err.status && err.status >= 400 && err.status < 500) return null;
    return BACKOFF_BASE_MS * 2 ** (attempt - 1);
  }

  return null;
}

/**
 * @param {string} raw
 * @returns {Object | null}
 */
function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
