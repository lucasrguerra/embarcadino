/**
 * Memória de conversa por chat (Camada de Aplicação).
 *
 * Responsabilidade única: guardar o histórico recente de cada chat pra que o
 * assistente responda "e o segundo?" sem o usuário repetir o contexto inteiro.
 *
 * É deliberadamente em memória: reiniciar o bot esquece as conversas, e isso é
 * aceitável — o custo de um banco não se paga pra um histórico de uma hora.
 * O histórico guarda apenas os turnos user/assistant finais; as idas e vindas de
 * tool calling ficam fora, porque elas só fazem sentido dentro da rodada em que
 * aconteceram e inflariam o contexto (e o custo) de toda pergunta seguinte.
 */

export class ConversationStore {
  /** @type {Map<number, { messages: Array<{role: string, content: string}>, updatedAt: number }>} */
  #chats = new Map();
  /** @type {number} */
  #maxMessages;
  /** @type {number} */
  #ttlMs;

  /**
   * @param {{ maxMessages: number, ttlMs: number }} options
   */
  constructor({ maxMessages, ttlMs }) {
    this.#maxMessages = maxMessages;
    this.#ttlMs = ttlMs;
  }

  /**
   * Devolve o histórico válido de um chat (vazio se expirado ou inexistente).
   * @param {number} chatId
   * @returns {Array<{role: string, content: string}>}
   */
  get(chatId) {
    const entry = this.#chats.get(chatId);
    if (!entry) return [];

    if (Date.now() - entry.updatedAt > this.#ttlMs) {
      this.#chats.delete(chatId);
      return [];
    }

    return entry.messages;
  }

  /**
   * Anexa um turno completo (pergunta + resposta) ao histórico do chat.
   * @param {number} chatId
   * @param {string} question
   * @param {string} answer
   */
  append(chatId, question, answer) {
    const messages = [
      ...this.get(chatId),
      { role: 'user', content: question },
      { role: 'assistant', content: answer },
    ];

    this.#chats.set(chatId, {
      messages: messages.slice(-this.#maxMessages),
      updatedAt: Date.now(),
    });

    this.#pruneExpired();
  }

  /**
   * Esquece a conversa de um chat.
   * @param {number} chatId
   * @returns {boolean} `true` se havia algo pra esquecer
   */
  clear(chatId) {
    return this.#chats.delete(chatId);
  }

  /**
   * Remove conversas vencidas — evita que o Map cresça para sempre num bot
   * público, onde cada curioso que manda uma mensagem vira uma chave nova.
   */
  #pruneExpired() {
    const now = Date.now();
    for (const [chatId, entry] of this.#chats) {
      if (now - entry.updatedAt > this.#ttlMs) {
        this.#chats.delete(chatId);
      }
    }
  }
}
