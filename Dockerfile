# UX Audit Agency — server + Claude Agent SDK + Playwright (Chromium)
#
# The Playwright MCP launches a real Chromium, so the image ships the browser
# and its system libraries. --with-deps installs the apt packages Chromium needs.
FROM node:22-bookworm-slim

# Chromium runtime libraries (installed by `playwright install --with-deps`).
# git is handy for the Agent SDK's project tooling; ca-certificates for TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Install node deps first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci

# Install Chromium + its OS deps into the image.
RUN npx playwright install --with-deps chromium

# App source.
COPY tsconfig.json ./
COPY src ./src
COPY index.html CLAUDE.md .mcp.json ./
COPY .claude ./.claude

# Run as non-root: Claude Code refuses --dangerously-skip-permissions (which
# permissionMode:'bypassPermissions' uses) under root/sudo. The `node` user
# ships with the base image (uid 1000). Give it /app (writes .audit-tmp) and
# read/exec on the browser cache.
RUN chown -R node:node /app && chmod -R a+rx /ms-playwright
ENV HOME=/home/node
USER node

EXPOSE 4000
ENV AUDIT_PORT=4000

CMD ["npm", "run", "serve"]
