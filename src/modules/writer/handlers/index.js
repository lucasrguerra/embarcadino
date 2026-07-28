/**
 * Módulo Writer — Handlers do Telegram (Camada de Apresentação).
 *
 * Responsabilidade única: agrupar os handlers do módulo numa classe,
 * mantendo a API que o router espera.
 */

import { commandArgument } from '../../../bot/command.utils.js';
import { logger } from '../../../shared/logger.js';
import { describeLlmFailure } from '../../ai/ai.errors.js';

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

export class WriterHandlers {
  /**
   * @param {import('../writer.service.js').WriterService} service
   * @param {import('../writer.formatter.js').WriterFormatter} formatter
   * @param {import('../../blog/blog.service.js').BlogService} blogService
   */
  constructor(service, formatter, blogService) {
    /**
     * /post <tema> [| referência] [| observações] — Pesquisa, redige e salva o
     * rascunho direto no WordPress. Restrito aos chats administradores.
     * @param {import('telegraf').Context} ctx
     */
    this.post = async function post(ctx) {
      const briefing = parseBriefing(commandArgument(ctx, 'post'));

      if (!briefing) {
        return ctx.reply(formatter.formatUsage(), HTML);
      }

      await ctx.reply(formatter.formatStarted(briefing.theme), HTML);

      // A redação com pesquisa passa de um minuto com folga; o "digitando…" do
      // Telegram expira em ~5s, então precisa ser renovado até o fim.
      const typing = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 5000);

      let draft;
      try {
        draft = await service.write(briefing);
      } catch (err) {
        logger.error('WRITER', `Falha ao redigir sobre "${briefing.theme}"`, err);
        // Cota e credencial têm explicação própria: a mensagem padrão sugere
        // delimitar melhor o tema, conselho inútil quando o tema não é o problema.
        return ctx.reply(describeLlmFailure(err) ?? formatter.formatError(), HTML);
      } finally {
        clearInterval(typing);
      }

      // O rascunho vai pro WordPress, mas o texto nunca depende disso: se o
      // blog estiver fora do ar ou a credencial vencida, o arquivo salva o
      // trabalho de vários minutos de redação.
      let published = null;
      if (blogService.canWrite) {
        try {
          published = await blogService.createDraft(draft);
          logger.info('WRITER', `Rascunho ${published.id} criado no WordPress.`);
        } catch (err) {
          logger.error('WRITER', 'Falha ao criar o rascunho no WordPress', err);
        }
      }

      await ctx.reply(formatter.formatSummary(draft, published), HTML);

      if (published) return undefined;

      await ctx.reply(formatter.formatDraftNotSaved(blogService.canWrite), HTML);

      return ctx.replyWithDocument(
        {
          source: Buffer.from(formatter.fileContent(draft), 'utf8'),
          filename: formatter.fileName(draft.title),
        },
        { caption: formatter.formatFileCaption(), parse_mode: 'HTML' }
      );
    };
  }
}

/**
 * Interpreta o argumento do /post no formato `tema | referência | observações`.
 * A referência é reconhecida por ser uma URL, em qualquer das duas últimas
 * posições — assim o Lucas pode mandar só observações sem inventar separador.
 * @param {string} argument
 * @returns {{ theme: string, reference?: string, notes?: string } | null}
 */
export function parseBriefing(argument) {
  const parts = String(argument ?? '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  const [theme, ...rest] = parts;
  if (!theme) return null;

  const reference = rest.find((part) => /^https?:\/\//i.test(part));
  const notes = rest.filter((part) => part !== reference).join(' ');

  return {
    theme,
    ...(reference ? { reference } : {}),
    ...(notes ? { notes } : {}),
  };
}
