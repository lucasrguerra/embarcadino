/**
 * Módulo Imagery — Cliente de geração de imagem (Camada de Infraestrutura).
 *
 * Responsabilidade única: pedir uma imagem ao modelo e devolver os bytes.
 *
 * Modelo de imagem do Gemini responde no MESMO endpoint de chat completion; o
 * que muda é pedir a modalidade de imagem na saída. Por isso reaproveitamos o
 * AiClient inteiro em vez de abrir outro cliente HTTP: retry de 429, erro
 * tipado de cota e de credencial já estão resolvidos lá, e geração de imagem
 * esbarra nesses limites com a mesma frequência que a redação.
 *
 * A resposta vem em `message.images[].image_url.url` como data URL base64 —
 * formato do OpenRouter para saída multimodal. Alguns provedores devolvem o
 * mesmo dado dentro de `content`, como parte de tipo `image_url`; os dois
 * caminhos são aceitos aqui.
 */

import { logger } from '../../shared/logger.js';

/** Gerar imagem é mais lento que responder texto curto. */
const TIMEOUT_MS = 120_000;

/** Tipos que o WordPress aceita sem plugin e que o modelo costuma devolver. */
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export class ImageryClient {
  /** @type {import('../ai/ai.client.js').AiClient} */
  #client;
  /** @type {string} */
  #model;

  /**
   * @param {import('../ai/ai.client.js').AiClient} client
   * @param {{ model: string }} options
   */
  constructor(client, { model }) {
    this.#client = client;
    this.#model = model;
  }

  /**
   * Gera uma imagem a partir de uma descrição.
   * @param {string} prompt
   * @returns {Promise<{ data: Buffer, mimeType: string }>}
   * @throws {Error} quando o modelo responde sem imagem
   */
  async generate(prompt) {
    const { message } = await this.#client.chat([{ role: 'user', content: prompt }], {
      model: this.#model,
      modalities: ['image', 'text'],
      timeout: TIMEOUT_MS,
    });

    const dataUrl = findImageUrl(message);
    if (!dataUrl) {
      throw new Error('O modelo de imagem respondeu sem imagem.');
    }

    const image = decodeDataUrl(dataUrl);
    logger.info('IMAGERY', `Imagem gerada: ${image.mimeType}, ${Math.round(image.data.length / 1024)} KB.`);

    return image;
  }
}

/**
 * @param {Object} message
 * @returns {string | null}
 */
export function findImageUrl(message) {
  const fromImages = message?.images?.[0]?.image_url?.url ?? message?.images?.[0]?.url;
  if (typeof fromImages === 'string') return fromImages;

  const parts = Array.isArray(message?.content) ? message.content : [];
  for (const part of parts) {
    const url = part?.image_url?.url ?? (part?.type === 'image_url' ? part.image_url : null);
    if (typeof url === 'string') return url;
  }

  return null;
}

/**
 * @param {string} dataUrl
 * @returns {{ data: Buffer, mimeType: string }}
 */
export function decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl ?? ''));
  if (!match) {
    throw new Error('A imagem não veio como data URL base64.');
  }

  const [, mimeType, base64] = match;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Formato de imagem não suportado: ${mimeType}`);
  }

  const data = Buffer.from(base64, 'base64');
  if (data.length === 0) {
    throw new Error('A imagem veio vazia.');
  }

  return { data, mimeType };
}
