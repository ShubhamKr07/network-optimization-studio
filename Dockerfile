# syntax=docker/dockerfile:1
FROM node:24-slim

# Python for the solver (artifacts/api-server/src/solver/solve.py, invoked
# via child_process.spawn from solver/jobRunner.ts's async worker pool).
# build-essential is required for argon2's native bindings (argon2@^0.41.1,
# used in routes/auth.ts) to compile during `pnpm install`.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm via corepack, matching pnpm-lock.yaml's lockfileVersion 9.0 -> pnpm 9.x.
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile

# Build only api-server and the workspace packages it depends on. This
# deliberately skips `studio` (built + deployed separately as a static site,
# see render.yaml) and avoids a monorepo-wide build inside the API image.
RUN pnpm --filter api-server... --if-present run build

RUN pip install --break-system-packages --no-cache-dir \
      -r artifacts/api-server/src/solver/requirements.txt

ENV NODE_ENV=production
# Render injects PORT at runtime and routes to it — do not hardcode it here.
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
