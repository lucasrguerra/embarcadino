/**
 * Módulo Knowledge — Base de conhecimento do Ciência Embarcada (Dados).
 *
 * Responsabilidade única: descrever, em um só lugar, o que é o Ciência
 * Embarcada e cada um dos seus serviços. É daqui que sai tanto a resposta dos
 * comandos diretos (/inbraille, /espdocs) quanto o material que a IA usa pra
 * falar dos projetos sem inventar funcionalidade que não existe.
 *
 * Este arquivo é a fonte da verdade sobre os projetos: ao lançar ou mudar um
 * serviço, edite aqui — nada de espalhar descrição solta pelos prompts.
 */

/**
 * @typedef {Object} KnowledgeEntry
 * @property {string} id - Chave curta usada pelas tools e pelos comandos
 * @property {string} emoji
 * @property {string} name
 * @property {string} tagline - Uma frase, do jeito que seria dita numa apresentação
 * @property {string} url
 * @property {string[]} highlights - Fatos verificáveis sobre o projeto
 * @property {string[]} audience - Pra quem o projeto serve
 * @property {string[]} [aliases] - Outras formas de o usuário se referir a ele
 */

/** @type {KnowledgeEntry[]} */
export const KNOWLEDGE_ENTRIES = [
  {
    id: 'ciencia-embarcada',
    emoji: '🧠',
    name: 'Ciência Embarcada',
    tagline:
      'Projeto de divulgação técnica brasileiro que traduz tecnologia em conteúdo acessível, ' +
      'com foco em IoT, sistemas embarcados, eletrônica, redes e segurança.',
    url: 'https://cienciaembarcada.com.br',
    highlights: [
      'Mantido por Lucas Rayan Guerra, desenvolvedor pernambucano que trabalha desde o desenho de PCBs até a interface com o usuário.',
      'Publica artigos técnicos em português sobre IoT, sistemas embarcados, eletrônica, elétrica, comunicação, redes, infraestrutura, segurança, ciberataques, mercado, automação e homelab.',
      'Cobre tanto fundamentos (o que é IoT, Primeira Lei de Ohm, como a internet funciona) quanto notícias e análises de incidentes reais.',
      'Além do blog, abriga os projetos InBraille e ESPDocs.',
      'Lucas também é autor do livro "Tecnologia LoRa", sobre redes LoRa e LoRaWAN.',
    ],
    audience: ['Estudantes e curiosos de tecnologia', 'Desenvolvedores e engenheiros', 'Makers e entusiastas de eletrônica'],
    aliases: ['ciencia embarcada', 'ce', 'blog', 'site'],
  },
  {
    id: 'inbraille',
    emoji: '⠿',
    name: 'InBraille',
    tagline:
      'Ferramenta gratuita que converte texto em Braille e exporta o resultado em ASCII ou em ' +
      'placas STL prontas pra impressão 3D.',
    url: 'https://inbraille.cienciaembarcada.com.br',
    highlights: [
      'Converte nos dois sentidos: texto para Braille e Braille para texto.',
      'Exporta em formato ASCII e em arquivos STL de placas, para impressão 3D.',
      'Segue as Normas Técnicas para a Produção de Textos em Braille (3ª edição, 2018).',
      'Serve pra produzir textos personalizados, etiquetas, placas informativas e material didático em Braille.',
      'Nasceu de uma demanda do Laboratório de Impressão 3D Inclusiva do Departamento de Computação da UFRPE.',
      'O nome vem de "Inclusão" + "Braille"; a proposta é democratizar o acesso ao Braille via cultura maker, como alternativa de baixo custo às soluções comerciais.',
      'Foi apresentado em artigo no Workshop de Inovação, Desenvolvimento, Educação e Inclusão com Ações Maker (IDEIA), da SBC.',
    ],
    audience: [
      'Educadores e instituições de ensino',
      'Makers e donos de impressora 3D',
      'Organizações que apoiam pessoas com deficiência visual',
      'Qualquer pessoa que precise produzir material acessível',
    ],
    aliases: ['in braille', 'braille', 'inbrayle'],
  },
  {
    id: 'espdocs',
    emoji: '📗',
    name: 'ESPDocs',
    tagline:
      'Documentação independente e totalmente em português do ecossistema ESP32, reunindo ' +
      'especificações, comparações e ferramentas de escolha de chip.',
    url: 'https://espdocs.cienciaembarcada.com.br',
    highlights: [
      'Cobre as séries da família ESP32 em arquitetura Xtensa (ESP32, ESP32-S2, ESP32-S3) e RISC-V (ESP32-C3, ESP32-C5, ESP32-C6, ESP32-P4, entre outras).',
      'Tem um seletor que recomenda a série ideal a partir das necessidades do projeto.',
      'Permite comparar especificações de vários chips lado a lado.',
      'Traz catálogo de placas de desenvolvimento com filtros, diagramas de pinos e periféricos, e exemplos de código.',
      'Documenta os frameworks ESP-IDF, Arduino e MicroPython.',
      'Linka os datasheets oficiais da Espressif como fonte de cada informação.',
      'É um projeto educativo independente, sem afiliação com a Espressif Systems, baseado em fontes públicas.',
    ],
    audience: [
      'Desenvolvedores brasileiros que trabalham com ESP32',
      'Quem está escolhendo qual chip usar num projeto',
      'Estudantes que esbarram na barreira do inglês da documentação oficial',
    ],
    aliases: ['esp docs', 'esp32 docs', 'documentacao esp32'],
  },
];

/** @type {Map<string, KnowledgeEntry>} */
const BY_ID = new Map(KNOWLEDGE_ENTRIES.map((entry) => [entry.id, entry]));

/**
 * Encontra uma entrada por id, nome ou apelido (sem acento, sem caixa).
 * @param {string} term
 * @returns {KnowledgeEntry | undefined}
 */
export function findEntry(term) {
  const needle = normalize(term);
  if (!needle) return undefined;

  return (
    BY_ID.get(needle) ??
    KNOWLEDGE_ENTRIES.find(
      (entry) =>
        normalize(entry.name) === needle ||
        normalize(entry.id) === needle ||
        (entry.aliases ?? []).some((alias) => normalize(alias) === needle)
    )
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
