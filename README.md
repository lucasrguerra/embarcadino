# Embarcadino

![Embarcadino](images/embarcadino.png)

O **Embarcadino** é o assistente do [Ciência Embarcada](https://cienciaembarcada.com.br) no Telegram. Ele conversa com qualquer pessoa sobre IoT, sistemas embarcados, eletrônica e redes, pesquisa informação atualizada na internet antes de responder, encontra o que o blog já publicou sobre um assunto, explica os projetos da casa — [InBraille](https://inbraille.cienciaembarcada.com.br) e [ESPDocs](https://espdocs.cienciaembarcada.com.br) — e, para o autor do blog, redige rascunhos de publicação já em blocos do WordPress.

A IA roda via **OpenRouter** (API compatível com o formato da OpenAI), com **tool calling**: o modelo decide sozinho quando pesquisar na web, ler uma página, consultar o blog ou olhar a base de conhecimento dos projetos.

---

## Comandos

### Conversa

| Comando | O que faz |
|---------|-----------|
| *(texto solto)* | Qualquer mensagem sem `/` vira uma pergunta pro assistente |
| `/ask <pergunta>` | Mesma coisa, em formato de comando |
| `/reset` | Esquece o histórico da conversa |

### Ciência Embarcada

| Comando | O que faz |
|---------|-----------|
| `/sobre` | O que é o Ciência Embarcada |
| `/servicos` | Panorama dos projetos |
| `/inbraille` | Ficha do InBraille |
| `/espdocs` | Ficha do ESPDocs |

### Blog

| Comando | O que faz |
|---------|-----------|
| `/blog <termo>` | Busca publicações do blog |
| `/ultimos` | Publicações mais recentes |

### Pesquisa

| Comando | O que faz |
|---------|-----------|
| `/pesquisar <termo>` | Busca na internet |
| `/pagina <url>` | Lê uma página e devolve o conteúdo em texto |

### Redação — restrito

| Comando | O que faz |
|---------|-----------|
| `/post <tema>` | Pesquisa o tema e escreve um rascunho de publicação |

O `/post` aceita um briefing com até três partes separadas por `|`:

```
/post ESP32-C6 e o protocolo Matter | https://espdocs.cienciaembarcada.com.br | foca no consumo em bateria
```

A parte que for URL vira a referência obrigatória (o bot lê a página antes de escrever); o resto vira observação.

Com as credenciais do WordPress configuradas, o bot **cria o rascunho direto no blog** — com título, resumo e categorias preenchidos — e responde com o link do editor. Sem elas, ele entrega o mesmo conteúdo como arquivo `.html` para colar à mão.

> O bot **nunca publica**. O status é fixo em `draft` no [blog.client.js](src/modules/blog/blog.client.js) e não há caminho no código que publique — revisar e publicar continua sendo decisão humana.

---

## Ferramentas que a IA usa

Todas somente leitura — o modelo consulta, quem age é o usuário.

| Tool | Para quê |
|------|----------|
| `web_search` | Busca na internet (SearXNG do compose, com fallback pro DuckDuckGo) |
| `read_page` | Lê uma URL e extrai o texto legível |
| `blog_search` | Busca publicações do blog pela API REST do WordPress |
| `blog_latest` | Publicações mais recentes |
| `blog_get_post` | Conteúdo completo de uma publicação |
| `knowledge_lookup` | Base oficial sobre Ciência Embarcada, InBraille e ESPDocs |

O system prompt obriga o modelo a chamar `knowledge_lookup` antes de falar dos projetos e a ler a fonte antes de afirmar qualquer dado — a alternativa é ele inventar especificação de hardware, que é o pior erro possível num blog técnico.

---

## Arquitetura

Arquitetura em camadas, um diretório por módulo:

```
src/
├── index.js                    # Composition root — instancia e conecta tudo
├── config.js                   # Configuração central (segredos em base64)
├── bot/
│   ├── router.js               # Registro de comandos e actions
│   ├── command.utils.js        # Parsing de argumento de comando
│   └── middleware/
│       └── admin.middleware.js # Restringe /post aos chats admin
├── shared/
│   ├── logger.js               # Log com escopo e cadeia de causas
│   ├── html.utils.js           # escapeHtml, pluralize, truncate
│   ├── text.utils.js           # Quebra de mensagem no limite do Telegram
│   ├── telegramHtml.js         # Sanitiza o HTML que o modelo gera
│   ├── keyboard.utils.js       # Teclados inline
│   └── conversation.store.js   # Memória de conversa por chat
└── modules/
    ├── ai/                     # Assistente: client, prompt, tools, service
    ├── blog/                   # API REST do WordPress: leitura e criação de rascunho
    ├── knowledge/              # Base de conhecimento dos projetos
    ├── research/               # Busca na web e leitura de páginas
    └── writer/                 # Redação de rascunhos de publicação
```

Cada módulo segue a mesma divisão:

- **`.client.js`** — infraestrutura: fala com a API externa, não conhece regra de negócio.
- **`.service.js`** — aplicação: orquestra e normaliza, não conhece Telegram.
- **`.formatter.js`** — apresentação: monta as strings HTML do Telegram.
- **`handlers/`** — apresentação: recebe o `ctx` do Telegraf e amarra service + formatter.

As dependências são injetadas manualmente no `src/index.js` — sem container mágico, dá pra ler o grafo inteiro de cima a baixo.

Dois documentos guiam o conteúdo:

- **`DESIGN.md`** — como as mensagens do bot são escritas e formatadas.
- **`src/modules/writer/writer.prompt.js`** — como uma publicação do blog é escrita. As regras foram extraídas do export completo do WordPress do Ciência Embarcada (32 publicações), não inventadas.

---

## Configuração

Copie o `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

Segredos vão em **base64** (sufixo `_BASE64`), pra que caracteres especiais não sejam interpretados pelo Docker Compose:

```bash
echo -n 'seu_token_aqui' | base64 -w0
```

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `TELEGRAM_TOKEN_BASE64` | sim | Token do bot, em base64 |
| `LLM_API_KEY_BASE64` | sim | Chave do OpenRouter, em base64 |
| `SEARXNG_SECRET` | sim (no compose) | Chave de sessão do SearXNG. Gere com `openssl rand -hex 32` |
| `ADMIN_CHAT_IDS` | não | Chats que podem usar `/post`. Sem isso, o comando fica indisponível |
| `WORDPRESS_USERNAME` | não | Usuário do WordPress para criar o rascunho |
| `WORDPRESS_APP_PASSWORD_BASE64` | não | Senha de aplicação, em base64. Vai junto com a de cima |
| `LLM_MODEL` | não | Modelo do assistente (precisa suportar tool calling) |
| `LLM_WRITER_MODEL` | não | Modelo da redação. Padrão: o mesmo do assistente |
| `LLM_BASE_URL` | não | Padrão: `https://openrouter.ai/api/v1` |
| `BLOG_BASE_URL` | não | Padrão: `https://cienciaembarcada.com.br` |
| `SEARXNG_BASE_URL` | não | Padrão no compose: `http://searxng:8080`. Fora dele, a busca usa DuckDuckGo |

### Senha de aplicação do WordPress

No painel: **Usuários → Perfil → Senhas de aplicação**. Dê um nome (ex: `embarcadino`), copie a senha gerada e converta:

```bash
echo -n 'abcd EFGH ijkl mnop' | base64 -w0
```

Use sempre uma senha de aplicação, nunca a senha da conta: ela é revogável sozinha, não dá acesso ao painel e o cliente do bot remove os espaços da exibição antes de montar o Basic Auth. Se só uma das duas variáveis estiver preenchida, o bot recusa a subir — meia credencial é sempre engano de configuração, e o sintoma apareceria como um 401 no fim de uma redação de vários minutos.

O bot confere as credenciais no boot e registra no log se elas foram recusadas, sem impedir a subida.

---

## Rodando

```bash
npm install
npm run dev     # com --watch e carregando o .env
npm start       # produção (variáveis vêm do ambiente)
npm test        # suíte com node:test
```

Com Docker — sobe o bot **e** o SearXNG juntos:

```bash
docker compose up -d --build
```

O `docker-compose.yml` traz dois serviços:

- **`embarcadino`** — o bot.
- **`searxng`** — metabuscador próprio, configurado em [searxng/settings.yml](searxng/settings.yml) com o formato JSON habilitado (é o que o cliente de pesquisa consome).

O SearXNG **não publica porta**: ele só é alcançável pela rede interna do Compose, pelo nome `searxng`. Publicá-lo transformaria a instância num metabuscador aberto na internet — por isso também o `limiter` está desligado, o que só é seguro justamente porque não há porta exposta.

O bot espera o healthcheck do SearXNG antes de subir, e o healthcheck consulta a rota de busca em JSON — se alguém tirar `json` de `search.formats`, o container fica marcado como não saudável em vez de quebrar silenciosamente na primeira pesquisa. Se ainda assim o SearXNG estiver fora do ar, a busca cai automaticamente no DuckDuckGo e registra a degradação no log.

---

## Licença

MIT — veja [LICENSE](LICENSE).
