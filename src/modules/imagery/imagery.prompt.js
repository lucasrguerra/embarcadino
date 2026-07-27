/**
 * Módulo Imagery — Direção de arte (Camada de Aplicação).
 *
 * Responsabilidade única: transformar o `alt` que o redator escreveu no
 * briefing visual enviado ao modelo de imagem.
 *
 * O `alt` do rascunho descreve a ilustração ideal, mas não diz nada sobre
 * estilo — e sem direção o modelo entrega desde foto de banco de imagens até
 * desenho infantil, num blog que precisa de linha visual constante. As regras
 * abaixo são a identidade visual do Ciência Embarcada; ajuste aqui, não no
 * serviço.
 */

/** Direção de estilo comum a toda imagem do blog. */
const STYLE = [
  'Estilo: ilustração técnica editorial limpa, iluminação de estúdio suave, fundo neutro e desfocado.',
  'Paleta sóbria de azul-escuro, cinza-grafite e um acento ciano.',
  'Composição horizontal 16:9, com espaço negativo — a imagem abre um post de blog técnico.',
  'Realista e verossímil: componentes eletrônicos com pinagem, encapsulamento e proporção corretos.',
].join(' ');

/**
 * Restrições. Texto renderizado é o ponto fraco de todo modelo de imagem, e
 * placa com serigrafia ilegível ou rótulo com palavra inventada envelhece mal
 * num blog técnico — melhor não ter texto nenhum.
 */
const CONSTRAINTS = [
  'Não escreva nenhum texto, palavra, número, rótulo, marca ou logotipo na imagem.',
  'Sem marca d\'água, sem moldura, sem colagem de múltiplos quadros.',
  'Sem pessoas identificáveis e sem representar empresas reais.',
].join(' ');

/**
 * Monta o pedido enviado ao modelo de imagem.
 * @param {{ alt: string, title: string, position: number }} briefing
 * @returns {string}
 */
export function buildImagePrompt({ alt, title, position }) {
  const role =
    position === 0
      ? 'Imagem de abertura de uma publicação'
      : 'Imagem de apoio, dentro de uma seção de uma publicação';

  return [
    `${role} do blog Ciência Embarcada, sobre IoT e sistemas embarcados.`,
    `Tema da publicação: ${title}.`,
    `Ilustração pedida: ${alt}`,
    STYLE,
    CONSTRAINTS,
  ].join('\n');
}
