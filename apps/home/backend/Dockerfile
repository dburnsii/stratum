FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir aiohttp==3.14.4
COPY --from=sdk stratum_backend.py ./
COPY server.py ./
CMD ["python", "server.py"]
