PY ?= python3

.PHONY: setup demo dev seed train catalog test

setup:            ## create venv + install deps (backend + frontend)
	$(PY) -m venv backend/.venv
	backend/.venv/bin/pip install -q -r backend/requirements.txt
	cd frontend && npm install --no-audit --no-fund

demo:             ## one-command demo on :8000 (rebuilds frontend with VITE_* keys)
	bash scripts/run.sh

dev:              ## backend :8000 (reload) + Vite :5173
	bash scripts/dev.sh

seed:             ## regenerate demo database + history
	cd backend && .venv/bin/python -m app.seed

train:            ## retrain models + print measured error
	cd backend && .venv/bin/python -m app.ml.train

catalog:          ## rebuild the uploaded train-part search index
	cd backend && .venv/bin/python -m app.train_catalog

test:             ## quick offline model/simulation/provider smoke test
	backend/.venv/bin/python scripts/smoke_test.py
