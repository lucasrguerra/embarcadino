/**
 * Módulo Research — Handlers do Telegram (Camada de Apresentação).
 *
 * Responsabilidade única: agrupar os handlers do módulo numa classe,
 * mantendo a API que o router espera.
 */

import { createSearchHandler } from './search.js';
import { createPageHandler } from './page.js';

export class ResearchHandlers {
  /**
   * @param {import('../research.service.js').ResearchService} service
   * @param {import('../research.formatter.js').ResearchFormatter} formatter
   */
  constructor(service, formatter) {
    this.search = createSearchHandler(service, formatter);
    this.page = createPageHandler(service, formatter);
  }
}
