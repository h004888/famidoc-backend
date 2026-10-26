# Stage 1: Builder
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Cài đặt OpenSSL cần thiết cho Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# Stage 2: Runner
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Cài đặt OpenSSL cho Prisma runtime
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=4000

COPY package*.json ./
COPY prisma ./prisma/

# Cài đặt production dependencies (argon2 tự nhận prebuild binary glibc, không cần python/g++)
RUN npm ci --omit=dev

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin
COPY --from=builder /app/dist ./dist

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
