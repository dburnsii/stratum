#!/usr/bin/env bash
# Set up Stratum (safe to re-run): .env, app secrets, app backends, data/, HTTPS cert.
set -euo pipefail
cd "$(dirname "$0")"
exec python3 tools/setup.py "$@"
