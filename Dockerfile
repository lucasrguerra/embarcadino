# ── Stage 1: Builder ──────────────────────────────────────────────────────────
# Instala as dependências de produção. Este stage é descartado no final.
FROM node:20-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Stage 2: Runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

LABEL maintainer="Lucas Rayan Guerra"
LABEL description="Embarcadino — assistente do Ciência Embarcada no Telegram"

# Usuário não-root para maior segurança
RUN addgroup -S botgroup && adduser -S botuser -G botgroup

WORKDIR /app

COPY --from=builder --chown=botuser:botgroup /build/node_modules ./node_modules
COPY --chown=botuser:botgroup package.json ./
COPY --chown=botuser:botgroup src/ ./src/

USER botuser

# Healthcheck: verifica se o processo Node está em execução
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD pgrep -x node > /dev/null || exit 1

CMD ["node", "src/index.js"]
