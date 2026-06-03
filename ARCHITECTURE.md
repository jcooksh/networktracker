# Architecture blueprint

## 1. Data capture (no bottleneck)

**Goal:** see every device's outbound packets without sitting inline as a choke point.

Two valid topologies:

### A. Passive mirror (recommended)
Managed switch with **port mirroring / SPAN**. Mirror the uplink port (router ↔ modem) to a port where the Pi listens. The Pi receives copies — it is *not* in the data path, so it physically cannot bottleneck the link.

```
modem ── router ── managed switch ── LAN devices
                        │ (SPAN mirror of uplink)
                        └── Raspberry Pi (capture only)
```

### B. On-router capture
If your router runs OpenWRT/pfSense, run `tcpdump`/`tshark` directly on its WAN/bridge interface. Same box that already routes, so no extra hop.

### Avoiding load
- Capture **metadata only** — no payload (`-s 96` snaplen, or tshark field extraction). Disk/CPU stay tiny.
- BPF filter to outbound + drop noise: `ip and not net 192.168.0.0/16 and not multicast`.
- Stream to stdout (a pipe), never write pcap to disk.
- tshark emits one line per packet (fields), backend dedups into flows.

## 2. Backend pipeline (Python)

```
tshark stdout ──(ssh / TCP / local pipe)──> reader coroutine
   → dedup (src,dst,proto) within window
   → resolve src device name (static map + DHCP leases)
   → geoip2 City lookup of dst (local .mmdb, in-memory)
   → enqueue flow event
WebSocket broadcaster → all connected dashboards
```

Key choices:
- **asyncio** single process: one task reads the packet stream, one fan-out broadcaster.
- **geoip2** reads the local MaxMind `.mmdb` mmap'd — microsecond lookups, zero network.
- **Dedup window** (e.g. 5 s) collapses chatty flows so the map isn't spammed.
- Private/reserved dst IPs are skipped (no coords).

## 3. Frontend (React + Leaflet)

- `react-leaflet` base map (dark tiles).
- WebSocket client appends incoming flows.
- Each flow draws: a pulsing `CircleMarker` at the destination + an arced `Polyline` from home coords → dst. Fade/remove after a few seconds.
- Home marker fixed at your approximate lat/lng (set in config).

Swap-in alternative: **Kepler.gl** if you want heatmaps / time playback over raw GIS — heavier, React-Redux based. Leaflet is lighter for a live dashboard.

## Data shape (WebSocket message)

```json
{
  "ts": 1717440000.12,
  "src_ip": "192.168.1.42",
  "device": "jake-laptop",
  "dst_ip": "151.101.1.140",
  "proto": "TCP",
  "dport": 443,
  "lat": 37.751,
  "lng": -97.822,
  "city": "Ashburn",
  "country": "US"
}
```
