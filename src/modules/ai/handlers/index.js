/**
 * Módulo AI — Handlers do Telegram (Camada de Apresentação).
 *
 * Responsabilidade única: agrupar os handlers do módulo numa classe,
 * mantendo a API que o router espera.
 */

import { createAskHandler } from './ask.js';

const HTML = { parse_mode: 'HTML' };

export class AiHandlers {
  /**
   * @param {import('../ai.service.js').AiService} service
   * @param {import('../ai.formatter.js').AiFormatter} formatter
   */
  constructor(service, formatter) {
    this.ask = createAskHandler(service, formatter);

    /**
     * /reset — Esquece o histórico da conversa deste chat.
     * @param {import('telegraf').Context} ctx
     */
    this.reset = async function reset(ctx) {
      const had = service.reset(ctx.chat.id);
      return ctx.reply(formatter.formatReset(had), HTML);
    };
  }
}
