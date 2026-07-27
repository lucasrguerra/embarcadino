/**
 * Configuração central da aplicação.
 *
 * Segredos sensíveis (tokens, chaves) são armazenados em base64 no .env,
 * identificados pelo sufixo _BASE64. Isso evita que caracteres especiais
 * (como $, #, %) sejam interpretados pelo Docker Compose como variáveis de shell.
 *
 * Valores não-sensíveis (URLs, IDs numéricos, nomes de modelo) ficam em texto simples.
 */

/**
 * Decodifica um valor base64 a partir de uma variável de ambiente.
 * @param {string} envKey - Nome da variável (com sufixo _BASE64)
 * @returns {string | undefined}
 */
function fromBase64(envKey) {
  const value = process.env[envKey];
  if (!value) return undefined;
  return Buffer.from(value, 'base64').toString('utf8');
}

/**
 * Lê uma lista separada por vírgulas de IDs numéricos.
 * @param {string} envKey
 * @returns {number[]}
 */
function parseIdList(envKey) {
  return String(process.env[envKey] ?? '')
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => Number.isInteger(id));
}

class Config {
  get telegram() {
    return {
      token: fromBase64('TELEGRAM_TOKEN_BASE64'),
      /** Chats que podem usar os comandos de redação (/post). Vazio = ninguém. */
      adminChatIds: parseIdList('ADMIN_CHAT_IDS'),
    };
  }

  get ai() {
    return {
      baseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: fromBase64('LLM_API_KEY_BASE64'),
      model: process.env.LLM_MODEL || 'google/gemini-2.0-flash-001',
      /** Modelo usado na redação de posts — tarefa longa, vale um modelo mais forte. */
      writerModel: process.env.LLM_WRITER_MODEL || process.env.LLM_MODEL || 'google/gemini-2.0-flash-001',
      /**
       * Modelo de geração de imagem das ilustrações do post. Responde no mesmo
       * endpoint de chat, com a modalidade de imagem pedida na saída.
       */
      imageModel: process.env.LLM_IMAGE_MODEL || 'google/gemini-3.1-flash-image',
      /** Enviados ao OpenRouter para atribuição do app no ranking deles. */
      appUrl: process.env.LLM_APP_URL || 'https://cienciaembarcada.com.br',
      appName: process.env.LLM_APP_NAME || 'Embarcadino',
    };
  }

  get blog() {
    return {
      baseUrl: process.env.BLOG_BASE_URL || 'https://cienciaembarcada.com.br',
      /**
       * Credenciais de escrita: usuário do WordPress + Senha de Aplicação
       * (Usuários → Perfil → Senhas de aplicação). Sem elas, o bot só lê o
       * blog e o /post entrega o rascunho como arquivo.
       */
      username: process.env.WORDPRESS_USERNAME,
      appPassword: fromBase64('WORDPRESS_APP_PASSWORD_BASE64'),
    };
  }

  get research() {
    return {
      /**
       * Instância SearXNG (formato JSON) para busca na web. Se ausente, o cliente
       * cai no scraping do endpoint HTML do DuckDuckGo, que não exige chave.
       */
      searxngBaseUrl: process.env.SEARXNG_BASE_URL,
      /** Teto de bytes lidos de uma página, pra não estourar memória em PDFs/HTMLs gigantes. */
      maxPageBytes: parseInt(process.env.RESEARCH_MAX_PAGE_BYTES, 10) || 2_000_000,
      /** Timeout de rede por requisição, em milissegundos. */
      timeoutMs: parseInt(process.env.RESEARCH_TIMEOUT_MS, 10) || 20_000,
    };
  }

  get conversation() {
    return {
      /** Quantas mensagens (user + assistant) manter por chat. */
      maxMessages: parseInt(process.env.CONVERSATION_MAX_MESSAGES, 10) || 20,
      /** Tempo de inatividade até a conversa ser esquecida. */
      ttlMs: parseInt(process.env.CONVERSATION_TTL_MS, 10) || 60 * 60 * 1000,
    };
  }

  /**
   * Valida que todas as variáveis de ambiente obrigatórias estão presentes.
   * Deve ser chamada uma única vez no bootstrap.
   * @throws {Error} se alguma variável estiver ausente ou inválida
   */
  validate() {
    const required = [
      ['TELEGRAM_TOKEN_BASE64', process.env.TELEGRAM_TOKEN_BASE64],
      ['LLM_API_KEY_BASE64', process.env.LLM_API_KEY_BASE64],
    ];

    const missing = required.filter(([, value]) => !value).map(([key]) => key);

    if (missing.length > 0) {
      throw new Error(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
    }

    if (process.env.ADMIN_CHAT_IDS && this.telegram.adminChatIds.length === 0) {
      throw new Error('ADMIN_CHAT_IDS deve ser uma lista de IDs numéricos separados por vírgula.');
    }

    // Meia credencial é sempre engano de configuração, e o sintoma apareceria
    // só lá na frente, como um 401 no meio de uma redação de vários minutos.
    const { username, appPassword } = this.blog;
    if (Boolean(username) !== Boolean(appPassword)) {
      throw new Error(
        'WORDPRESS_USERNAME e WORDPRESS_APP_PASSWORD_BASE64 precisam ser definidos juntos.'
      );
    }
  }
}

export const config = new Config();
