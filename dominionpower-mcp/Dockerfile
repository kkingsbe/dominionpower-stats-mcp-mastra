# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Run (Playwright base for browser-based TFA auth)
FROM mcr.microsoft.com/playwright:v1.49.0-jammy
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/.mastra ./.mastra

VOLUME /data

EXPOSE 3456

HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:3456/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

ENV NODE_ENV=production
ENV PORT=3456
ENV HOST=0.0.0.0

CMD ["node", ".mastra/output/index.mjs"]
