FROM node:22-bookworm-slim

ENV PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer
ENV NODE_ENV=production

WORKDIR /app

# Puppeteer's browser installer needs unzip to extract the downloaded Chrome
# archive. ca-certificates is required for browser/API HTTPS connections.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY shared/package.json shared/package.json

# Install only backend production dependencies, then install Puppeteer's
# matching Chrome build together with its required Linux libraries.
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev --workspace backend \
    && apt-get update \
    && npx puppeteer browsers install chrome --install-deps \
    && rm -rf /var/lib/apt/lists/* \
    && chown -R node:node /home/node/.cache/puppeteer /app

COPY --chown=node:node backend/src backend/src
COPY --chown=node:node shared shared

RUN mkdir -p backend/storage/screenshots \
    && chown -R node:node backend/storage

USER node
WORKDIR /app/backend

EXPOSE 5173

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:5173/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "start"]
