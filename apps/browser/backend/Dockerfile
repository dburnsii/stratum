# Real Chrome on a virtual display. Google Chrome on x86-64 (what sites see
# most; it also plays H.264 video); Debian's Chromium on ARM, where Google
# doesn't ship Chrome for Linux. Xvfb: the display. PulseAudio: the pages'
# sound. PyAV: H.264 / VP8 / Opus encoding and X11 capture (bundled FFmpeg).
FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates wget xvfb pulseaudio pulseaudio-utils procps tzdata \
      fonts-noto-color-emoji fonts-noto-cjk fonts-liberation \
    && if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
         wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
         && apt-get install -y --no-install-recommends /tmp/chrome.deb && rm /tmp/chrome.deb; \
       else apt-get install -y --no-install-recommends chromium; fi \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir aiohttp==3.14.4 av==19.0.2
WORKDIR /app
COPY --from=sdk stratum_backend.py ./
COPY server.py chrome.py cdp.py stream.py ./
CMD ["python", "server.py"]
