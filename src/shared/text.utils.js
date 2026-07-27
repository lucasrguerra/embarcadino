/**
 * Utilitários de texto — quebra de mensagens longas para o limite do Telegram.
 *
 * O Telegram rejeita mensagens acima de 4096 caracteres. Como boa parte do que
 * o bot envia é texto gerado (respostas da IA, conteúdo de páginas), a quebra
 * precisa preferir fronteiras naturais — parágrafo, depois linha, depois palavra —
 * pra não cortar uma frase no meio nem partir uma tag HTML ao meio.
 */

/** Limite duro de caracteres por mensagem imposto pela API do Telegram. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Limite usado quando o texto ainda vai crescer depois da quebra — escapar
 * `&` vira `&amp;` e `**x**` vira `<b>x</b>`, então um pedaço de exatamente
 * 4096 caracteres passaria do limite ao ser formatado.
 */
export const TELEGRAM_SAFE_CHUNK = 3500;

/**
 * Quebra um texto em pedaços que cabem no limite de mensagem, respeitando
 * fronteiras de parágrafo sempre que possível.
 * @param {string} text
 * @param {number} [chunkSize]
 * @returns {string[]} Sempre pelo menos um elemento (vazio vira `['']`).
 */
export function splitIntoChunks(text, chunkSize = TELEGRAM_MESSAGE_LIMIT) {
  const value = String(text ?? '');
  if (value.length <= chunkSize) return [value];

  const chunks = [];
  let current = '';

  for (const paragraph of value.split('\n\n')) {
    for (const piece of splitOversized(paragraph, chunkSize)) {
      const candidate = current ? `${current}\n\n${piece}` : piece;

      if (candidate.length <= chunkSize) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        current = piece;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [''];
}

/**
 * Quebra um bloco maior que o limite — por linha, e em último caso na força bruta.
 * @param {string} block
 * @param {number} chunkSize
 * @returns {string[]}
 */
function splitOversized(block, chunkSize) {
  if (block.length <= chunkSize) return [block];

  const pieces = [];
  let current = '';

  for (const line of block.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length <= chunkSize) {
      current = candidate;
      continue;
    }

    if (current) pieces.push(current);

    // Linha única maior que o limite (ex: log sem quebra): corta na marra.
    let rest = line;
    while (rest.length > chunkSize) {
      pieces.push(rest.slice(0, chunkSize));
      rest = rest.slice(chunkSize);
    }
    current = rest;
  }

  if (current) pieces.push(current);
  return pieces;
}

/**
 * Normaliza espaços em branco de um texto extraído de HTML.
 * @param {string} text
 * @returns {string}
 */
export function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}
