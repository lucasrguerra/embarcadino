/**
 * Módulo AI — Cliente HTTP (Camada de Infraestrutura).
 *
 * Responsabilidade única: comunicação com o OpenRouter (API compatível com o
 * formato da OpenAI). Não contém lógica de negócio nem conhece Telegram.
 */

const TIMEOUT_MS = 180_000;

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
   * @param {{ tools?: Array<Object>, model?: string, temperature?: number, maxTokens?: number }} [options]
   * @returns {Promise<{ message: Object, finishReason: string }>}
   */
  async chat(messages, { tools = [], model, temperature, maxTokens } = {}) {
    const body = {
      model: model ?? this.#model,
      messages,
    };

    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;

    const response = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        'Content-Type': 'application/json',
        ...this.#attributionHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`OpenRouter API ${response.status}: ${errBody}`);
    }

    const data = await response.json();

    // O OpenRouter devolve 200 com `error` no corpo quando o provedor upstream
    // falha (rate limit, modelo fora do ar) — sem tratar isso, o erro vira um
    // "resposta vazia" silencioso lá na frente.
    if (data.error) {
      throw new Error(`OpenRouter: ${data.error.message ?? JSON.stringify(data.error)}`);
    }

    const choice = data.choices?.[0];

    return {
      message: choice?.message ?? { role: 'assistant', content: '' },
      finishReason: choice?.finish_reason ?? 'stop',
    };
  }
}
