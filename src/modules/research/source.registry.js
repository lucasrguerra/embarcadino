/**
 * Módulo Research — Registro de fontes (Camada de Aplicação).
 *
 * Responsabilidade única: lembrar quais URLs apareceram numa busca e quais
 * foram efetivamente abertas e lidas durante uma redação.
 *
 * Existe por um motivo concreto: o modelo cita referência que nunca leu. Ele
 * monta a seção "Referências" com endereços plausíveis — o domínio existe, o
 * caminho parece certo — e o leitor clica num 404. Auditar o texto contra este
 * registro é a única forma de garantir que cada referência é uma página real
 * que passou pelo read_page.
 *
 * A comparação é por host + caminho, ignorando esquema, "www.", query, âncora e
 * barra final: a mesma página costuma aparecer com variações irrelevantes entre
 * o resultado da busca, o redirecionamento e o link escrito no texto.
 */

export class SourceRegistry {
  /** @type {Map<string, string>} Chave normalizada → URL como apareceu na busca. */
  #seen = new Map();
  /** @type {Map<string, string>} Chave normalizada → URL efetivamente lida. */
  #read = new Map();

  /** Zera o registro. Chamado no início de cada redação. */
  clear() {
    this.#seen.clear();
    this.#read.clear();
  }

  /**
   * Registra URLs devolvidas por uma busca (web ou blog).
   * @param {Array<{ url?: string }>} results
   */
  addSearchResults(results) {
    for (const { url } of results ?? []) {
      const key = sourceKey(url);
      if (key) this.#seen.set(key, url);
    }
  }

  /**
   * Registra uma página que foi baixada e lida com sucesso.
   * @param {string} url
   */
  addRead(url) {
    const key = sourceKey(url);
    if (!key) return;

    this.#read.set(key, url);
    this.#seen.set(key, url);
  }

  /**
   * @param {string} url
   * @returns {boolean} Se a URL foi lida durante esta redação
   */
  wasRead(url) {
    const key = sourceKey(url);
    return Boolean(key) && this.#read.has(key);
  }

  /**
   * @param {string} url
   * @returns {boolean} Se a URL ao menos apareceu numa busca
   */
  wasSeen(url) {
    const key = sourceKey(url);
    return Boolean(key) && this.#seen.has(key);
  }

  /** @returns {string[]} URLs lidas, na ordem em que foram abertas. */
  readUrls() {
    return [...this.#read.values()];
  }

  /** @returns {number} */
  get readCount() {
    return this.#read.size;
  }
}

/**
 * Chave de comparação de uma URL. Devolve string vazia para o que não é
 * endereço http(s) utilizável.
 * @param {string} url
 * @returns {string}
 */
export function sourceKey(url) {
  const value = String(url ?? '').trim();
  if (!value) return '';

  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return '';

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();

    return `${host}${path}`;
  } catch {
    return '';
  }
}
