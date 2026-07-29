/**
 * Módulo Writer — Formatador de mensagens (Camada de Apresentação).
 *
 * Responsabilidade única: construir as mensagens do Telegram e o arquivo do
 * rascunho. Emoji de categoria: ✍️.
 */

import { escapeHtml, pluralize } from '../../shared/html.utils.js';

const WRITER_EMOJI = '✍️';

export class WriterFormatter {
  /**
   * Ficha do rascunho pronto.
   * @param {{ title: string, excerpt: string, categories: string[], words: number, seo?: Array<{ message: string }> }} draft
   * @param {{ editLink: string } | null} [published] - Rascunho criado no WordPress, se houve
   * @returns {string} HTML
   */
  formatSummary({ title, excerpt, categories, words, seo = [] }, published = null) {
    const lines = [
      `${WRITER_EMOJI} <b>${escapeHtml(title)}</b>`,
      `<i>└ ${escapeHtml(excerpt)}</i>`,
      '',
      `<i>└ ${pluralize(words, 'palavra')}</i>`,
    ];

    if (categories.length > 0) {
      lines.push(`<i>└ <code>${escapeHtml(categories.join(' · '))}</code></i>`);
    }

    // O que a auditoria não conseguiu corrigir sozinha vira aviso: melhor o
    // Lucas saber o que o plugin vai apontar antes de abrir o editor.
    lines.push(
      seo.length === 0
        ? '<i>└ SEO e legibilidade: sem pendências ✅</i>'
        : `<i>└ SEO e legibilidade: ${pluralize(seo.length, 'pendência', 'pendências')}</i>\n` +
            seo.map(({ message }) => `   <i>· ${escapeHtml(message)}</i>`).join('\n')
    );

    lines.push(
      '',
      published
        ? `📝 <b>Rascunho criado no WordPress</b>\n<i>└ <a href="${escapeHtml(
            published.editLink
          )}">Abrir no editor</a> — não publiquei nada, só salvei como rascunho</i>`
        : '<i>O conteúdo vai no arquivo em blocos do Gutenberg — é só colar no editor.</i>'
    );

    return lines.join('\n');
  }

  /**
   * Aviso de que o rascunho ficou pronto mas não subiu pro blog.
   * O texto não se perde: ele vai no arquivo anexado logo em seguida.
   * @param {boolean} configured - Se havia credencial configurada
   * @returns {string} HTML
   */
  formatDraftNotSaved(configured) {
    return configured
      ? '⚠️ <b>Escrevi, mas não consegui salvar o rascunho no WordPress</b>\n' +
          '<i>└ Confere a Senha de Aplicação; o texto está no arquivo abaixo, sem perda</i>'
      : '<i>└ Sem credencial do WordPress configurada, então mandei só o arquivo.</i>';
  }

  /**
   * Legenda do arquivo enviado.
   * @returns {string} HTML
   */
  formatFileCaption() {
    return `${WRITER_EMOJI} <i>Rascunho em blocos do WordPress — revise antes de publicar</i>`;
  }

  /**
   * Mensagem de uso do /post.
   * @returns {string} HTML
   */
  formatUsage() {
    return (
      `${WRITER_EMOJI} <b>Me diz sobre o que escrever</b>\n` +
      '<i>└ Ex: <code>/post ESP32-C6 e o protocolo Matter</code></i>\n' +
      '<i>└ Dá pra passar uma referência e observações: <code>/post tema | https://fonte.com | foca no consumo de energia</code></i>'
    );
  }

  /**
   * Aviso de que a redação começou — ela demora minutos.
   * @param {string} theme
   * @returns {string} HTML
   */
  formatStarted(theme) {
    return (
      `${WRITER_EMOJI} Beleza, vou pesquisar e escrever sobre <b>${escapeHtml(theme)}</b>.\n` +
      '<i>└ Isso leva alguns minutos — te aviso quando o rascunho estiver pronto</i>'
    );
  }

  /**
   * Falha na redação.
   * @returns {string} HTML
   */
  formatError() {
    return (
      `⚠️ <b>Não consegui fechar esse rascunho</b>\n` +
      '<i>└ Tenta de novo, de preferência com o tema mais delimitado</i>'
    );
  }

  /**
   * Mensagem inicial ao pedir sugestões de temas.
   * @param {string} [focus]
   * @returns {string} HTML
   */
  formatTopicsStarted(focus) {
    const detail = focus ? ` com foco em <b>${escapeHtml(focus)}</b>` : '';
    return (
      `💡 Analisando tendências e o histórico do blog${detail}...\n` +
      '<i>└ Isso leva alguns segundos enquanto pesquiso o que está em alta</i>'
    );
  }

  /**
   * Formata a lista de temas sugeridos para o Telegram.
   * @param {Array<{ title: string, categories: string[], trend: string, angle: string }>} topics
   * @param {string} [focus]
   * @returns {string} HTML
   */
  formatTopicsSummary(topics, focus) {
    if (!topics || topics.length === 0) {
      return (
        '💡 <b>Não encontrei sugestões de temas no momento.</b>\n' +
        '<i>└ Tenta refinar a pesquisa ou mudar o foco.</i>'
      );
    }

    if (topics.length === 1 && !topics[0].trend && topics[0].title === 'Sugestões de temas') {
      return `💡 <b>Ideias de publicações sugeridas:</b>\n\n${escapeHtml(topics[0].angle)}`;
    }

    const header = focus
      ? `💡 <b>Sugestões de temas para o blog</b> (foco: <i>${escapeHtml(focus)}</i>)\n` +
        '<i>└ Baseado em tendências atuais e no perfil do Ciência Embarcada:</i>'
      : '💡 <b>Sugestões de temas para o blog</b>\n' +
        '<i>└ Baseado em tendências atuais e no perfil do Ciência Embarcada:</i>';

    const items = topics.map((item, index) => {
      const lines = [`<b>${index + 1}. ${escapeHtml(item.title)}</b>`];

      if (item.categories?.length > 0) {
        lines.push(`<i>└ Categorias: <code>${escapeHtml(item.categories.join(' · '))}</code></i>`);
      }

      if (item.trend) {
        lines.push(`<b>🔥 Tendência:</b> ${escapeHtml(item.trend)}`);
      }

      if (item.angle) {
        lines.push(`<b>🎯 Enfoque:</b> ${escapeHtml(item.angle)}`);
      }

      lines.push(`<code>/post ${escapeHtml(item.title)}</code>`);

      return lines.join('\n');
    });

    return [header, ...items].join('\n\n');
  }

  /**
   * Mensagem de uso do /temas.
   * @returns {string} HTML
   */
  formatTopicsUsage() {
    return (
      `💡 <b>Como pedir sugestões de temas:</b>\n` +
      '<i>└ <code>/temas</code> — analisa tendências gerais em IoT, embarcados, redes e segurança</i>\n' +
      '<i>└ <code>/temas esp32</code> — busca tendências com foco num assunto específico</i>'
    );
  }

  /**
   * Nome do arquivo enviado, derivado do título.
   * @param {string} title
   * @returns {string}
   */
  fileName(title) {
    const slug =
      String(title ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'rascunho';

    return `${slug}.html`;
  }

  /**
   * Conteúdo do arquivo: cabeçalho com os metadados em comentário + blocos.
   * O comentário mantém título, resumo e categorias junto do conteúdo, pra que
   * o arquivo continue completo depois de sair do Telegram.
   * @param {{ title: string, excerpt: string, categories: string[] }} draft
   * @returns {string}
   */
  fileContent({ title, excerpt, categories, content }) {
    return [
      '<!--',
      `Título: ${title}`,
      `Resumo: ${excerpt}`,
      `Categorias: ${categories.join(', ')}`,
      'Rascunho gerado pelo Embarcadino — revisar antes de publicar.',
      '-->',
      '',
      content,
      '',
    ].join('\n');
  }
}
