FROM python:3.12-slim

WORKDIR /app

# Dependencies before source so code edits don't invalidate the pip layer.
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt

COPY server/ server/
COPY client/ client/
COPY apps/ apps/

# SQLite db + TLS cert/key live here (bind-mounted from ./data). The cert is
# made on the host by mkcert (`./run.sh` once, or see DESIGN.md §11): the
# image has no mkcert/openssl, and mkcert must see the host's LAN IPs anyway.
VOLUME ["/app/data"]
EXPOSE 8930

WORKDIR /app/server
CMD ["python", "server.py"]
