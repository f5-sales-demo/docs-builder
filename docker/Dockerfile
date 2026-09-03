FROM node:24-alpine AS builder
# checkov:skip=CKV_DOCKER_2:Build container runs to completion and exits
# checkov:skip=CKV_DOCKER_7:Major version pin receives Alpine security patches
LABEL org.opencontainers.image.description="docs-builder"
WORKDIR /app

# Install Chromium and dependencies for Puppeteer (PDF generation)
# hadolint ignore=DL3018
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    font-noto-cjk

# Use system Chromium instead of Puppeteer downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install deps (cached layer)
COPY package*.json ./
COPY scripts/patch-starlight-js-yaml.mjs scripts/patch-starlight-js-yaml.mjs
RUN npm ci --legacy-peer-deps && \
    node scripts/patch-starlight-js-yaml.mjs

# Copy framework code
COPY . .

# Bake theme config into the image (single source of truth)
RUN cp node_modules/@f5-sales-demo/docs-theme/astro.config.mjs /app/astro.config.mjs && \
    cp node_modules/@f5-sales-demo/docs-theme/src/content.config.ts /app/src/content.config.ts

# Provide the default site favicon from the theme's logo. Starlight references
# /favicon.svg; publicDir assets are served at /<base>/favicon.svg. Without this
# every site's <link rel="icon" href="/<base>/favicon.svg"> 404s.
RUN mkdir -p /app/public && \
    cp node_modules/@f5-sales-demo/docs-theme/assets/f5-logo.svg /app/public/favicon.svg

# Remove placeholder content
RUN rm -rf src/content/docs/*

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && \
    chown -R node:node /app /entrypoint.sh

USER 1000:1000

ENTRYPOINT ["/entrypoint.sh"]
