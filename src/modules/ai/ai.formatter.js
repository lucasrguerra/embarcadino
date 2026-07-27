/**
 * Módulo AI — Formatador de mensagens (Camada de Apresentação).
 *
 * Responsabilidade única: construir strings HTML para o Telegram.
 * Emoji de categoria: 🤖.
 *
 * O modelo é instruído (ai.prompt.js) a já responder com as tags HTML que o
 * Telegram aceita, mas modelos pequenos nem sempre obedecem — por isso a
 * resposta passa por `sanitizeForTelegramHtml()` em vez de `escapeHtml()` puro,
 * que destruiria a formatação válida junto com a inválida.
 */

import { sanitizeForTelegramHtml } from '../../shared/telegramHtml.js';

const AI_EMOJI = '🤖';

export class AiFormatter {
  /**
   * Resposta final do modelo.
   * @param {string} answer
   * @returns {string} HTML
   */
  formatAnswer(answer) {
    return sanitizeForTelegramHtml(answer);
  }

  /**
   * Mensagem de uso quando /ask vem sem pergunta.
   * @returns {string} HTML
   */
  formatUsage() {
    return (
      `${AI_EMOJI} <b>Pode perguntar</b>\n` +
      '<i>└ Ex: <code>/ask qual ESP32 usar num projeto a bateria?</code> — ou manda a pergunta direto, sem comando</i>'
    );
  }

  /**
   * Confirmação de que a conversa foi esquecida.
   * @param {boolean} had
   * @returns {string} HTML
   */
  formatReset(had) {
    return had
      ? `${AI_EMOJI} Pronto, esqueci nossa conversa. Começamos do zero.`
      : `${AI_EMOJI} Não tinha nada pra esquecer — nossa conversa já estava zerada.`;
  }
}
