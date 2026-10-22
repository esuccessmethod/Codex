FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 reelcraft
WORKDIR /app
COPY --chown=reelcraft:reelcraft app.py README.md ./
COPY --chown=reelcraft:reelcraft static/ ./static/
RUN mkdir /app/data && chown reelcraft:reelcraft /app/data
USER reelcraft
ENV HOST=0.0.0.0 PORT=10000 PYTHONUNBUFFERED=1
EXPOSE 10000
CMD ["python", "app.py"]
