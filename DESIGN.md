# DESIGN.md — Guia de Mensagens do Embarcadino

Este documento define as convenções de conteúdo, estrutura e formatação de todas as mensagens do bot. Todo novo comando ou módulo deve seguir estas regras antes de ser implementado.

O Embarcadino é a porta de entrada pública do Ciência Embarcada. Quem fala com ele pode ser um engenheiro procurando o datasheet certo ou uma professora que ouviu falar do InBraille — as mensagens precisam funcionar para os dois.

> Para as regras de **redação de publicações do blog** (estrutura do post, tamanho, voz, blocos do Gutenberg), veja `src/modules/writer/writer.prompt.js`. Aquele arquivo é a fonte da verdade da escrita; este aqui trata só das mensagens do bot.

---

## Princípios

**1. Cada módulo tem um emoji de categoria fixo, e ele aparece sempre.**
📰 é publicação do blog, 🔎 é resultado de busca, 🌐 é página lida, ✍️ é redação, 🤖 é o assistente. O emoji é a etiqueta visual da categoria, não decoração de abertura — numa lista de publicações, todo item começa com 📰.

**2. Estrutura é informação.**
A hierarquia visual (negrito, itálico, monoespaço, quebra de linha) reflete a hierarquia real do conteúdo. Título é `<b>`, subordinado é `<i>` com conector `└`, valor técnico é `<code>`.

**3. Frases completas, com contexto — não fragmentos técnicos.**
"Achei 3 publicações sobre LoRaWAN no Ciência Embarcada:" e não "3 resultados".

**4. Nunca afirmar o que não foi verificado.**
Vale para as mensagens e vale em dobro para as respostas da IA: informação sem fonte não entra. "Não encontrei" é uma resposta legítima e melhor que um chute plausível.

**5. Estados vazios e erros também têm voz, mas continuam úteis.**
Um estado vazio diz o que faltou. Um erro diz o que falhou (título) e o que fazer (linha `└` abaixo) — sem esconder informação atrás de humor.

---

## Parse Mode

Todas as mensagens com formatação usam **`parse_mode: 'HTML'`**.

> MarkdownV2 é proibido — exige escape de caracteres comuns (`.`, `-`, `(`) e produz bugs difíceis de rastrear.

### Tags e quando usar cada uma

| Tag | Uso |
|-----|-----|
| `<b>` | Títulos: nome do item, contagem, palavra-chave do cabeçalho |
| `<i>` | Tudo que é subordinado: descrição, metadado, nota, rodapé |
| `<code>` | Valores técnicos: datas, categorias, comandos de exemplo |
| `<a href="url">` | Links externos — o título de uma publicação já é o link |
| `<pre>` | Bloco de código (só em respostas da IA) |

### Conector `└`

Toda linha subordinada a um título abre com `└ ` e vai em itálico:

```
<b>Título</b>
<i>└ informação subordinada</i>
```

### Escape obrigatório

Todo texto dinâmico (API, usuário, conteúdo de página) passa por `escapeHtml()` de `src/shared/html.utils.js` antes de entrar numa mensagem HTML.

**A exceção é a resposta da IA**, que passa por `sanitizeForTelegramHtml()` (`src/shared/telegramHtml.js`): o modelo é instruído a devolver HTML, então escapar tudo destruiria a formatação legítima. O sanitizador converte markdown solto, mantém só as tags da whitelist e, se as tags não fecharem, remove todas — o Telegram rejeita a mensagem inteira diante de uma tag inválida, então a garantia precisa estar do nosso lado.

### Preview de link

Mensagens com muitos links usam `link_preview_options: { is_disabled: true }`. Um preview gigante no fim de uma lista de resultados atrapalha mais que ajuda.

### Mensagens longas

O Telegram corta em 4096 caracteres. Use `splitIntoChunks()` de `src/shared/text.utils.js`, que quebra em fronteira de parágrafo. Quando o texto ainda vai ser formatado depois da quebra, use o limite `TELEGRAM_SAFE_CHUNK` — escapar caracteres aumenta o tamanho, e um pedaço de exatamente 4096 estouraria.

---

## Anatomia das Mensagens

### Tipo 1 — Lista de itens

```
📰 Achei <b>3 publicações</b> sobre <b>LoRaWAN</b> no Ciência Embarcada:

📰 <a href="...">LoRa: O que é e como funciona</a>
<i>└ Resumo da publicação, cortado em 180 caracteres…</i>
<i>└ <code>17/02/2025 · IoT · Comunicação</code></i>
```

**Regras:** cabeçalho é frase completa que contextualiza a origem dos dados; emoji de categoria abre o cabeçalho e cada item; nome em `<b>` ou como link; metadados na linha `└` em `<code>`; itens separados por linha em branco.

### Tipo 2 — Ficha de projeto

```
⠿ <b>InBraille</b>
<i>└ Uma frase explicando o projeto.</i>

• Fato verificável sobre o projeto.
• Outro fato.

<b>Pra quem serve:</b>
• Público-alvo.

🔗 <a href="...">https://inbraille.cienciaembarcada.com.br</a>
```

**Regras:** os fatos vêm exclusivamente de `knowledge.data.js`; o link fecha a mensagem; nada de adjetivo publicitário que não esteja nos dados.

### Tipo 3 — Resposta do assistente

Texto livre gerado pelo modelo, sem cabeçalho nem moldura — a resposta já é a mensagem. Formatação garantida pelo sanitizador, quebra em várias mensagens quando necessário.

### Tipo 4 — Boas-vindas e ajuda

Primeira mensagem que a pessoa vê. Diz o que o bot é, o que ele faz e como começar (que é "manda a pergunta direto"). O `/help` agrupa comandos por módulo, com o emoji de categoria abrindo cada grupo.

### Tipo 5 — Estado vazio

```
📰 Procurei por <b>Zigbee</b> no Ciência Embarcada e ainda não existe nada publicado sobre isso.
```

Frase afirmativa, com o termo procurado em `<b>`, sem sugerir próximo passo óbvio.

### Tipo 6 — Erro de operação

```
⚠️ <b>Não consegui ler essa página</b>
<i>└ O site <code>exemplo.com</code> pode estar fora do ar ou bloqueando leitura automática</i>
```

Erros esperados (site fora do ar, link inválido) viram mensagem específica no próprio handler. Erros inesperados caem no `wrap()` do router, que responde a mensagem genérica e registra o stack no log. Nunca expor stack trace ou mensagem interna ao usuário.

### Tipo 7 — Operação demorada

Redigir um post leva minutos. O handler avisa antes de começar, mantém o `sendChatAction('typing')` vivo com um `setInterval` e entrega o resultado em duas partes: a ficha na mensagem, o conteúdo no arquivo.

```
✍️ Beleza, vou pesquisar e escrever sobre <b>tema</b>.
<i>└ Isso leva alguns minutos — te aviso quando o rascunho estiver pronto</i>
```

---

## Emojis Autorizados

| Emoji | Significado | Onde usar |
|-------|-------------|-----------|
| `🤖` | Categoria: assistente de IA | `/ask`, `/reset`, cabeçalho do `/help` |
| `🧠` | Categoria: Ciência Embarcada | Ficha do projeto e panorama de serviços |
| `⠿` | Categoria: InBraille | Ficha do InBraille |
| `📗` | Categoria: ESPDocs | Ficha do ESPDocs |
| `📰` | Categoria: publicação do blog | Todo item de publicação |
| `🔎` | Categoria: busca na web | `/pesquisar` e cada resultado |
| `🌐` | Categoria: página lida | `/pagina` |
| `✍️` | Categoria: redação | `/post` e o rascunho gerado |
| `🔗` | Link do projeto | Fecha a ficha de um projeto |
| `⚠️` | Falha técnica | Mensagens de erro |
| `🔒` | Acesso restrito | Comando de admin negado |
| `👋` | Saudação | Só no `/start` |
| `🤔` | Não entendi | Comando desconhecido, projeto não encontrado |

Emoji de categoria é fixo por módulo — ao criar um módulo novo, escolha um e documente aqui.

---

## Tom e Linguagem

| ✅ Usar | ❌ Evitar |
|--------|---------|
| Frases completas com sujeito e contexto | Fragmentos tipo "3 resultados" |
| Voz ativa e tom de colega ("Beleza, vou pesquisar") | Formalidade de relatório ou gíria forçada |
| "Não encontrei" quando não encontrou | Preencher lacuna com informação plausível |
| Termo técnico explicado na primeira aparição | Jargão empilhado sem contexto |
| Emoji de categoria em todo item do mesmo tipo | Emoji aleatório sem padrão |

---

## Adicionando um Novo Módulo

- [ ] Escolher o emoji de categoria e documentá-lo na tabela acima
- [ ] Criar `<modulo>.client.js` (infra) → `<modulo>.service.js` (aplicação) → `<modulo>.formatter.js` (apresentação) → `handlers/index.js`
- [ ] Registrar as rotas em `src/bot/router.js`, sempre com `wrap()`
- [ ] Instanciar no composition root (`src/index.js`)
- [ ] Se o módulo tiver algo que a IA deva consultar, expor como tool **somente leitura** em `src/modules/ai/ai.tools.js`
- [ ] Escrever estados vazios e erros específicos do domínio
- [ ] Garantir que todo texto dinâmico passa por `escapeHtml()`
- [ ] Atualizar o `README.md` e a lista de comandos do BotFather
