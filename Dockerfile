# Stage 1: Builder
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Cài đặt OpenSSL cần thiết cho Prisma + Chromium cho Puppeteer
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends openssl chromium fonts-dejavu-core fonts-liberation && \
    rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --fetch-retries=4

COPY . .

RUN npx prisma generate
RUN npm run build
# Dọn gói dev từ bộ dependencies đã cài, không tải lại từ mạng.
RUN npm prune --omit=dev --offline --ignore-scripts

# Stage 2: Runner
FROM node:24-bookworm-slim AS runner

WORKDIR /app

# Cài đặt OpenSSL cho Prisma runtime + Chromium + fonts cho Puppeteer
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends openssl chromium fonts-dejavu-core fonts-liberation && \
    rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

ENV NODE_ENV=production
ENV PORT=4000

COPY package*.json ./
COPY prisma ./prisma/

# Mang theo dependencies production và Prisma Client đã generate.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY scripts/docker-entrypoint.sh /app/scripts/docker-entrypoint.sh
RUN chmod +x /app/scripts/docker-entrypoint.sh

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
