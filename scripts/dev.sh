#!/usr/bin/env bash
# Development workflow: backend with reload on :8000 + Vite dev server on :5173.
# Open http://localhost:5173 (Vite proxies /api and /ws to :8000).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PY=python3
[ -d backend/.venv ] || $PY -m venv backend/.venv
backend/.venv/bin/pip install -q -r backend/requirements.txt

if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install --no-audit --no-fund)
fi

trap 'kill 0' EXIT
( cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload ) &
( cd frontend && npm run dev ) &
wait
