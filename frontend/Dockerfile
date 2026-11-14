FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY shared/package.json shared/package.json

RUN npm ci --workspace frontend

COPY frontend frontend

ARG VITE_API_BASE_URL=/api
ARG VITE_API_AUTH_TOKEN=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_API_AUTH_TOKEN=${VITE_API_AUTH_TOKEN}

RUN npm run build --workspace frontend

FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
