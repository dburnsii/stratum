#!/usr/bin/env bash
# Run all tests. Args pass to pytest, e.g. ./test.sh -k probe --headed
set -euo pipefail
cd "$(dirname "$0")"
if ! .venv/bin/python -c "import pytest_playwright" 2>/dev/null; then
  .venv/bin/pip install -q -r requirements-dev.txt
  .venv/bin/playwright install chromium
fi
exec .venv/bin/pytest "$@"
