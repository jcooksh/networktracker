#!/usr/bin/env bash
# One-command launcher. Default = demo mode (synthetic flows, no GeoIP DB / sudo).
#   ./run.sh           # demo mode
#   ./run.sh real      # real capture (needs GeoLite2-City.mmdb + sudo tshark)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-demo}"

# --- backend ---
cd "$ROOT/backend"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
./.venv/bin/pip install -q -r requirements.txt

if [ "$MODE" = "real" ]; then
  sudo ./.venv/bin/python server.py --config config.json &
else
  ./.venv/bin/python server.py --demo &
fi
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null || true' EXIT

# --- frontend ---
cd "$ROOT/frontend"
if [ ! -d node_modules ]; then npm install; fi
echo ""
echo "Backend ws://localhost:8765 | Frontend starting -> http://localhost:5173"
npm run dev
