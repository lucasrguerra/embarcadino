/**
 * Módulo AI — Definição de Tools (Camada de Aplicação).
 *
 * Responsabilidade única: expor ao modelo um conjunto de funções de CONSULTA —
 * busca na web, leitura de páginas, busca no blog e base de conhecimento dos
 * projetos do Ciência Embarcada.
 *
 * IMPORTANTE — restrição de segurança: todas as tools aqui são somente leitura.
 * Nada publica, edita ou apaga conteúdo. Ao adicionar uma tool nova, mantenha a
 * regra: o modelo consulta, quem age é o usuário através dos comandos do bot.
 */

import { logger } from '../../shared/logger.js';

/** @type {Array<Object>} Schemas no formato OpenAI function calling. */
export const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Pesquisa um termo na internet e devolve título, URL e resumo dos resultados. ' +
        'Use para fatos atuais, notícias, especificações técnicas, versões e preços. ' +
        'Os resumos são curtos — para afirmar algo com segurança, leia a fonte com read_page.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Termo de busca. Prefira termos específicos, com nomes de produto/modelo.',
          },
          limit: {
            type: 'integer',
            description: 'Quantos resultados trazer (1 a 10). Padrão: 8.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'google_trends',
      description:
        'Consulta as pesquisas e assuntos em alta no Google Trends do dia (Brasil ou outro país). ' +
        'Use para identificar termos populares e interesses recentes do público.',
      parameters: {
        type: 'object',
        properties: {
          geo: {
            type: 'string',
            description: 'Código do país (ex: "BR" para Brasil, "US" para EUA). Padrão: "BR".',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_page',
      description:
        'Abre uma URL e devolve o texto legível da página (título, descrição e conteúdo). ' +
        'Use para ler a fonte antes de afirmar algo, ou quando o usuário mandar um link. ' +
        'A URL precisa ser copiada de um resultado de web_search — endereço montado de cabeça dá 404. ' +
        'Quando a leitura falha, a resposta traz `error`, `hint` e páginas reais em `suggestions`.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL completa da página' },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blog_search',
      description:
        'Busca publicações do blog Ciência Embarcada por termo, devolvendo título, resumo, ' +
        'data, categorias, link e o id de cada uma. Use sempre que a pergunta for sobre o que ' +
        'o blog já publicou.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Termo de busca no blog' },
          limit: { type: 'integer', description: 'Quantas publicações trazer (1 a 10). Padrão: 5.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blog_latest',
      description: 'Lista as publicações mais recentes do blog Ciência Embarcada.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Quantas publicações trazer (1 a 10). Padrão: 5.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blog_get_post',
      description:
        'Devolve o conteúdo completo de uma publicação do blog a partir do id retornado por ' +
        'blog_search ou blog_latest. Use quando precisar do texto para responder em detalhe.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Id da publicação no blog' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'knowledge_lookup',
      description:
        'Consulta a base oficial de informações sobre o Ciência Embarcada e seus serviços ' +
        '(InBraille e ESPDocs). É a ÚNICA fonte confiável sobre o que esses projetos fazem — ' +
        'chame antes de responder qualquer pergunta sobre eles. Sem argumento, devolve todos.',
      parameters: {
        type: 'object',
        properties: {
          project: {
            type: 'string',
            enum: ['ciencia-embarcada', 'inbraille', 'espdocs'],
            description: 'Projeto específico. Omita para receber todos.',
          },
        },
        additionalProperties: false,
      },
    },
  },
];

/**
 * Constrói o dispatcher de tools — mapeia nome de função para execução real,
 * usando apenas métodos de consulta dos services já existentes.
 * O `sources` é opcional e serve à redação de posts: ele guarda o que a busca
 * devolveu e o que foi realmente lido, para a auditoria poder recusar
 * referência que o modelo não abriu. O assistente do chat não precisa dele.
 * @param {{ researchService: import('../research/research.service.js').ResearchService, blogService: import('../blog/blog.service.js').BlogService, knowledgeService: import('../knowledge/knowledge.service.js').KnowledgeService, sources?: import('../research/source.registry.js').SourceRegistry }} deps
 * @returns {Record<string, (args: Object) => Promise<unknown>>}
 */
export function createToolDispatcher({ researchService, blogService, knowledgeService, sources }) {
  return {
    web_search: async ({ query, limit }) => {
      const results = await researchService.search(query, clampLimit(limit, 8));
      sources?.addSearchResults(results);

      return { query, results };
    },

    google_trends: async ({ geo }) => researchService.getGoogleTrends(geo),

    read_page: async ({ url }) => {
      try {
        const page = await researchService.readPage(url);
        sources?.addRead(page.url);

        return {
          url: page.url,
          title: page.title,
          description: page.description,
          content: page.text,
          truncated: page.truncated,
          links: page.links.slice(0, 10),
        };
      } catch (err) {
        // O modelo erra a URL o tempo todo — ele monta um endereço plausível a
        // partir do nome do site em vez de copiar o que a busca devolveu, e o
        // resultado é 404. Um erro seco faz ele tentar outro palpite; devolver
        // páginas reais sobre o mesmo assunto o traz de volta pra fonte certa.
        // Sem este log a falha some: a tool devolve o erro como resultado, então
        // o `catch` de quem chama nunca dispara e o problema fica invisível.
        logger.warn('TOOLS', `read_page falhou em ${url}`, err);

        return { ...describeReadFailure(url, err), suggestions: await suggestPages(researchService, url) };
      }
    },

    blog_search: async ({ query, limit }) => {
      const posts = await blogService.search(query, clampLimit(limit, 5));
      sources?.addSearchResults(posts);

      return { query, posts };
    },

    blog_latest: async ({ limit }) => ({ posts: await blogService.latest(clampLimit(limit, 5)) }),

    blog_get_post: async ({ id }) => blogService.getPost(id),

    knowledge_lookup: async ({ project }) => {
      if (!project) return { projects: knowledgeService.list() };

      const entry = knowledgeService.get(project);
      return entry ?? { error: `Projeto desconhecido: ${project}`, known: knowledgeService.ids() };
    },
  };
}

/**
 * Traduz a falha de leitura em orientação acionável. Um 404 quase sempre é URL
 * inventada; falha de rede é a página fora do ar, e insistir nela não resolve.
 * @param {string} url
 * @param {Error} err
 * @returns {{ error: string, hint: string }}
 */
export function describeReadFailure(url, err) {
  const message = String(err?.message ?? err);
  const notFound = /status 4\d\d/.test(message);

  return {
    error: `Não consegui ler ${url}: ${message}`,
    hint: notFound
      ? 'Essa URL não existe. Não tente adivinhar outro endereço no mesmo site: use exatamente uma das URLs ' +
        'devolvidas por web_search, copiada caractere por caractere, ou uma das sugestões abaixo.'
      : 'A página não respondeu. Escolha outra fonte, entre as devolvidas por web_search ou entre as sugestões abaixo.',
  };
}

/**
 * Busca páginas reais sobre o mesmo assunto da URL que falhou, usando as
 * palavras do próprio endereço como termo — é a informação que temos sobre o
 * que o modelo queria ler.
 * @param {import('../research/research.service.js').ResearchService} researchService
 * @param {string} url
 * @returns {Promise<Array<{ title: string, url: string }>>}
 */
export async function suggestPages(researchService, url) {
  const query = queryFromUrl(url);
  if (!query) return [];

  try {
    const results = await researchService.search(query, 4);
    return results.map(({ title, url: found }) => ({ title, url: found }));
  } catch {
    // Sugestão é um extra; falhar aqui não pode transformar um erro de leitura
    // em erro de tool.
    return [];
  }
}

/**
 * Transforma "https://site.com/esp32-brownout-detector/" em
 * "site esp32 brownout detector".
 * @param {string} url
 * @returns {string}
 */
export function queryFromUrl(url) {
  const value = String(url ?? '').trim();

  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = parsed.hostname.replace(/^www\./, '').split('.')[0];
    const path = decodeURIComponent(parsed.pathname)
      .replace(/\.\w{2,5}$/, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();

    return [host, path].filter(Boolean).join(' ').slice(0, 120);
  } catch {
    return '';
  }
}

/**
 * Modelos mandam `limit` como string, zero ou 500 — normaliza pra faixa útil.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function clampLimit(value, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 10);
}
