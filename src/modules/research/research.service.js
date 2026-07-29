/**
 * Módulo Research — Serviço (Camada de Aplicação).
 *
 * Responsabilidade única: orquestrar buscas e leitura de páginas, entregando
 * dados prontos pra serem consumidos tanto pelas tools da IA quanto pelos
 * comandos diretos do Telegram. Não conhece Telegram nem formatação.
 *
 * O texto das páginas é truncado antes de sair daqui: uma página de 40 mil
 * palavras não cabe na janela de contexto do modelo e nem numa mensagem do
 * Telegram — melhor cortar num ponto previsível do que descobrir o limite
 * na forma de um erro de API.
 */

import { truncate } from '../../shared/html.utils.js';

/** Teto de caracteres do conteúdo de uma página entregue ao modelo. */
const MAX_PAGE_CHARS = 12_000;

export class ResearchService {
  /** @type {import('./research.client.js').ResearchClient} */
  #client;

  /**
   * @param {import('./research.client.js').ResearchClient} client
   */
  constructor(client) {
    this.#client = client;
  }

  /**
   * Busca um termo na web.
   * @param {string} query
   * @param {number} [limit]
   * @returns {Promise<Array<{ title: string, url: string, snippet: string }>>}
   */
  async search(query, limit = 8) {
    const term = String(query ?? '').trim();
    if (!term) throw new Error('Termo de busca vazio.');

    return this.#client.search(term, limit);
  }

  /**
   * Consulta o Google Trends por país.
   * @param {string} [geo]
   * @returns {Promise<{ geo: string, trends: Array<{ title: string, traffic: string, news: Array<{ title: string }> }> }>}
   */
  async getGoogleTrends(geo = 'BR') {
    return this.#client.fetchGoogleTrends(geo);
  }

  /**
   * Lê uma página e devolve o conteúdo já truncado.
   * @param {string} url
   * @returns {Promise<{ url: string, title: string, description: string, text: string, truncated: boolean, links: Array<{ text: string, url: string }> }>}
   */
  async readPage(url) {
    const page = await this.#client.fetchPage(url);
    const truncated = page.text.length > MAX_PAGE_CHARS;

    return {
      ...page,
      text: truncated ? truncate(page.text, MAX_PAGE_CHARS) : page.text,
      truncated,
    };
  }
}
