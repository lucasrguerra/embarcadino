/**
 * Módulo Blog — Serviço (Camada de Aplicação).
 *
 * Responsabilidade única: transformar as respostas cruas do WordPress em
 * objetos limpos (sem HTML, sem entidades, com categorias por nome) prontos
 * pra virar mensagem no Telegram ou resultado de tool pro modelo.
 */

import { truncate } from '../../shared/html.utils.js';
import { normalizeWhitespace } from '../../shared/text.utils.js';

/** Teto de caracteres do conteúdo de um post entregue ao modelo. */
const MAX_CONTENT_CHARS = 12_000;

export class BlogService {
  /** @type {import('./blog.client.js').BlogClient} */
  #client;

  /**
   * @param {import('./blog.client.js').BlogClient} client
   */
  constructor(client) {
    this.#client = client;
  }

  /** @returns {boolean} Se o bot pode criar rascunhos no blog. */
  get canWrite() {
    return this.#client.canWrite;
  }

  /**
   * Busca publicações do blog por termo.
   * @param {string} query
   * @param {number} [limit]
   * @returns {Promise<Array<{ id: number, title: string, excerpt: string, url: string, date: string, categories: string[] }>>}
   */
  async search(query, limit = 5) {
    const [posts, categories] = await Promise.all([
      this.#client.listPosts({ search: query, limit }),
      this.#namesById(),
    ]);

    return posts.map((post) => toSummary(post, categories));
  }

  /**
   * Publicações mais recentes.
   * @param {number} [limit]
   * @returns {Promise<Array<{ id: number, title: string, excerpt: string, url: string, date: string, categories: string[] }>>}
   */
  async latest(limit = 5) {
    return this.search('', limit);
  }

  /**
   * Conteúdo completo de uma publicação, em texto limpo.
   * @param {number} id
   * @returns {Promise<{ id: number, title: string, excerpt: string, url: string, date: string, categories: string[], content: string, truncated: boolean }>}
   */
  async getPost(id) {
    const [post, categories] = await Promise.all([this.#client.getPost(id), this.#namesById()]);

    const content = stripHtml(post.content?.rendered ?? '');
    const truncated = content.length > MAX_CONTENT_CHARS;

    return {
      ...toSummary(post, categories),
      content: truncated ? truncate(content, MAX_CONTENT_CHARS) : content,
      truncated,
    };
  }

  /**
   * Cria o rascunho no WordPress a partir do que o redator produziu.
   *
   * As categorias chegam como slug (é o que o modelo escolhe) e a API do
   * WordPress só aceita id, então a tradução acontece aqui. Slug que não existir
   * no blog é ignorado — melhor um rascunho com uma categoria a menos do que
   * uma requisição recusada inteira.
   *
   * @param {{ title: string, excerpt: string, content: string, categories?: string[] }} draft
   * @returns {Promise<{ id: number, link: string, editLink: string, status: string, categories: string[] }>}
   */
  async createDraft({ title, excerpt, content, categories = [] }) {
    const known = await this.#client.listCategories();
    const idBySlug = new Map(known.map((category) => [category.slug, category.id]));

    const matched = categories.filter((slug) => idBySlug.has(slug));

    const created = await this.#client.createDraft({
      title,
      excerpt,
      content,
      categoryIds: matched.map((slug) => idBySlug.get(slug)),
    });

    return { ...created, categories: matched };
  }

  /**
   * Confere as credenciais de escrita.
   * @returns {Promise<{ id: number, name: string }>}
   */
  async verifyCredentials() {
    return this.#client.verifyCredentials();
  }

  /**
   * Mapa id → nome de categoria. Falha de rede aqui não pode derrubar uma
   * listagem: sem os nomes, o post ainda é útil, só perde os rótulos.
   * @returns {Promise<Map<number, string>>}
   */
  async #namesById() {
    return this.#client
      .listCategories()
      .then((categories) => new Map(categories.map((category) => [category.id, category.name])))
      .catch(() => new Map());
  }
}

/**
 * @param {Object} post
 * @param {Map<number, string>} categories
 */
function toSummary(post, categories) {
  return {
    id: post.id,
    title: stripHtml(post.title?.rendered ?? ''),
    excerpt: stripHtml(post.excerpt?.rendered ?? ''),
    url: post.link ?? '',
    date: String(post.date ?? '').slice(0, 10),
    categories: (post.categories ?? []).map((id) => categories.get(id) ?? String(id)),
  };
}

/**
 * Remove tags e resolve as entidades que o WordPress devolve no `rendered`
 * (`&#8217;`, `&nbsp;`, `&amp;`…). Sem isso, o texto chega ao usuário e ao
 * modelo cheio de `&#8230;` no lugar das reticências.
 * @param {string} html
 * @returns {string}
 */
export function stripHtml(html) {
  const text = String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '');

  return normalizeWhitespace(decodeEntities(text));
}

/**
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  const named = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    hellip: '…',
    mdash: '—',
    ndash: '–',
  };

  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(\w+);/g, (match, name) => named[name] ?? match);
}
