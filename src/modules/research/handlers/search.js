/**
 * Módulo Research — Handler /pesquisar (Camada de Apresentação).
 */

import { commandArgument } from '../../../bot/command.utils.js';

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

/**
 * @param {import('../research.service.js').ResearchService} service
 * @param {import('../research.formatter.js').ResearchFormatter} formatter
 * @returns {(ctx: import('telegraf').Context) => Promise<unknown>}
 */
export function createSearchHandler(service, formatter) {
  /**
   * /pesquisar <termo> — Busca o termo na web e lista os resultados.
   * @param {import('telegraf').Context} ctx
   */
  return async function search(ctx) {
    const query = commandArgument(ctx, 'pesquisar');

    if (!query) {
      return ctx.reply(formatter.formatSearchUsage(), HTML);
    }

    await ctx.sendChatAction('typing');
    const results = await service.search(query);

    return ctx.reply(formatter.formatResults(query, results), HTML);
  };
}
