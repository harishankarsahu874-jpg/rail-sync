# ---- stage 1: build the React frontend ----
FROM node:22-alpine AS web
WORKDIR /app/frontend
ARG VITE_MAPTILER_API_KEY=""
ARG VITE_GEOAPIFY_API_KEY=""
ENV VITE_MAPTILER_API_KEY=${VITE_MAPTILER_API_KEY}
ENV VITE_GEOAPIFY_API_KEY=${VITE_GEOAPIFY_API_KEY}
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- stage 2: backend + built frontend ----
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /app/frontend/dist ./frontend_dist
ENV RAILSYNC_DIST=/app/frontend_dist
EXPOSE 8000
# first boot auto-seeds the DB and trains the model (a few seconds)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
