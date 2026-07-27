/**
 * Módulo AI — Handler /ask (Camada de Apresentação).
 *
 * Também atende mensagem de texto solta (sem "/"), registrada no router — é
 * assim que o bot conversa naturalmente com quem chega pela primeira vez.
 */

import { commandArgument } from '../../../bot/command.utils.js';
import { splitIntoChunks, TELEGRAM_SAFE_CHUNK } from '../../../shared/text.utils.js';

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

/**
 * @param {import('../ai.service.js').AiService} service
 * @param {import('../ai.formatter.js').AiFormatter} formatter
 * @returns {(ctx: import('telegraf').Context) => Promise<unknown>}
 */
export function createAskHandler(service, formatter) {
  /**
   * /ask <pergunta> — Consulta o assistente, que pode pesquisar na web, no blog
   * e na base de conhecimento dos projetos antes de responder.
   * @param {import('telegraf').Context} ctx
   */
  return async function ask(ctx) {
    const text = ctx.message?.text ?? '';
    const question = text.startsWith('/ask') ? commandArgument(ctx, 'ask') : text.trim();

    if (!question) {
      return ctx.reply(formatter.formatUsage(), HTML);
    }

    await ctx.sendChatAction('typing');

    // A consulta pode passar de 30s quando o modelo encadeia buscas; sem renovar,
    // o "digitando…" do Telegram some e a conversa parece travada.
    const typing = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 5000);

    let answer;
    try {
      answer = await service.ask(ctx.chat.id, question);
    } finally {
      clearInterval(typing);
    }

    // Quebra primeiro, sanitiza depois: cortar um HTML já pronto pode deixar
    // uma tag aberta no fim de um pedaço e o Telegram rejeita a mensagem inteira.
    // Sanitizando cada pedaço, cada mensagem enviada fecha suas próprias tags.
    for (const chunk of splitIntoChunks(answer, TELEGRAM_SAFE_CHUNK)) {
      await ctx.reply(formatter.formatAnswer(chunk), HTML);
    }
  };
}
