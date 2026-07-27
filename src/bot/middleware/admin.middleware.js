/**
 * Middleware de administração.
 *
 * Diferente de um bot pessoal, o Embarcadino é público: qualquer pessoa pode
 * conversar com ele sobre o Ciência Embarcada, o InBraille e o ESPDocs. O que
 * é restrito são os comandos de redação (/post), que consomem tokens caros e
 * produzem conteúdo assinado pelo blog — esses ficam só para os chats listados
 * em ADMIN_CHAT_IDS.
 */

import { config } from '../../config.js';
import { logger } from '../../shared/logger.js';

const DENIED_REPLY =
  '🔒 <b>Esse comando é só do Lucas</b>\n' +
  '<i>└ Mas eu posso te ajudar com o resto: manda /help pra ver o que dá pra fazer</i>';

/**
 * Envolve um handler, deixando passar apenas chats administradores.
 * @param {(ctx: import('telegraf').Context) => unknown} handler
 * @returns {(ctx: import('telegraf').Context) => unknown}
 */
export function adminOnly(handler) {
  return (ctx) => {
    const chatId = ctx.chat?.id;

    if (config.telegram.adminChatIds.includes(chatId)) {
      return handler(ctx);
    }

    logger.warn(
      'AUTH',
      `Comando restrito negado — chat_id=${chatId} username=${ctx.from?.username ?? 'N/A'}`
    );

    return ctx.reply(DENIED_REPLY, { parse_mode: 'HTML' });
  };
}
