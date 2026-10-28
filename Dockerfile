# One image for both hosted services (render.yaml, docs/deploy-test.md):
#   business API: APP_MODULE=app.main:app (default)
#   AI Engine:    APP_MODULE=ai_engine.app:app
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/srv \
    APP_MODULE=app.main:app

WORKDIR /srv/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY ai_engine /srv/ai_engine

RUN useradd --create-home --uid 10001 appuser
USER appuser

# The host (Render) sets PORT and terminates TLS in front of the container.
CMD exec uvicorn "$APP_MODULE" --host 0.0.0.0 --port "${PORT:-8080}" --proxy-headers --forwarded-allow-ips="*"
