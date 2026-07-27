/**
 * Módulo AI — Serviço (Camada de Aplicação).
 *
 * Responsabilidade única: orquestrar o loop de tool calling com o modelo e
 * manter o histórico da conversa de cada chat. Não conhece Telegram nem
 * formatação de mensagens.
 */

import { logger } from '../../shared/logger.js';
import { ASSISTANT_SYSTEM_PROMPT } from './ai.prompt.js';

/** Limite de idas e vindas de tool calling, para evitar loop infinito. */
const MAX_TOOL_ROUNDS = 6;

/** Teto de caracteres de um resultado de tool devolvido ao modelo. */
const MAX_TOOL_RESULT_CHARS = 20_000;

export class AiService {
  /** @type {import('./ai.client.js').AiClient} */
  #client;
  /** @type {Array<Object>} */
  #tools;
  /** @type {Record<string, (args: Object) => Promise<unknown>>} */
  #dispatcher;
  /** @type {import('../../shared/conversation.store.js').ConversationStore} */
  #conversations;

  /**
   * @param {import('./ai.client.js').AiClient} client
   * @param {Array<Object>} tools
   * @param {Record<string, (args: Object) => Promise<unknown>>} dispatcher
   * @param {import('../../shared/conversation.store.js').ConversationStore} conversations
   */
  constructor(client, tools, dispatcher, conversations) {
    this.#client = client;
    this.#tools = tools;
    this.#dispatcher = dispatcher;
    this.#conversations = conversations;
  }

  /**
   * Processa uma pergunta do usuário, executando as tools necessárias, e
   * devolve a resposta final em texto. O histórico do chat entra como contexto
   * e é atualizado ao final.
   * @param {number} chatId
   * @param {string} question
   * @returns {Promise<string>}
   */
  async ask(chatId, question) {
    const history = this.#conversations.get(chatId);
    const messages = [
      { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: question },
    ];

    const answer = await this.#runToolLoop(messages);
    this.#conversations.append(chatId, question, answer);

    return answer;
  }

  /**
   * Esquece o histórico de um chat.
   * @param {number} chatId
   * @returns {boolean} `true` se havia conversa registrada
   */
  reset(chatId) {
    return this.#conversations.clear(chatId);
  }

  /**
   * Roda o modelo até ele parar de pedir tools (ou o teto de rodadas estourar).
   * @param {Array<Object>} messages
   * @returns {Promise<string>}
   */
  async #runToolLoop(messages) {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const { message } = await this.#client.chat(messages, { tools: this.#tools });
      messages.push(message);

      if (!message.tool_calls?.length) {
        return message.content?.trim() || 'Não consegui gerar uma resposta agora. Tenta reformular?';
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

    return '⚠️ Não consegui concluir a consulta — precisei de ferramentas demais em sequência. Tenta uma pergunta mais específica?';
  }

  /**
   * Executa uma tool call solicitada pelo modelo, isolando erros por chamada
   * (um erro numa tool não derruba o loop, só volta como resultado pro modelo,
   * que então consegue tentar outro caminho ou avisar o usuário).
   * @param {{ id: string, function: { name: string, arguments: string } }} toolCall
   * @returns {Promise<unknown>}
   */
  async #runTool(toolCall) {
    const { name, arguments: rawArgs } = toolCall.function;
    const fn = this.#dispatcher[name];

    if (!fn) {
      logger.warn('AI', `Modelo pediu tool desconhecida: ${name}`);
      return { error: `Tool desconhecida: ${name}` };
    }

    try {
      const args = rawArgs ? JSON.parse(rawArgs) : {};
      logger.info('AI', `tool=${name} args=${rawArgs ?? '{}'}`);
      return await fn(args);
    } catch (err) {
      logger.warn('AI', `Falha na tool ${name}`, err);
      return { error: err.message };
    }
  }
}

/**
 * Serializa o resultado de uma tool com teto de tamanho. Uma página grande ou
 * uma lista longa pode sozinha estourar a janela de contexto do modelo — cortar
 * aqui é previsível; deixar passar vira erro de API no meio da conversa.
 * @param {unknown} result
 * @returns {string}
 */
function truncateJson(result) {
  const json = JSON.stringify(result ?? null);

  return json.length <= MAX_TOOL_RESULT_CHARS
    ? json
    : `${json.slice(0, MAX_TOOL_RESULT_CHARS)}… [resultado truncado]`;
}
