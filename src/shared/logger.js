/**
 * Logger central — Responsabilidade única: formatar logs de forma consistente
 * (timestamp + escopo + nível) e extrair a cadeia completa de causas de um erro.
 *
 * Erros de rede vêm em dois formatos, dependendo do cliente HTTP:
 *   - `fetch`/undici nativo: mensagem genérica ("fetch failed") + motivo real em `err.cause`.
 *   - `node-fetch` (usado pelo Telegraf): mensagem genérica ("...failed, reason: ") +
 *     motivo real em `err.code`/`err.errno` (sem `.cause` nenhum).
 * Sem desembrulhar os dois casos, o log fica com "reason: " vazio e o problema
 * vira impossível de diagnosticar.
 */

function timestamp() {
  return new Date().toISOString();
}

/** Propriedades de erros de socket/rede do Node que carregam o motivo real. */
const NETWORK_ERROR_KEYS = ['code', 'errno', 'syscall', 'address', 'port', 'type', 'reason'];

/**
 * Desembrulha `err.cause` recursivamente e anexa detalhes de erro de rede.
 * @param {unknown} err
 * @returns {string}
 */
export function describeError(err) {
  if (!(err instanceof Error)) return String(err);

  const chain = [err.message || '(sem mensagem)'];
  let cause = err.cause;
  while (cause) {
    chain.push(cause instanceof Error ? cause.message : String(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }

  const details = NETWORK_ERROR_KEYS.filter((key) => err[key] !== undefined).map(
    (key) => `${key}=${err[key]}`
  );

  const description = chain.join(' → causado por: ');
  return details.length > 0 ? `${description} [${details.join(', ')}]` : description;
}

/**
 * @param {string} scope - Tag do módulo/contexto (ex: 'LAUNCH', 'AI')
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 * @param {unknown} [err]
 */
function log(scope, level, message, err) {
  const line = `[${timestamp()}] [${scope}] ${message}`;
  const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (err !== undefined) {
    method(`${line} — ${describeError(err)}`);
    if (err instanceof Error && err.stack) {
      method(err.stack);
    }
  } else {
    method(line);
  }
}

export const logger = {
  /**
   * @param {string} scope
   * @param {string} message
   */
  info: (scope, message) => log(scope, 'info', message),
  /**
   * @param {string} scope
   * @param {string} message
   * @param {unknown} [err]
   */
  warn: (scope, message, err) => log(scope, 'warn', message, err),
  /**
   * @param {string} scope
   * @param {string} message
   * @param {unknown} [err]
   */
  error: (scope, message, err) => log(scope, 'error', message, err),
};
