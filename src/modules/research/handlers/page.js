/**
 * Módulo Research — Handler /pagina (Camada de Apresentação).
 */

import { commandArgument } from '../../../bot/command.utils.js';
import { escapeHtml } from '../../../shared/html.utils.js';
import { splitIntoChunks } from '../../../shared/text.utils.js';

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

/**
 * @param {import('../research.service.js').ResearchService} service
 * @param {import('../research.formatter.js').ResearchFormatter} formatter
 * @returns {(ctx: import('telegraf').Context) => Promise<unknown>}
 */
export function createPageHandler(service, formatter) {
  /**
   * /pagina <url> — Lê uma página e devolve o conteúdo em texto.
   * @param {import('telegraf').Context} ctx
   */
  return async function page(ctx) {
    const url = commandArgument(ctx, 'pagina');

    if (!url) {
      return ctx.reply(formatter.formatPageUsage(), HTML);
    }

    await ctx.sendChatAction('typing');

    let content;
    try {
      content = await service.readPage(url);
    } catch {
      // Falha de leitura é o caso comum (site fora do ar, bloqueio de bot) e não
      // um defeito do bot — vira mensagem útil, não erro genérico do wrap().
      return ctx.reply(formatter.formatPageError(url), HTML);
    }

    await ctx.reply(formatter.formatPageHeader(content), HTML);

    // O corpo vai como texto puro escapado: é conteúdo de terceiro, sem estrutura
    // confiável, e formatá-lo só criaria chance de HTML quebrado.
    for (const chunk of splitIntoChunks(escapeHtml(content.text))) {
      await ctx.reply(chunk, HTML);
    }
  };
}
