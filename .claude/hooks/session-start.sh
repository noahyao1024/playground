#!/bin/bash
# Installs dependencies at the start of a Claude Code on the web session, so
# `npm run typecheck` and `npm run lint` work there from the first command. A
# fresh cloud container has no node_modules. Local machines are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# install rather than ci: the container is cached once this hook finishes, and
# install keeps what is already there where ci would delete it and start over.
# --no-save keeps it from rewriting package-lock.json, which would leave every
# session starting with a modified file that nobody changed.
npm install --no-save --no-audit --no-fund
