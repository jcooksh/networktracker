# networktracker

Self-hosted network monitor. Visualizes outbound traffic from every device on your LAN as live pulsing dots + arcs on a world map.

```
[Capture node: Pi/router] --tshark JSON--> [Python backend: parse + GeoIP + WS] --WebSocket--> [React + Leaflet dashboard]
```

## Components

| Layer | Tech | Dir |
|-------|------|-----|
| Capture | tshark/tcpdump on Pi or router (passive mirror) | `capture/` |
| Backend | Python: asyncio, geoip2, websockets | `backend/` |
| Frontend | React + Leaflet + react-leaflet | `frontend/` |

## Quick start (one command, demo mode)

No setup, no GeoIP DB, no `sudo`. Synthetic flows so you can see the map immediately:

```bash
./run.sh
```
Opens backend on `ws://localhost:8765` + frontend on http://localhost:5173.

## Real capture mode

1. **GeoIP DB** — register free at [MaxMind](https://www.maxmind.com/en/geolite2/signup), download `GeoLite2-City.mmdb`, drop in `backend/`.
2. `cp backend/config.example.json backend/config.json`, set `iface`, `home` coords, device map.
3. **Capture** — run on Pi/router (see `capture/README.md`), or let backend launch tshark locally.
4. Run:
   ```bash
   ./run.sh real      # backend launches tshark (needs sudo) + frontend
   ```

### Manual (instead of run.sh)
```bash
cd backend && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python server.py --demo          # or --config config.json for real
cd ../frontend && npm install && npm run dev
```

## Architecture notes

- Capture node sees traffic via **port mirroring (SPAN)** on a managed switch, or runs on the router itself — passive, so it is **not** inline and cannot bottleneck the link.
- Only packet **metadata** is captured (src IP, dst IP, proto, ports). No payload, so CPU/disk stay low.
- Backend dedups flows, resolves device names from a static map / DHCP leases, looks up dst coords locally (no per-packet network call), and pushes flow events over WebSocket.
- Frontend renders each flow as an animated arc from your house to the destination.

See `ARCHITECTURE.md` for the full blueprint.
