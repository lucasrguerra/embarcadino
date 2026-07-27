/**
 * Módulo Knowledge — Handlers do Telegram (Camada de Apresentação).
 *
 * Responsabilidade única: agrupar os handlers do módulo numa classe,
 * mantendo a API que o router espera.
 */

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

export class KnowledgeHandlers {
  /** Callback dos botões de projeto no /servicos. */
  static ENTRY_ACTION_PATTERN = /^knowledge:(.+)$/;

  /**
   * @param {import('../knowledge.service.js').KnowledgeService} service
   * @param {import('../knowledge.formatter.js').KnowledgeFormatter} formatter
   */
  constructor(service, formatter) {
    /**
     * Responde a ficha de um projeto fixo (usado por /sobre, /inbraille, /espdocs).
     * @param {string} id
     */
    const entryHandler = (id) =>
      /** @param {import('telegraf').Context} ctx */
      async function entry(ctx) {
        return ctx.reply(formatter.formatEntry(service.get(id)), HTML);
      };

    this.about = entryHandler('ciencia-embarcada');
    this.inbraille = entryHandler('inbraille');
    this.espdocs = entryHandler('espdocs');

    /**
     * /servicos — Panorama dos projetos do Ciência Embarcada.
     * @param {import('telegraf').Context} ctx
     */
    this.services = async function services(ctx) {
      return ctx.reply(formatter.formatOverview(service.list()), HTML);
    };

    /**
     * Callback `knowledge:<id>` — ficha do projeto escolhido no teclado.
     * @param {import('telegraf').Context} ctx
     */
    this.entryCallback = async function entryCallback(ctx) {
      const id = ctx.match?.[1] ?? '';
      const found = service.get(id);

      await ctx.answerCbQuery();

      return ctx.reply(found ? formatter.formatEntry(found) : formatter.formatNotFound(id), HTML);
    };
  }
}
