FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir aiohttp==3.14.4 asyncssh==2.24.1 pyte==0.8.2
COPY --from=sdk stratum_backend.py ./
COPY server.py ./
CMD ["python", "server.py"]
