# ---- Stage 1: Install deps + build ----
FROM node:20.20.1-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# VITE_API_URL must be set at build time (baked into the JS bundle)
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
ARG VITE_SITE_URL
ENV VITE_SITE_URL=${VITE_SITE_URL}
ARG RELEASE_SHA=development

RUN npm run build
RUN printf '{"releaseSha":"%s"}\n' "${RELEASE_SHA}" > dist/version.json

# ---- Stage 2: Serve with nginx ----
FROM nginx:alpine AS production

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Cloud Run expects port 8080
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
