/**
 * Módulo Knowledge — Formatador de mensagens (Camada de Apresentação).
 *
 * Responsabilidade única: construir strings HTML para o Telegram.
 * Segue as convenções do DESIGN.md — cada projeto traz seu próprio emoji de
 * categoria, declarado junto com os dados em knowledge.data.js.
 */

import { escapeHtml } from '../../shared/html.utils.js';

export class KnowledgeFormatter {
  /**
   * Ficha completa de um projeto.
   * @param {import('./knowledge.data.js').KnowledgeEntry} entry
   * @returns {string} HTML
   */
  formatEntry({ emoji, name, tagline, url, highlights, audience }) {
    const lines = [
      `${emoji} <b>${escapeHtml(name)}</b>`,
      `<i>└ ${escapeHtml(tagline)}</i>`,
      '',
      ...highlights.map((highlight) => `• ${escapeHtml(highlight)}`),
    ];

    if (audience.length > 0) {
      lines.push('', `<b>Pra quem serve:</b>`, ...audience.map((who) => `• ${escapeHtml(who)}`));
    }

    lines.push('', `🔗 <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);

    return lines.join('\n');
  }

  /**
   * Panorama de tudo que o Ciência Embarcada oferece.
   * @param {import('./knowledge.data.js').KnowledgeEntry[]} entries
   * @returns {string} HTML
   */
  formatOverview(entries) {
    const header = '🧠 O <b>Ciência Embarcada</b> é feito de três frentes:';

    const items = entries.map(
      ({ emoji, name, tagline, url }) =>
        `${emoji} <a href="${escapeHtml(url)}">${escapeHtml(name)}</a>\n<i>└ ${escapeHtml(tagline)}</i>`
    );

    return [header, ...items, '<i>Quer detalhe de algum? Manda /inbraille, /espdocs ou pergunta direto.</i>'].join(
      '\n\n'
    );
  }

  /**
   * Quando o termo pedido não corresponde a nenhum projeto conhecido.
   * @param {string} term
   * @returns {string} HTML
   */
  formatNotFound(term) {
    return (
      `🤔 Não conheço nenhum projeto chamado <b>${escapeHtml(term)}</b>.\n` +
      '<i>└ Manda /servicos pra ver o que existe por aqui</i>'
    );
  }
}
