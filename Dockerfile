# ---- stage 1: build the React frontend (keys come from committed .env.production)
FROM node:22-alpine AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
# envDir is the repo root (vite.config.js), so the committed keys file must
# sit one level above frontend/ inside the image. Build ARGs, if ever passed,
# still override these values (Vite: process env > .env files).
COPY .env.production /app/.env.production
RUN npm run build

# ---- stage 2: FastAPI backend + built frontend, single port
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ ./
COPY .env.production /app/.env.production
COPY --from=web /app/frontend/dist ./frontend_dist
ENV RAILSYNC_DIST=/app/frontend_dist
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
