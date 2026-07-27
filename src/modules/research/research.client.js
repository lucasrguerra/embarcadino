/**
 * Módulo Research — Cliente HTTP (Camada de Infraestrutura).
 *
 * Responsabilidade única: falar com a web crua — buscar resultados num motor
 * de busca e baixar o HTML de uma página. Não interpreta nem formata nada
 * pro usuário, e não conhece Telegram.
 *
 * Busca: se `searxngBaseUrl` estiver configurado, usa a API JSON do SearXNG
 * (estável, sem HTML pra quebrar). Sem ela, cai no endpoint HTML do DuckDuckGo,
 * que não exige chave nenhuma — é o padrão pra quem só quer subir o bot e usar.
 * O DuckDuckGo embrulha todo link de resultado num redirecionador
 * (`//duckduckgo.com/l/?uddg=<url codificada>`), então a URL real precisa ser
 * desembrulhada, senão o modelo recebe links que não levam a lugar nenhum.
 */

import * as cheerio from 'cheerio';
import { normalizeWhitespace } from '../../shared/text.utils.js';
import { logger } from '../../shared/logger.js';

/** UA de navegador — vários sites devolvem 403 pro UA padrão do Node. */
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

/** Elementos que nunca contêm o conteúdo principal de um artigo. */
const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'form',
  'header',
  'footer',
  'nav',
  'aside',
  '[class*="comment"]',
  '[id*="comment"]',
  '[class*="social"]',
  '[class*="share"]',
  '[class*="newsletter"]',
  '[class*="cookie"]',
  '[class*="sidebar"]',
  '[role="navigation"]',
  '[aria-hidden="true"]',
].join(', ');

/** Candidatos a container do conteúdo principal, do mais específico ao mais genérico. */
const CONTENT_SELECTORS = ['article', 'main', '[role="main"]', '.post-content', '.entry-content', 'body'];

export class ResearchClient {
  /** @type {string | undefined} */
  #searxngBaseUrl;
  /** @type {number} */
  #maxPageBytes;
  /** @type {number} */
  #timeoutMs;

  /**
   * @param {{ searxngBaseUrl?: string, maxPageBytes: number, timeoutMs: number }} config
   */
  constructor({ searxngBaseUrl, maxPageBytes, timeoutMs }) {
    this.#searxngBaseUrl = searxngBaseUrl;
    this.#maxPageBytes = maxPageBytes;
    this.#timeoutMs = timeoutMs;
  }

  /**
   * Busca na web e devolve os resultados já normalizados.
   * @param {string} query
   * @param {number} [limit]
   * @returns {Promise<Array<{ title: string, url: string, snippet: string }>>}
   */
  async search(query, limit = 8) {
    const results = await this.#searchWithFallback(query);
    return results.filter((result) => result.url).slice(0, limit);
  }

  /**
   * Busca no SearXNG e, se ele estiver fora do ar, no DuckDuckGo.
   *
   * O SearXNG do compose sobe junto com o bot, mas pode estar reiniciando ou
   * com o JSON desabilitado por engano no settings.yml. Nesses casos, cair pro
   * DuckDuckGo é melhor que o assistente responder "não consegui pesquisar" —
   * a degradação fica no log, não na cara do usuário.
   * @param {string} query
   * @returns {Promise<Array<{ title: string, url: string, snippet: string }>>}
   */
  async #searchWithFallback(query) {
    if (!this.#searxngBaseUrl) {
      return this.#searchDuckDuckGo(query);
    }

    try {
      return await this.#searchSearxng(query);
    } catch (err) {
      logger.warn('RESEARCH', 'SearXNG indisponível, caindo para o DuckDuckGo', err);
      return this.#searchDuckDuckGo(query);
    }
  }

  /**
   * Baixa uma página e extrai título, descrição e texto legível.
   * @param {string} url
   * @returns {Promise<{ url: string, title: string, description: string, text: string, links: Array<{ text: string, url: string }> }>}
   */
  async fetchPage(url) {
    const target = normalizeUrl(url);
    const response = await this.#request(target, { Accept: 'text/html,application/xhtml+xml' });

    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml|text\/plain/.test(contentType)) {
      throw new Error(`Conteúdo não é uma página de texto (content-type: ${contentType || 'desconhecido'}).`);
    }

    const html = await this.#readLimited(response);
    return this.#extractContent(target, html);
  }

  /**
   * @param {string} query
   * @returns {Promise<Array<{ title: string, url: string, snippet: string }>>}
   */
  async #searchSearxng(query) {
    const params = new URLSearchParams({ q: query, format: 'json', language: 'pt-BR' });
    const response = await this.#request(`${this.#searxngBaseUrl}/search?${params}`, {
      Accept: 'application/json',
    });
    const data = await response.json();

    return (data.results ?? []).map((item) => ({
      title: String(item.title ?? '').trim(),
      url: String(item.url ?? '').trim(),
      snippet: normalizeWhitespace(item.content ?? ''),
    }));
  }

  /**
   * @param {string} query
   * @returns {Promise<Array<{ title: string, url: string, snippet: string }>>}
   */
  async #searchDuckDuckGo(query) {
    const params = new URLSearchParams({ q: query, kl: 'br-pt' });
    const response = await this.#request(`https://html.duckduckgo.com/html/?${params}`, {
      Accept: 'text/html',
    });
    const $ = cheerio.load(await this.#readLimited(response));

    // `.result--ad` são anúncios. Eles vêm primeiro na página e apontam para o
    // rastreador do próprio DuckDuckGo (`/y.js?ad_domain=…`), então sem esse
    // filtro o modelo receberia um link de anúncio como se fosse fonte técnica.
    return $('.result:not(.result--ad)')
      .toArray()
      .map((element) => {
        const result = $(element);
        const anchor = result.find('a.result__a').first();

        return {
          title: normalizeWhitespace(anchor.text()),
          url: unwrapDuckDuckGoUrl(anchor.attr('href') ?? ''),
          snippet: normalizeWhitespace(result.find('.result__snippet').first().text()),
        };
      })
      .filter((result) => result.title && !isDuckDuckGoAd(result.url));
  }

  /**
   * Extrai o conteúdo legível de um documento HTML.
   * @param {string} url
   * @param {string} html
   * @returns {{ url: string, title: string, description: string, text: string, links: Array<{ text: string, url: string }> }}
   */
  #extractContent(url, html) {
    const $ = cheerio.load(html);

    const title = normalizeWhitespace($('meta[property="og:title"]').attr('content') || $('title').text());
    const description = normalizeWhitespace(
      $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || ''
    );

    // Coletados antes da limpeza: a navegação some junto com o ruído, mas os
    // links do corpo do texto são justamente as fontes que interessam citar.
    const links = this.#extractLinks($, url);

    $(NOISE_SELECTORS).remove();

    // `\n` entre blocos: sem isso o cheerio cola o fim de um parágrafo no começo
    // do próximo ("...da rede.O protocolo..."), o que atrapalha o modelo a ler.
    $('p, br, div, li, h1, h2, h3, h4, h5, h6, tr').after('\n');

    const container = CONTENT_SELECTORS.map((selector) => $(selector).first()).find(
      (element) => element.length > 0
    );

    return {
      url,
      title,
      description,
      text: normalizeWhitespace(container?.text() ?? ''),
      links,
    };
  }

  /**
   * @param {import('cheerio').CheerioAPI} $
   * @param {string} baseUrl
   * @returns {Array<{ text: string, url: string }>}
   */
  #extractLinks($, baseUrl) {
    const seen = new Set();
    const links = [];

    for (const element of $('article a[href], main a[href], .entry-content a[href]').toArray()) {
      const anchor = $(element);
      const href = anchor.attr('href') ?? '';
      if (!/^https?:\/\//i.test(href) && !href.startsWith('/')) continue;

      const absolute = new URL(href, baseUrl).toString();
      if (seen.has(absolute)) continue;
      seen.add(absolute);

      links.push({ text: normalizeWhitespace(anchor.text()), url: absolute });
      if (links.length >= 20) break;
    }

    return links;
  }

  /**
   * Requisição HTTP com timeout e cabeçalhos de navegador.
   * @param {string} url
   * @param {Record<string, string>} [headers]
   * @returns {Promise<Response>}
   */
  async #request(url, headers = {}) {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(this.#timeoutMs),
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        ...headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Requisição para ${url} falhou com status ${response.status}.`);
    }

    return response;
  }

  /**
   * Lê o corpo da resposta respeitando o teto de bytes configurado — evita que
   * uma página gigante (ou um arquivo servido como HTML) estoure a memória.
   * @param {Response} response
   * @returns {Promise<string>}
   */
  async #readLimited(response) {
    const decoder = new TextDecoder('utf-8');
    let read = 0;
    let text = '';

    for await (const chunk of response.body) {
      read += chunk.length;
      text += decoder.decode(chunk, { stream: true });
      if (read >= this.#maxPageBytes) break;
    }

    return text + decoder.decode();
  }
}

/**
 * Aceita "exemplo.com" além de URLs completas — usuário raramente digita o https://.
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  const value = String(url ?? '').trim();
  if (!value) throw new Error('URL vazia.');

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  try {
    return new URL(withScheme).toString();
  } catch {
    throw new Error(`URL inválida: ${value}`);
  }
}

/**
 * Um resultado que continua apontando para o próprio DuckDuckGo depois de
 * desembrulhado é anúncio ou redirecionamento interno — nunca uma fonte.
 * @param {string} url
 * @returns {boolean}
 */
export function isDuckDuckGoAd(url) {
  try {
    return new URL(url).hostname.endsWith('duckduckgo.com');
  } catch {
    return true;
  }
}

/**
 * Extrai a URL real de dentro do redirecionador do DuckDuckGo.
 * @param {string} href
 * @returns {string}
 */
export function unwrapDuckDuckGoUrl(href) {
  if (!href) return '';

  const absolute = href.startsWith('//') ? `https:${href}` : href;

  try {
    const parsed = new URL(absolute, 'https://duckduckgo.com');
    return parsed.searchParams.get('uddg') ?? parsed.toString();
  } catch {
    return '';
  }
}
