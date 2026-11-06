#!/usr/bin/env bash
# Start the dev server. Args pass through: ./run.sh --http
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || ./setup.sh
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r server/requirements.txt
fi
ip=$(hostname -I | awk '{print $1}')
if [[ " $* " == *" --http "* ]]; then
  echo "Stratum: http://localhost:8000  (put TLS in front: tailscale serve / adb reverse, see DESIGN.md §11)"
else
  echo "Stratum: open https://$ip:8930 in Quest Browser"
fi
cd server && exec ../.venv/bin/python server.py "$@"
