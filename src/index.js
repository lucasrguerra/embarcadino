/**
 * Composition Root — Ponto de entrada da aplicação.
 *
 * Responsabilidade: instanciar e conectar todas as dependências, depois
 * iniciar o bot. Nenhuma lógica de negócio aqui.
 *
 * Ordem de dependências:
 *   Config → Clients (Infrastructure)
 *         → Services (Application)
 *         → Formatters (Presentation)
 *         → Handlers (Presentation)
 *         → Router → Bot
 */

import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { logger } from './shared/logger.js';
import { ConversationStore } from './shared/conversation.store.js';

// Módulo Research
import { ResearchClient } from './modules/research/research.client.js';
import { ResearchService } from './modules/research/research.service.js';
import { ResearchFormatter } from './modules/research/research.formatter.js';
import { ResearchHandlers } from './modules/research/handlers/index.js';

// Módulo Blog
import { BlogClient } from './modules/blog/blog.client.js';
import { BlogService } from './modules/blog/blog.service.js';
import { BlogFormatter } from './modules/blog/blog.formatter.js';
import { BlogHandlers } from './modules/blog/handlers/index.js';

// Módulo Knowledge
import { KnowledgeService } from './modules/knowledge/knowledge.service.js';
import { KnowledgeFormatter } from './modules/knowledge/knowledge.formatter.js';
import { KnowledgeHandlers } from './modules/knowledge/handlers/index.js';

// Módulo AI
import { AiClient } from './modules/ai/ai.client.js';
import { AiService } from './modules/ai/ai.service.js';
import { AiFormatter } from './modules/ai/ai.formatter.js';
import { AiHandlers } from './modules/ai/handlers/index.js';
import { AI_TOOLS, createToolDispatcher } from './modules/ai/ai.tools.js';

// Módulo Writer
import { WriterService } from './modules/writer/writer.service.js';
import { WriterFormatter } from './modules/writer/writer.formatter.js';
import { WriterHandlers } from './modules/writer/handlers/index.js';

// Router
import { registerRoutes } from './bot/router.js';

// ── Bootstrap ──────────────────────────────────────────────────────────────

config.validate();

if (config.telegram.adminChatIds.length === 0) {
  logger.warn('BOOT', 'ADMIN_CHAT_IDS vazio — o comando /post ficará indisponível para todos.');
}

if (!config.blog.username) {
  logger.warn(
    'BOOT',
    'Credenciais do WordPress ausentes — o /post vai entregar o rascunho como arquivo, sem salvar no blog.'
  );
}

// ── Wiring de dependências (Dependency Injection manual) ───────────────────

const researchClient = new ResearchClient(config.research);
const researchService = new ResearchService(researchClient);
const researchFormatter = new ResearchFormatter();
const researchHandlers = new ResearchHandlers(researchService, researchFormatter);

const blogClient = new BlogClient(config.blog);
const blogService = new BlogService(blogClient);
const blogFormatter = new BlogFormatter();
const blogHandlers = new BlogHandlers(blogService, blogFormatter);

const knowledgeService = new KnowledgeService();
const knowledgeFormatter = new KnowledgeFormatter();
const knowledgeHandlers = new KnowledgeHandlers(knowledgeService, knowledgeFormatter);

const aiClient = new AiClient(config.ai);
const toolDispatcher = createToolDispatcher({ researchService, blogService, knowledgeService });
const conversations = new ConversationStore(config.conversation);
const aiService = new AiService(aiClient, AI_TOOLS, toolDispatcher, conversations);
const aiFormatter = new AiFormatter();
const aiHandlers = new AiHandlers(aiService, aiFormatter);

const writerService = new WriterService(aiClient, AI_TOOLS, toolDispatcher, {
  model: config.ai.writerModel,
});
const writerFormatter = new WriterFormatter();
const writerHandlers = new WriterHandlers(writerService, writerFormatter, blogService);

// ── Bot ────────────────────────────────────────────────────────────────────

const bot = new Telegraf(config.telegram.token, {
  // A redação de um post passa fácil de um minuto; o padrão do Telegraf
  // (90s) cortaria o handler no meio e o rascunho nunca chegaria ao chat.
  handlerTimeout: 15 * 60 * 1000,
});

registerRoutes(bot, {
  ai: aiHandlers,
  blog: blogHandlers,
  knowledge: knowledgeHandlers,
  research: researchHandlers,
  writer: writerHandlers,
});

// ── Checagem de credenciais do blog (não bloqueia a subida) ────────────────
// Falhar aqui não impede o bot de funcionar — mas descobrir a credencial
// vencida no boot é bem melhor que descobrir depois de cinco minutos de
// redação, com o rascunho pronto e sem onde salvar.

if (blogService.canWrite) {
  blogService
    .verifyCredentials()
    .then((user) => logger.info('BLOG', `Escrita no WordPress habilitada como "${user.name}".`))
    .catch((err) => logger.error('BLOG', 'Credenciais do WordPress recusadas', err));
}

// ── Inicialização com retry (trata race condition de rede no Docker) ────────

async function launchWithRetry(maxRetries = 10, delayMs = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await bot.launch();
      logger.info('LAUNCH', '✅ Embarcadino iniciado com sucesso.');
      return;
    } catch (err) {
      logger.error('LAUNCH', `Tentativa ${attempt}/${maxRetries} falhou`, err);

      if (attempt < maxRetries) {
        logger.info('LAUNCH', `Aguardando ${delayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        logger.error('LAUNCH', 'Número máximo de tentativas atingido. Encerrando.');
        process.exit(1);
      }
    }
  }
}

launchWithRetry();

// ── Graceful shutdown ──────────────────────────────────────────────────────

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
