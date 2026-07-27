/**
 * Módulo AI — Erros tipados.
 *
 * Responsabilidade única: dar nome às falhas do provedor de LLM que exigem
 * reações diferentes de quem chama.
 *
 * Sem isso, tudo chega em cima como um `Error` genérico e a camada de
 * apresentação só sabe dizer "não consegui, tenta de novo" — foi exatamente o
 * que aconteceu quando a cota diária acabou: a mensagem sugeria repetir o
 * comando, sendo que repetir era a única coisa que não podia dar certo.
 */

/** Base de todas as falhas vindas do provedor de LLM. */
export class LlmError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, cause?: unknown }} [options]
   */
  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.name = new.target.name;
    this.status = status;
  }
}

/**
 * Cota ou rate limit estourado (HTTP 429).
 *
 * `resetAt` é a hora em que a cota volta, quando o provedor informa. É o dado
 * que separa "espera um minuto" de "só amanhã" — e é o que o usuário precisa
 * ver na mensagem do Telegram.
 */
export class LlmQuotaError extends LlmError {
  /**
   * @param {string} message
   * @param {{ status?: number, resetAt?: Date | null, cause?: unknown }} [options]
   */
  constructor(message, { status = 429, resetAt = null, cause } = {}) {
    super(message, { status, cause });
    /** @type {Date | null} */
    this.resetAt = resetAt;
  }
}

/** Credencial ausente, inválida ou sem permissão (HTTP 401/403). */
export class LlmAuthError extends LlmError {}

/** Fuso do Lucas — a hora tem que ser a do relógio dele, não a do servidor. */
const TIMEZONE = 'America/Sao_Paulo';

/**
 * Mensagem de Telegram para as falhas de LLM que o usuário precisa entender —
 * ou `null` quando o erro não é uma delas e a mensagem genérica serve.
 *
 * A regra é não mentir sobre o que resolve: mandar "tenta de novo" quando a
 * cota diária acabou faz o usuário repetir um comando que só pode falhar.
 * @param {unknown} err
 * @returns {string | null} HTML
 */
export function describeLlmFailure(err) {
  if (err instanceof LlmAuthError) {
    return (
      '🔑 <b>A chave da API foi recusada</b>\n' +
      '<i>└ Isso é configuração, não passa sozinho: confere a chave do provedor de LLM no .env</i>'
    );
  }

  if (err instanceof LlmQuotaError) {
    const when = err.resetAt
      ? err.resetAt.toLocaleString('pt-BR', {
          timeZone: TIMEZONE,
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    return when
      ? `⏳ <b>Bati na cota do modelo</b>\n<i>└ A cota volta em ${when} — depois disso eu escrevo numa boa</i>`
      : '⏳ <b>Bati no limite de uso do modelo</b>\n<i>└ Não é o tema: é cota mesmo. Tenta daqui a alguns minutos</i>';
  }

  return null;
}
