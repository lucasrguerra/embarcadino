/**
 * Módulo Blog — Cliente HTTP (Camada de Infraestrutura).
 *
 * Responsabilidade única: falar com a API REST do WordPress do Ciência
 * Embarcada (`/wp-json/wp/v2`). Não conhece Telegram nem formatação.
 *
 * Usar a API REST em vez de raspar o HTML do site dá título, resumo, data,
 * categorias e conteúdo já estruturados — e continua funcionando quando o
 * tema do blog muda.
 *
 * Escrita: as credenciais são uma **Senha de Aplicação** do WordPress
 * (Usuários → Perfil → Senhas de aplicação), enviadas como Basic Auth. Senha de
 * aplicação é revogável individualmente e não dá acesso ao painel — é o
 * mecanismo certo aqui, e nunca a senha da conta.
 *
 * Leitura funciona sem credencial nenhuma; só a criação de rascunho exige.
 */

const TIMEOUT_MS = 30_000;

/** Subir uma imagem gerada (algumas centenas de KB) leva mais que uma leitura. */
const UPLOAD_TIMEOUT_MS = 120_000;

export class BlogClient {
  /** @type {string} */
  #baseUrl;
  /** @type {string | undefined} */
  #authHeader;
  /** @type {Promise<Array<{ id: number, name: string, slug: string }>> | null} */
  #categoriesPromise = null;

  /**
   * @param {{ baseUrl: string, username?: string, appPassword?: string }} config
   */
  constructor({ baseUrl, username, appPassword }) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');

    if (username && appPassword) {
      // O WordPress mostra a senha de aplicação em grupos separados por espaço
      // ("abcd EFGH ijkl"); os espaços são cosméticos e precisam sair antes de
      // montar o Basic Auth, senão a autenticação falha com 401.
      const credentials = `${username}:${appPassword.replace(/\s+/g, '')}`;
      this.#authHeader = `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`;
    }
  }

  /** @returns {boolean} Se o cliente pode escrever no blog. */
  get canWrite() {
    return Boolean(this.#authHeader);
  }

  /**
   * Busca publicações por termo (ou as mais recentes, se `search` for vazio).
   * @param {{ search?: string, limit?: number }} [options]
   * @returns {Promise<Array<Object>>} Posts crus da API
   */
  async listPosts({ search = '', limit = 5 } = {}) {
    const params = new URLSearchParams({
      per_page: String(limit),
      orderby: search ? 'relevance' : 'date',
      order: 'desc',
      _fields: 'id,date,link,title,excerpt,categories',
    });
    if (search) params.set('search', search);

    return this.#request(`/wp-json/wp/v2/posts?${params}`);
  }

  /**
   * Busca uma publicação específica, com o conteúdo completo.
   * @param {number} id
   * @returns {Promise<Object>}
   */
  async getPost(id) {
    const params = new URLSearchParams({ _fields: 'id,date,link,title,excerpt,content,categories' });
    return this.#request(`/wp-json/wp/v2/posts/${id}?${params}`);
  }

  /**
   * Lista de categorias do blog, buscada uma vez e reaproveitada.
   * A lista muda de mês em mês, no máximo — não vale uma requisição extra em
   * toda listagem de posts. Guarda-se a Promise (e não o resultado) pra que
   * chamadas simultâneas compartilhem a mesma requisição.
   * @returns {Promise<Array<{ id: number, name: string, slug: string }>>}
   */
  async listCategories() {
    if (!this.#categoriesPromise) {
      const params = new URLSearchParams({ per_page: '100', _fields: 'id,name,slug' });
      this.#categoriesPromise = this.#request(`/wp-json/wp/v2/categories?${params}`).catch((err) => {
        // Sem limpar, um erro transitório de rede ficaria cacheado pra sempre.
        this.#categoriesPromise = null;
        throw err;
      });
    }

    return this.#categoriesPromise;
  }

  /**
   * Cria uma publicação como RASCUNHO no WordPress.
   *
   * `status` é fixo em 'draft' de propósito: o bot escreve, quem publica é o
   * Lucas. Nenhum caminho do código deve permitir publicação automática.
   *
   * @param {{ title: string, excerpt: string, content: string, categoryIds?: number[] }} draft
   * @returns {Promise<{ id: number, link: string, editLink: string, status: string }>}
   */
  async createDraft({ title, excerpt, content, categoryIds = [] }) {
    if (!this.canWrite) {
      throw new Error('Credenciais do WordPress não configuradas.');
    }

    const created = await this.#request('/wp-json/wp/v2/posts', {
      method: 'POST',
      authenticated: true,
      body: {
        title,
        excerpt,
        content,
        status: 'draft',
        ...(categoryIds.length > 0 ? { categories: categoryIds } : {}),
      },
    });

    return {
      id: created.id,
      link: created.link ?? '',
      editLink: `${this.#baseUrl}/wp-admin/post.php?post=${created.id}&action=edit`,
      status: created.status ?? 'draft',
    };
  }

  /**
   * Sobe um arquivo para a biblioteca de mídia e devolve a URL pública.
   *
   * O endpoint de mídia não aceita JSON: o corpo é o binário puro, e o nome do
   * arquivo vai no `Content-Disposition`. O `alt_text` só pode ser definido
   * depois, num segundo POST sobre o anexo já criado — é assim que a API do
   * WordPress funciona, não é redundância.
   *
   * @param {{ data: Buffer, filename: string, mimeType: string, alt?: string, caption?: string }} file
   * @returns {Promise<{ id: number, url: string }>}
   */
  async uploadMedia({ data, filename, mimeType, alt, caption }) {
    if (!this.canWrite) {
      throw new Error('Credenciais do WordPress não configuradas.');
    }

    const created = await this.#request('/wp-json/wp/v2/media', {
      method: 'POST',
      authenticated: true,
      raw: { data, mimeType, filename },
    });

    if (alt || caption) {
      // Falhar aqui custaria a imagem inteira por causa de um atributo; o alt é
      // importante pro SEO, mas não a ponto de descartar o upload que deu certo.
      await this.#request(`/wp-json/wp/v2/media/${created.id}`, {
        method: 'POST',
        authenticated: true,
        body: { ...(alt ? { alt_text: alt } : {}), ...(caption ? { caption } : {}) },
      }).catch(() => undefined);
    }

    return { id: created.id, url: created.source_url ?? '' };
  }

  /**
   * Define a imagem destacada de uma publicação.
   * @param {number} postId
   * @param {number} mediaId
   * @returns {Promise<void>}
   */
  async setFeaturedMedia(postId, mediaId) {
    await this.#request(`/wp-json/wp/v2/posts/${postId}`, {
      method: 'POST',
      authenticated: true,
      body: { featured_media: mediaId },
    });
  }

  /**
   * Confere se as credenciais são válidas, sem escrever nada.
   * @returns {Promise<{ name: string, id: number }>} Usuário autenticado
   */
  async verifyCredentials() {
    if (!this.canWrite) {
      throw new Error('Credenciais do WordPress não configuradas.');
    }

    return this.#request('/wp-json/wp/v2/users/me?_fields=id,name,slug', { authenticated: true });
  }

  /**
   * @param {string} path
   * @param {{ method?: string, body?: Object, authenticated?: boolean, raw?: { data: Buffer, mimeType: string, filename: string } }} [options]
   * @returns {Promise<any>}
   */
  async #request(path, { method = 'GET', body, authenticated = false, raw } = {}) {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      method,
      // Upload de imagem é lento numa hospedagem compartilhada; o timeout de
      // leitura não serve aqui.
      signal: AbortSignal.timeout(raw ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(raw
          ? {
              'Content-Type': raw.mimeType,
              'Content-Disposition': `attachment; filename="${raw.filename}"`,
            }
          : {}),
        // A credencial só acompanha as chamadas que precisam dela — busca e
        // leitura são anônimas, e mandar Basic Auth em toda requisição seria
        // exposição desnecessária do segredo.
        ...(authenticated ? { Authorization: this.#authHeader } : {}),
      },
      ...(raw ? { body: raw.data } : body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`API do blog respondeu ${response.status} em ${method} ${path}: ${detail.slice(0, 300)}`);
    }

    return response.json();
  }
}
