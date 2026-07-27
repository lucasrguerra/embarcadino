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
            description: 'Quantos resultados trazer (1 a 10). Padrão: 6.',
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
      name: 'read_page',
      description:
        'Abre uma URL e devolve o texto legível da página (título, descrição e conteúdo). ' +
        'Use para ler a fonte antes de afirmar algo, ou quando o usuário mandar um link.',
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
 * @param {{ researchService: import('../research/research.service.js').ResearchService, blogService: import('../blog/blog.service.js').BlogService, knowledgeService: import('../knowledge/knowledge.service.js').KnowledgeService }} deps
 * @returns {Record<string, (args: Object) => Promise<unknown>>}
 */
export function createToolDispatcher({ researchService, blogService, knowledgeService }) {
  return {
    web_search: async ({ query, limit }) => ({
      query,
      results: await researchService.search(query, clampLimit(limit, 6)),
    }),

    read_page: async ({ url }) => {
      const page = await researchService.readPage(url);
      return {
        url: page.url,
        title: page.title,
        description: page.description,
        content: page.text,
        truncated: page.truncated,
        links: page.links.slice(0, 10),
      };
    },

    blog_search: async ({ query, limit }) => ({
      query,
      posts: await blogService.search(query, clampLimit(limit, 5)),
    }),

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
