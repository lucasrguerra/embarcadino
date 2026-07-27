/**
 * Utilitários de formatação HTML para mensagens do Telegram (parse_mode: HTML).
 * Apenas &, < e > precisam ser escapados neste contexto.
 */

/**
 * Escapa caracteres especiais HTML em texto dinâmico (vindo de APIs ou usuário).
 * Todo texto interpolado em mensagens HTML deve passar por esta função.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Formata um número com plural correto em português.
 * @param {number} count
 * @param {string} singular - Ex: 'publicação'
 * @param {string} [plural]  - Ex: 'publicações' (se omitido, adiciona 's')
 * @returns {string}
 */
export function pluralize(count, singular, plural) {
  const label = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count} ${label}`;
}

/**
 * Corta um texto num limite de caracteres, sem quebrar palavra no meio.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function truncate(text, maxLength) {
  const value = String(text ?? '').trim();
  if (value.length <= maxLength) return value;

  const cut = value.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
