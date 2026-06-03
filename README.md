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

## Quick start

1. **GeoIP DB** — register free at [MaxMind](https://www.maxmind.com/en/geolite2/signup), download `GeoLite2-City.mmdb`, drop in `backend/`.
2. **Capture** — run capture script on Pi/router (see `capture/README.md`).
3. **Backend** — `cd backend && pip install -r requirements.txt && python server.py`.
4. **Frontend** — `cd frontend && npm install && npm run dev`, open http://localhost:5173.

## Architecture notes

- Capture node sees traffic via **port mirroring (SPAN)** on a managed switch, or runs on the router itself — passive, so it is **not** inline and cannot bottleneck the link.
- Only packet **metadata** is captured (src IP, dst IP, proto, ports). No payload, so CPU/disk stay low.
- Backend dedups flows, resolves device names from a static map / DHCP leases, looks up dst coords locally (no per-packet network call), and pushes flow events over WebSocket.
- Frontend renders each flow as an animated arc from your house to the destination.

See `ARCHITECTURE.md` for the full blueprint.
