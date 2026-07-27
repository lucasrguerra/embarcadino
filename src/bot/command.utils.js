/**
 * Utilitários de parsing de comandos do Telegram (Camada de Apresentação).
 *
 * Em grupos, o Telegram entrega o comando com o nome do bot colado
 * (`/pesquisar@embarcadino_bot termo`), então todo handler que lê argumento
 * precisa remover as duas formas. Centralizar aqui evita repetir a mesma
 * regex — e o mesmo bug de esquecer o `@` — em cada handler.
 */

/**
 * Extrai o argumento de um comando, já sem o comando nem o @nomedobot.
 * @param {import('telegraf').Context} ctx
 * @param {string} command - Nome do comando, sem a barra (ex: 'pesquisar')
 * @returns {string} Argumento sem espaços nas pontas ('' se não houver)
 */
export function commandArgument(ctx, command) {
  const text = ctx.message?.text ?? '';
  return text.replace(new RegExp(`^/${command}(@\\w+)?\\s*`), '').trim();
}
