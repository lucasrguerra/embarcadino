/**
 * Router — Registro centralizado de todos os comandos e actions do bot.
 *
 * Responsabilidade única: mapear comandos/actions do Telegram para os
 * handlers corretos. Não contém lógica de negócio nem formatação.
 *
 * Para adicionar um novo módulo: crie seus handlers e registre aqui.
 */

import { adminOnly } from './middleware/admin.middleware.js';
import { KnowledgeHandlers } from '../modules/knowledge/handlers/index.js';
import { logger } from '../shared/logger.js';

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

const START_MESSAGE =
  '👋 Olá! Eu sou o <b>Embarcadino</b>, o assistente do Ciência Embarcada.\n\n' +
  'Posso explicar conceitos de IoT, sistemas embarcados, eletrônica e redes, pesquisar ' +
  'informação atualizada na internet, achar o que o blog já publicou sobre um assunto e ' +
  'tirar dúvidas sobre o <b>InBraille</b> e o <b>ESPDocs</b>.\n\n' +
  'Pode me perguntar qualquer coisa, sem comando nenhum — ou manda /help pra ver a lista completa.';

const HELP_MESSAGE =
  '🤖 <b>Aqui está tudo que eu sei fazer:</b>\n\n' +
  '💬 <b>Conversar</b>\n' +
  'Manda a pergunta direto, sem comando — eu pesquiso o que precisar antes de responder\n' +
  '/ask &lt;pergunta&gt; — mesma coisa, em formato de comando\n' +
  '/reset — esqueço nossa conversa e recomeçamos do zero\n\n' +
  '🧠 <b>Ciência Embarcada</b>\n' +
  '/sobre — o que é o projeto\n' +
  '/servicos — panorama de tudo que existe por aqui\n' +
  '/inbraille — o conversor de texto para Braille com saída em STL\n' +
  '/espdocs — a documentação do ESP32 em português\n\n' +
  '📰 <b>Blog</b>\n' +
  '/blog &lt;termo&gt; — busca publicações sobre um assunto\n' +
  '/ultimos — as publicações mais recentes\n\n' +
  '🔎 <b>Pesquisa</b>\n' +
  '/pesquisar &lt;termo&gt; — busca na internet\n' +
  '/pagina &lt;url&gt; — leio uma página e te devolvo o conteúdo em texto\n\n' +
  '✍️ <b>Redação</b> <i>(restrito ao Lucas)</i>\n' +
  '/post &lt;tema&gt; — pesquiso e escrevo um rascunho de publicação';

/**
 * Envolve um handler assíncrono com tratamento de erro padronizado.
 * Garante que erros não derrubem o processo nem deixem a conversa travada.
 * @param {Function} handler
 * @returns {Function}
 */
function wrap(handler) {
  return async (ctx) => {
    try {
      await handler(ctx);
    } catch (err) {
      const name = handler.name || 'handler';
      logger.error('HANDLER', `Falha em ${name}`, err);
      await ctx
        .reply(
          '⚠️ <b>Deu ruim aqui do meu lado</b>\n<i>└ Tenta de novo daqui a pouco</i>',
          { parse_mode: 'HTML' }
        )
        .catch(() => {});
    }
  };
}

/**
 * Registra todos os middlewares, comandos e actions no bot.
 *
 * @param {import('telegraf').Telegraf} bot
 * @param {{ ai: import('../modules/ai/handlers/index.js').AiHandlers, blog: import('../modules/blog/handlers/index.js').BlogHandlers, knowledge: KnowledgeHandlers, research: import('../modules/research/handlers/index.js').ResearchHandlers, writer: import('../modules/writer/handlers/index.js').WriterHandlers }} handlers
 */
export function registerRoutes(bot, { ai, blog, knowledge, research, writer }) {
  // ── Middlewares globais ────────────────────────────────────────────────────

  bot.use((ctx, next) => {
    const from = ctx.from?.username ?? ctx.from?.id ?? 'N/A';
    logger.info('UPDATE', `${ctx.updateType} from=${from} chat_id=${ctx.chat?.id}`);
    return next();
  });

  // ── Comandos do sistema ────────────────────────────────────────────────────

  bot.command('start', (ctx) => ctx.reply(START_MESSAGE, HTML));
  bot.command('help', (ctx) => ctx.reply(HELP_MESSAGE, HTML));

  // ── Módulo Knowledge ───────────────────────────────────────────────────────

  bot.command('sobre', wrap(knowledge.about));
  bot.command('servicos', wrap(knowledge.services));
  bot.command('inbraille', wrap(knowledge.inbraille));
  bot.command('espdocs', wrap(knowledge.espdocs));
  bot.action(KnowledgeHandlers.ENTRY_ACTION_PATTERN, wrap(knowledge.entryCallback));

  // ── Módulo Blog ────────────────────────────────────────────────────────────

  bot.command('blog', wrap(blog.search));
  bot.command('ultimos', wrap(blog.latest));

  // ── Módulo Research ────────────────────────────────────────────────────────

  bot.command('pesquisar', wrap(research.search));
  bot.command('pagina', wrap(research.page));

  // ── Módulo Writer (restrito) ───────────────────────────────────────────────

  bot.command('post', adminOnly(wrap(writer.post)));

  // ── Módulo AI ──────────────────────────────────────────────────────────────

  bot.command('ask', wrap(ai.ask));
  bot.command('reset', wrap(ai.reset));

  // ── Fallback ───────────────────────────────────────────────────────────────
  // Texto comum (sem "/") vira pergunta pra IA — é assim que quem chega no bot
  // conversa sem precisar decorar comando. Comando desconhecido continua caindo
  // na mensagem padrão.

  bot.on('message', (ctx) => {
    const text = ctx.message?.text;

    if (text && !text.startsWith('/')) {
      return wrap(ai.ask)(ctx);
    }

    return ctx.reply('🤔 Não conheço esse comando. Manda /help pra ver o que eu sei fazer.');
  });

  // ── Erros globais ──────────────────────────────────────────────────────────

  bot.catch((err, ctx) => {
    logger.error('BOT', `Erro não tratado em update=${ctx.updateType}`, err);
    ctx
      .reply('⚠️ <b>Rolou um perrengue processando seu pedido</b>\n<i>└ Tenta de novo daqui a pouco</i>', {
        parse_mode: 'HTML',
      })
      .catch(() => {});
  });
}
