#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgresql://$(whoami)@localhost:5432/haggle_negolab}"
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
exec pnpm exec tsx local-fewshot/src/server.ts
