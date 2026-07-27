/**
 * Sanitização de HTML gerado pelo modelo (Camada de Apresentação).
 *
 * Responsabilidade única: transformar a resposta crua do modelo num HTML que
 * o Telegram aceita com segurança. Modelos pequenos/gratuitos não seguem o
 * system prompt à risca — na prática aparecem markdown solto (`**negrito**`)
 * e tags truncadas (`<cod`, sem fechar). O Telegram rejeita a mensagem INTEIRA
 * se encontrar uma tag inválida, então este módulo garante que o texto enviado
 * sempre é aceito, nunca conta com o modelo ter formatado certo.
 */

/** Casa uma tag de abertura/fechamento válida (com atributo href opcional no `<a>`). */
const TAG_PATTERN = /<(\/?)(b|i|u|s|code|pre|a)(\s+href="[^"]*")?\s*>/gi;

/**
 * Escapa `&`, `<` e `>` soltos num trecho que não faz parte de nenhuma tag reconhecida.
 * @param {string} segment
 * @returns {string}
 */
function escapeStray(segment) {
  return segment.replace(/&(?!amp;|lt;|gt;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Converte marcações markdown comuns (que o modelo às vezes usa por engano)
 * para as tags HTML equivalentes do Telegram.
 * @param {string} text
 * @returns {string}
 */
function convertMarkdown(text) {
  return text
    .replace(/```(?:\w+)?\n([\s\S]*?)```/g, '<pre>$1</pre>')
    .replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
    .replace(/__(.+?)__/gs, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
}

/**
 * Mantém apenas as tags da whitelist; qualquer outra coisa que pareça HTML
 * (inclusive tags truncadas/desconhecidas) é escapada como texto literal.
 * @param {string} text
 * @returns {string}
 */
function keepOnlyAllowedTags(text) {
  let result = '';
  let lastIndex = 0;

  for (const match of text.matchAll(TAG_PATTERN)) {
    result += escapeStray(text.slice(lastIndex, match.index)) + match[0];
    lastIndex = match.index + match[0].length;
  }
  result += escapeStray(text.slice(lastIndex));

  return result;
}

/**
 * Verifica se as tags estão corretamente abertas/fechadas e aninhadas.
 * @param {string} html
 * @returns {boolean}
 */
function hasBalancedTags(html) {
  const stack = [];

  for (const match of html.matchAll(TAG_PATTERN)) {
    const isClosing = match[1] === '/';
    const tag = match[2].toLowerCase();

    if (!isClosing) {
      stack.push(tag);
    } else if (stack.pop() !== tag) {
      return false;
    }
  }

  return stack.length === 0;
}

/**
 * Remove toda tag HTML reconhecida, deixando só o texto — usado como
 * fallback quando o HTML gerado não fecha corretamente.
 * @param {string} html
 * @returns {string}
 */
function stripTags(html) {
  return html.replace(TAG_PATTERN, '');
}

/**
 * Sanitiza a resposta do modelo para envio seguro com `parse_mode: 'HTML'`.
 * Nunca lança — na pior hipótese devolve texto sem formatação nenhuma.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeForTelegramHtml(text) {
  const withHtml = convertMarkdown(String(text ?? ''));
  const sanitized = keepOnlyAllowedTags(withHtml);
  return hasBalancedTags(sanitized) ? sanitized : stripTags(sanitized);
}
