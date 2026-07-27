/**
 * Módulo Research — Formatador de mensagens (Camada de Apresentação).
 *
 * Responsabilidade única: construir strings HTML para o Telegram.
 * Segue as convenções do DESIGN.md. Emoji de categoria: 🔎 (busca) e 🌐 (página).
 */

import { escapeHtml, pluralize, truncate } from '../../shared/html.utils.js';

const SEARCH_EMOJI = '🔎';
const PAGE_EMOJI = '🌐';

export class ResearchFormatter {
  /**
   * Lista de resultados de busca.
   * @param {string} query
   * @param {Array<{ title: string, url: string, snippet: string }>} results
   * @returns {string} HTML
   */
  formatResults(query, results) {
    if (results.length === 0) {
      return `${SEARCH_EMOJI} Procurei por <b>${escapeHtml(query)}</b> e não achei nada relevante.`;
    }

    const header =
      `${SEARCH_EMOJI} Achei ${pluralize(results.length, 'resultado')} pra ` +
      `<b>${escapeHtml(query)}</b>:`;

    const items = results.map((result) => {
      const title = `${SEARCH_EMOJI} <a href="${escapeHtml(result.url)}">${escapeHtml(
        truncate(result.title, 80)
      )}</a>`;
      return result.snippet
        ? `${title}\n<i>└ ${escapeHtml(truncate(result.snippet, 200))}</i>`
        : title;
    });

    return [header, ...items].join('\n\n');
  }

  /**
   * Cabeçalho do conteúdo de uma página lida.
   * @param {{ url: string, title: string, truncated: boolean }} page
   * @returns {string} HTML
   */
  formatPageHeader({ url, title, truncated }) {
    const heading = `${PAGE_EMOJI} <b>${escapeHtml(title || 'Página sem título')}</b>\n<i>└ <a href="${escapeHtml(url)}">${escapeHtml(
      new URL(url).hostname
    )}</a></i>`;

    return truncated ? `${heading}\n<i>└ Conteúdo longo — mandei só o começo</i>` : heading;
  }

  /**
   * Mensagem de uso do /pesquisar.
   * @returns {string} HTML
   */
  formatSearchUsage() {
    return (
      `${SEARCH_EMOJI} <b>Me diz o que você quer pesquisar</b>\n` +
      '<i>└ Ex: <code>/pesquisar ESP32-C6 Matter Thread</code></i>'
    );
  }

  /**
   * Mensagem de uso do /pagina.
   * @returns {string} HTML
   */
  formatPageUsage() {
    return (
      `${PAGE_EMOJI} <b>Me manda o link da página</b>\n` +
      '<i>└ Ex: <code>/pagina https://espdocs.cienciaembarcada.com.br</code></i>'
    );
  }

  /**
   * Erro ao ler uma página.
   * @param {string} url
   * @returns {string} HTML
   */
  formatPageError(url) {
    return (
      `⚠️ <b>Não consegui ler essa página</b>\n` +
      `<i>└ O site <code>${escapeHtml(url)}</code> pode estar fora do ar ou bloqueando leitura automática</i>`
    );
  }
}
