/**
 * Módulo Blog — Formatador de mensagens (Camada de Apresentação).
 *
 * Responsabilidade única: construir strings HTML para o Telegram.
 * Segue as convenções do DESIGN.md. Emoji de categoria: 📰.
 */

import { escapeHtml, pluralize, truncate } from '../../shared/html.utils.js';

const POST_EMOJI = '📰';

export class BlogFormatter {
  /**
   * Lista de publicações encontradas por busca.
   * @param {string} query
   * @param {Array<{ title: string, excerpt: string, url: string, date: string, categories: string[] }>} posts
   * @returns {string} HTML
   */
  formatSearchResults(query, posts) {
    if (posts.length === 0) {
      return (
        `${POST_EMOJI} Procurei por <b>${escapeHtml(query)}</b> no Ciência Embarcada e ainda não ` +
        'existe nada publicado sobre isso.'
      );
    }

    const header =
      `${POST_EMOJI} Achei ${pluralize(posts.length, 'publicação', 'publicações')} sobre ` +
      `<b>${escapeHtml(query)}</b> no Ciência Embarcada:`;

    return [header, ...posts.map((post) => this.#formatItem(post))].join('\n\n');
  }

  /**
   * Lista das publicações mais recentes.
   * @param {Array<{ title: string, excerpt: string, url: string, date: string, categories: string[] }>} posts
   * @returns {string} HTML
   */
  formatLatest(posts) {
    if (posts.length === 0) {
      return `${POST_EMOJI} Não consegui trazer as publicações do blog agora.`;
    }

    const header = `${POST_EMOJI} Essas são as <b>${pluralize(
      posts.length,
      'publicação mais recente',
      'publicações mais recentes'
    )}</b> do Ciência Embarcada:`;

    return [header, ...posts.map((post) => this.#formatItem(post))].join('\n\n');
  }

  /**
   * Mensagem de uso do /blog.
   * @returns {string} HTML
   */
  formatUsage() {
    return (
      `${POST_EMOJI} <b>Me diz o que procurar no blog</b>\n` +
      '<i>└ Ex: <code>/blog LoRaWAN</code> — ou use <code>/ultimos</code> pra ver o que saiu por último</i>'
    );
  }

  /**
   * @param {{ title: string, excerpt: string, url: string, date: string, categories: string[] }} post
   * @returns {string} HTML
   */
  #formatItem({ title, excerpt, url, date, categories }) {
    const lines = [`${POST_EMOJI} <a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`];

    if (excerpt) lines.push(`<i>└ ${escapeHtml(truncate(excerpt, 180))}</i>`);

    const meta = [formatDate(date), categories.join(' · ')].filter(Boolean).join(' · ');
    if (meta) lines.push(`<i>└ <code>${escapeHtml(meta)}</code></i>`);

    return lines.join('\n');
  }
}

/**
 * Converte `2026-02-09` em `09/02/2026`.
 * @param {string} isoDate
 * @returns {string}
 */
function formatDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}
