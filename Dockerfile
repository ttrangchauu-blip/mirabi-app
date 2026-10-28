# Image for the hosted business API (render.yaml, docs/deploy-test.md).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/srv \
    APP_MODULE=app.main:app

WORKDIR /srv/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
# The personal room (pet_room.py) and memory cards (memories.py) read the app's artwork from /srv/mobile/assets.
COPY mobile/assets/room/room-art.json /srv/mobile/assets/room/room-art.json
COPY mobile/assets/pets /srv/mobile/assets/pets

RUN useradd --create-home --uid 10001 appuser
USER appuser

# The host (Render) sets PORT and terminates TLS in front of the container.
CMD exec uvicorn "$APP_MODULE" --host 0.0.0.0 --port "${PORT:-8080}" --proxy-headers --forwarded-allow-ips="*"
