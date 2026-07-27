/**
 * Módulo Blog — Handlers do Telegram (Camada de Apresentação).
 *
 * Responsabilidade única: agrupar os handlers do módulo numa classe,
 * mantendo a API que o router espera.
 */

import { commandArgument } from '../../../bot/command.utils.js';

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

export class BlogHandlers {
  /**
   * @param {import('../blog.service.js').BlogService} service
   * @param {import('../blog.formatter.js').BlogFormatter} formatter
   */
  constructor(service, formatter) {
    /**
     * /blog <termo> — Busca publicações do Ciência Embarcada.
     * @param {import('telegraf').Context} ctx
     */
    this.search = async function search(ctx) {
      const query = commandArgument(ctx, 'blog');

      if (!query) {
        return ctx.reply(formatter.formatUsage(), HTML);
      }

      await ctx.sendChatAction('typing');
      const posts = await service.search(query);

      return ctx.reply(formatter.formatSearchResults(query, posts), HTML);
    };

    /**
     * /ultimos — Publicações mais recentes do blog.
     * @param {import('telegraf').Context} ctx
     */
    this.latest = async function latest(ctx) {
      await ctx.sendChatAction('typing');
      const posts = await service.latest();

      return ctx.reply(formatter.formatLatest(posts), HTML);
    };
  }
}
