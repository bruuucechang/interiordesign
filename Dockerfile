# Production image: the built front end served by the API that backs it.
#
# One container rather than two, because the client is a static bundle and
# FastAPI can hand it out perfectly well. That also removes the CORS and proxy
# questions entirely — the browser talks to one origin, and net/api.ts already
# uses relative /api paths.

# ---------------------------------------------------------------- client build
FROM node:22-slim AS client

WORKDIR /build
# Copy manifests first so the dependency layer is cached across source edits.
COPY package.json package-lock.json ./
COPY client/package.json client/
RUN npm ci

COPY client/ client/
RUN npm run --workspace client build


# ---------------------------------------------------------------- runtime
FROM python:3.13-slim AS runtime

# opencv-python-headless still needs libGL's loader and glib at import time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server/app/ app/
COPY server/scripts/ scripts/
COPY --from=client /build/client/dist/ static/

# Run as a non-root user; nothing here needs to write outside the database.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

ENV PYTHONUNBUFFERED=1
EXPOSE 8791

# The database may still be starting when this container is; the entrypoint
# waits for it rather than crash-looping.
COPY --chmod=0755 docker/entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8791"]
