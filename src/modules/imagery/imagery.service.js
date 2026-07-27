/**
 * Módulo Imagery — Serviço (Camada de Aplicação).
 *
 * Responsabilidade única: preencher os blocos de imagem do rascunho — gerar a
 * arte a partir do `alt` escrito pelo redator, subir para a biblioteca de mídia
 * do WordPress e apontar o `src` para a URL resultante.
 *
 * Por que subir em vez de embutir: o rascunho vai para o editor do WordPress, e
 * imagem em data URL dentro do conteúdo não vira anexo, não gera miniatura, não
 * pode ser destacada e incha o post em megabytes. A biblioteca de mídia é o
 * lugar da imagem.
 *
 * Nada aqui é obrigatório para o rascunho existir. Se a geração ou o upload
 * falhar, o bloco fica com o `src` vazio e o `alt` preservado — exatamente o
 * que o Lucas recebia antes — e o post segue. Perder minutos de pesquisa e
 * redação por causa de uma ilustração seria o pior desfecho.
 */

import { logger } from '../../shared/logger.js';
import { buildImagePrompt } from './imagery.prompt.js';

/**
 * Teto de imagens por post. Cada uma é uma chamada cara ao modelo mais um
 * upload; acima disso o /post demora demais para o ganho que entrega.
 */
const MAX_IMAGES = 4;

/** Casa um bloco wp:image inteiro, do comentário de abertura ao de fechamento. */
const IMAGE_BLOCK = /<!--\s*wp:image(?<attrs>[\s\S]*?)-->(?<inner>[\s\S]*?)<!--\s*\/wp:image\s*-->/g;

export class ImageryService {
  /** @type {import('./imagery.client.js').ImageryClient} */
  #client;
  /** @type {import('../blog/blog.service.js').BlogService} */
  #blog;

  /**
   * @param {import('./imagery.client.js').ImageryClient} client
   * @param {import('../blog/blog.service.js').BlogService} blog
   */
  constructor(client, blog) {
    this.#client = client;
    this.#blog = blog;
  }

  /** @returns {boolean} Se dá pra ilustrar (precisa poder subir a mídia). */
  get canIllustrate() {
    return this.#blog.canWrite;
  }

  /**
   * Gera e insere as imagens do rascunho.
   * @param {{ title: string, content: string }} draft
   * @returns {Promise<{ content: string, images: Array<{ id: number, url: string, alt: string }>, failed: number }>}
   */
  async illustrate({ title, content }) {
    const blocks = [...String(content ?? '').matchAll(IMAGE_BLOCK)];
    const pending = blocks.filter((block) => needsImage(block.groups.inner)).slice(0, MAX_IMAGES);

    if (pending.length === 0) {
      return { content, images: [], failed: 0 };
    }

    if (!this.canIllustrate) {
      logger.info('IMAGERY', 'Sem credencial de mídia do WordPress, os blocos ficam sem imagem.');
      return { content, images: [], failed: 0 };
    }

    logger.info('IMAGERY', `Gerando ${pending.length} imagem(ns) para "${title}".`);

    // Em série de propósito: o provedor limita geração de imagem por minuto com
    // folga menor que a de texto, e disparar 4 de uma vez costuma render 429.
    const replacements = new Map();
    const images = [];
    let failed = 0;

    for (const [position, block] of pending.entries()) {
      const alt = altOf(block.groups.inner) || title;

      try {
        const media = await this.#produce({ alt, title, position });
        replacements.set(block[0], renderBlock(block, media, alt));
        images.push({ ...media, alt });
      } catch (err) {
        failed++;
        logger.warn('IMAGERY', `Falha ao ilustrar "${alt.slice(0, 60)}"`, err);
      }
    }

    let updated = content;
    for (const [original, replacement] of replacements) {
      updated = updated.replace(original, () => replacement);
    }

    return { content: updated, images, failed };
  }

  /**
   * Gera a imagem e sobe para a biblioteca de mídia.
   * @param {{ alt: string, title: string, position: number }} briefing
   * @returns {Promise<{ id: number, url: string }>}
   */
  async #produce({ alt, title, position }) {
    const { data, mimeType } = await this.#client.generate(buildImagePrompt({ alt, title, position }));

    return this.#blog.uploadImage({
      data,
      mimeType,
      filename: fileNameFor(title, position, mimeType),
      alt,
    });
  }
}

/**
 * Só entram blocos com `src` vazio: se o rascunho já trouxe uma URL, ela veio
 * de uma fonte que o redator citou e não é nossa para substituir.
 * @param {string} inner
 * @returns {boolean}
 */
export function needsImage(inner) {
  return /<img\b[^>]*>/i.test(inner) && /src=""/.test(inner);
}

/**
 * @param {string} inner
 * @returns {string}
 */
export function altOf(inner) {
  return /alt="([^"]*)"/i.exec(String(inner ?? ''))?.[1]?.trim() ?? '';
}

/**
 * Reescreve o bloco com a URL e o id do anexo. O id entra no comentário do
 * bloco e como classe `wp-image-N` — é o que o editor usa para reconhecer o
 * anexo e oferecer os tamanhos alternativos.
 * @param {{ 0: string, groups: { attrs: string, inner: string } }} block
 * @param {{ id: number, url: string }} media
 * @param {string} alt
 * @returns {string}
 */
export function renderBlock(block, media, alt) {
  const attrs = mergeAttrs(block.groups.attrs, media.id);

  const inner = block.groups.inner
    .replace(/src=""/, `src="${escapeAttr(media.url)}"`)
    .replace(/<img\b/i, `<img class="wp-image-${media.id}"`)
    .replace(/alt="[^"]*"/i, `alt="${escapeAttr(alt)}"`);

  return `<!-- wp:image${attrs}-->${inner}<!-- /wp:image -->`;
}

/**
 * Injeta o id no JSON de atributos do bloco, preservando o que já estava lá
 * (alinhamento, por exemplo). Atributo malformado é substituído em vez de
 * quebrar o bloco no editor.
 * @param {string} attrs
 * @param {number} id
 * @returns {string}
 */
function mergeAttrs(attrs, id) {
  const json = /\{[\s\S]*\}/.exec(attrs ?? '')?.[0];

  if (!json) return ` {"id":${id},"sizeSlug":"large"} `;

  try {
    return ` ${JSON.stringify({ ...JSON.parse(json), id, sizeSlug: 'large' })} `;
  } catch {
    return ` {"id":${id},"sizeSlug":"large"} `;
  }
}

/**
 * @param {string} title
 * @param {number} position
 * @param {string} mimeType
 * @returns {string}
 */
export function fileNameFor(title, position, mimeType) {
  const slug =
    String(title ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'imagem';

  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mimeType] ?? 'png';

  return `${slug}-${position + 1}.${extension}`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeAttr(value) {
  return String(value ?? '').replace(/"/g, '&quot;');
}
