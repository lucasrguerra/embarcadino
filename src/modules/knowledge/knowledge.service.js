/**
 * Módulo Knowledge — Serviço (Camada de Aplicação).
 *
 * Responsabilidade única: dar acesso à base de conhecimento do Ciência
 * Embarcada. Não conhece Telegram nem formatação de mensagens.
 */

import { KNOWLEDGE_ENTRIES, findEntry } from './knowledge.data.js';

export class KnowledgeService {
  /**
   * Todas as entradas conhecidas.
   * @returns {import('./knowledge.data.js').KnowledgeEntry[]}
   */
  list() {
    return KNOWLEDGE_ENTRIES;
  }

  /**
   * Uma entrada específica, por id/nome/apelido.
   * @param {string} term
   * @returns {import('./knowledge.data.js').KnowledgeEntry | undefined}
   */
  get(term) {
    return findEntry(term);
  }

  /**
   * Ids válidos — usado no schema da tool pra o modelo não chutar nome de projeto.
   * @returns {string[]}
   */
  ids() {
    return KNOWLEDGE_ENTRIES.map((entry) => entry.id);
  }
}
