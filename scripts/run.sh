#!/usr/bin/env bash
# One-command demo: venv + deps + seed + train + frontend build + serve.
# Usage: bash scripts/run.sh   →   http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")/.."

# Optional provider credentials. VITE_* variables must be present while the
# frontend is built; server-only keys remain in the FastAPI process.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PY=python3
[ -d backend/.venv ] || $PY -m venv backend/.venv
backend/.venv/bin/pip install -q -r backend/requirements.txt

# seed + train (skips silently when already present; server also self-heals)
backend/.venv/bin/python - <<'EOF'
import sys; sys.path.insert(0, "backend")
from app import db, config
from app.seed import needs_seed, run as seed
from app.ml.train import train

db.init()
reseeded = needs_seed()
if reseeded:
    seed()
if reseeded or not (config.MODELS_DIR / "predictor.joblib").exists():
    train()
EOF

if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install --no-audit --no-fund)
fi
# Always rebuild: this also embeds changed VITE_MAPTILER/VITE_GEOAPIFY keys.
(cd frontend && npm run build)

exec backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend
