FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS whatsapp
WORKDIR /build
COPY whatsapp/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM python:3.12-slim-bookworm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/start.py ./start.py
COPY --from=whatsapp /usr/local/bin/node /usr/local/bin/node
COPY --from=whatsapp /build/node_modules ./whatsapp/node_modules
COPY whatsapp/*.mjs ./whatsapp/
COPY --from=frontend /build/dist ./static
ENV STATIC_DIR=/app/static PYTHONUNBUFFERED=1
RUN useradd --create-home --uid 10001 crm
USER crm
CMD ["python", "start.py"]
