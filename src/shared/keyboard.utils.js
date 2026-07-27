/**
 * Utilitários de teclado inline para o Telegram.
 * Centraliza a criação de layouts de botões, garantindo consistência visual.
 */

import { Markup } from 'telegraf';

/** Número máximo de botões por linha (definido no DESIGN.md). */
const BUTTONS_PER_ROW = 2;

/**
 * Divide um array em sub-arrays de tamanho `size`.
 * @template T
 * @param {T[]} arr
 * @param {number} [size=BUTTONS_PER_ROW]
 * @returns {T[][]}
 */
export function chunkArray(arr, size = BUTTONS_PER_ROW) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Cria um teclado inline a partir de uma lista de itens.
 * @param {Array<{ label: string, data: string }>} items
 * @param {number} [perRow]
 * @returns {ReturnType<typeof Markup.inlineKeyboard>}
 */
export function buildInlineKeyboard(items, perRow = BUTTONS_PER_ROW) {
  const buttons = items.map(({ label, data }) => Markup.button.callback(label, data));
  return Markup.inlineKeyboard(chunkArray(buttons, perRow));
}

/**
 * Cria um teclado inline de links externos (botões que abrem URLs).
 * @param {Array<{ label: string, url: string }>} items
 * @returns {ReturnType<typeof Markup.inlineKeyboard>}
 */
export function buildLinkKeyboard(items) {
  const buttons = items.map(({ label, url }) => Markup.button.url(label, url));
  return Markup.inlineKeyboard(chunkArray(buttons, 1));
}
