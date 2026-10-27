# Add-on MyHue : récupère le code depuis GitHub (master) à chaque "Reconstruire"
FROM node:22-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ARG REPO=https://github.com/MPoulhazan/MyHue.git
ARG BRANCH=master

# Invalide le cache Docker dès qu'un nouveau commit arrive sur la branche
ADD https://api.github.com/repos/MPoulhazan/MyHue/commits/${BRANCH} /tmp/last-commit.json

RUN git clone --depth 1 --branch ${BRANCH} ${REPO} /app
WORKDIR /app
RUN npm ci \
    && npx vite build \
    && npm prune --omit=dev \
    && rm -rf .git src server/data/z2m

FROM node:22-bookworm-slim
ENV NODE_ENV=production

# yt-dlp (flux audio YouTube vers les enceintes Cast) : dernière version, YouTube casse souvent les anciennes
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp
WORKDIR /app
COPY --from=build /app /app
COPY run.mjs /run.mjs
CMD ["node", "/run.mjs"]
