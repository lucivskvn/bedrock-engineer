# syntax=docker/dockerfile:1.6

FROM node:20-bullseye AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
WORKDIR /app
COPY . .
RUN npm run build

FROM deps AS verifier
WORKDIR /app
COPY . .
ENV CI=1 \
    ELECTRON_ENABLE_LOGGING=false \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
CMD ["npm", "run", "ci:verify"]

FROM node:20-bullseye-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/out ./out
RUN useradd --system --uid 1001 bedrock && chown -R bedrock:bedrock /app
USER bedrock
CMD ["node", "out/main/index.js"]
