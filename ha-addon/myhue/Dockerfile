# Add-on MyHue : récupère le code depuis GitHub (master) à chaque "Reconstruire"
FROM node:22-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ARG REPO=https://github.com/MPoulhazan/MyHue.git
ARG BRANCH=master

# Invalide le cache Docker dès qu'un nouveau commit arrive sur la branche.
# Flux Atom de github.com plutôt que l'API : l'API refuse les requêtes sans User-Agent (Docker ADD), erreur 500/403 depuis 2026-11-18
ADD https://github.com/MPoulhazan/MyHue/commits/${BRANCH}.atom /tmp/last-commit.atom

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
# Tailscale (dépôt officiel) : Funnel n'expose que /mcp, pour le connecteur et les tâches Claude
RUN curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg \
    && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends tailscale \
    && rm -rf /var/lib/apt/lists/*
# adb 34 (bookworm-backports) : débogage sans fil appairé de la tablette murale (Communauto). Celui de bookworm (29) ne sait pas appairer.
RUN echo "deb http://deb.debian.org/debian bookworm-backports main" > /etc/apt/sources.list.d/backports.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends -t bookworm-backports adb \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
COPY run.mjs /run.mjs
CMD ["node", "/run.mjs"]
