#!/usr/bin/env python3
"""
networktracker backend.

Reads a tshark CSV packet stream (launched locally, or piped via --stdin),
dedups flows, resolves device names, geolocates destination IPs against a
local MaxMind GeoLite2 City database, and broadcasts flow events over WebSocket.

CSV line format (from capture/capture.sh):
    epoch,src_ip,dst_ip,proto,tcp_dport,udp_dport
"""
import argparse
import asyncio
import ipaddress
import json
import random
import sys
import time
import urllib.request
from pathlib import Path

import websockets

try:
    import geoip2.database
    import geoip2.errors
except ImportError:
    geoip2 = None     # only needed for real capture mode

CONFIG = {}
GEO = None            # geoip2 Reader (None in demo mode)
CLIENTS = set()       # connected websockets
DEDUP = {}            # (src,dst,proto) -> last_seen_epoch
HOME = None           # {"lat","lng","city","country","ip"} resolved at startup


def resolve_home():
    """Find this network's public IP + its coords. No API key needed.

    Tries ip-api.com (returns IP + geo in one call). Falls back to config.home.
    """
    try:
        with urllib.request.urlopen("http://ip-api.com/json/", timeout=5) as r:
            d = json.loads(r.read().decode())
        if d.get("status") == "success":
            return {
                "lat": d["lat"], "lng": d["lon"],
                "city": d.get("city", ""), "country": d.get("countryCode", ""),
                "ip": d.get("query", ""),
            }
    except Exception as e:
        print(f"home IP geolocation failed ({e}); using config.home", file=sys.stderr)
    h = CONFIG.get("home", {"lat": 0, "lng": 0})
    return {"lat": h.get("lat", 0), "lng": h.get("lng", 0),
            "city": "", "country": "", "ip": ""}

# Bundled demo destinations (no MaxMind DB needed). Stable IP per endpoint so
# nodes accumulate instead of scattering. ip, host, lat, lng, city, country.
DEMO_DESTS = [
    ("151.101.1.140", "fastly-cdn", 37.751, -97.822, "Ashburn", "US"),
    ("142.250.72.110", "google", 37.4419, -122.1430, "Mountain View", "US"),
    ("13.107.42.14", "microsoft", 47.6062, -122.3321, "Seattle", "US"),
    ("104.244.42.65", "twitter", 35.6762, 139.6503, "Tokyo", "JP"),
    ("157.240.22.35", "facebook", 52.3676, 4.9041, "Amsterdam", "NL"),
    ("99.84.0.10", "cloudfront", 1.3521, 103.8198, "Singapore", "SG"),
    ("18.165.83.20", "aws", -33.8688, 151.2093, "Sydney", "AU"),
    ("140.82.121.4", "github", 50.1109, 8.6821, "Frankfurt", "DE"),
    ("8.8.8.8", "dns-google", 19.0760, 72.8777, "Mumbai", "IN"),
    ("1.1.1.1", "dns-cloudflare", 48.8566, 2.3522, "Paris", "FR"),
    ("23.45.0.50", "akamai", -23.5505, -46.6333, "Sao Paulo", "BR"),
    ("185.199.108.0", "cdn", 51.5074, -0.1278, "London", "GB"),
]
DEMO_PROTOS = [("TCP", "443"), ("TCP", "80"), ("UDP", "443"), ("TCP", "853"), ("UDP", "53")]


def load_config(path):
    global CONFIG
    p = Path(path)
    if not p.exists():
        # fall back to the example config so demo mode runs with zero setup
        example = p.parent / "config.example.json"
        p = example if example.exists() else p
    CONFIG = json.loads(p.read_text()) if p.exists() else {}


def geo_lookup(ip):
    """Return (lat, lng, city, country) or None for private/unknown IPs."""
    try:
        if ipaddress.ip_address(ip).is_private:
            return None
    except ValueError:
        return None
    try:
        r = GEO.city(ip)
        if r.location.latitude is None:
            return None
        return (r.location.latitude, r.location.longitude,
                r.city.name or "", r.country.iso_code or "")
    except geoip2.errors.AddressNotFoundError:
        return None


def make_event(epoch, src, dst, proto, dport):
    """Build a flow event dict, or None if it should be dropped/deduped."""
    geo = geo_lookup(dst)
    if geo is None:
        return None

    key = (src, dst, proto)
    now = epoch
    window = CONFIG.get("dedup_window_sec", 5)
    last = DEDUP.get(key)
    if last is not None and now - last < window:
        return None
    DEDUP[key] = now

    lat, lng, city, country = geo
    return {
        "type": "flow",
        "ts": epoch,
        "src_ip": src,
        "device": CONFIG.get("devices", {}).get(src, src),
        "dst_ip": dst,
        "proto": proto,
        "dport": dport,
        "lat": lat,
        "lng": lng,
        "city": city,
        "country": country,
    }


def parse_line(line):
    """Parse one tshark CSV line -> event dict or None."""
    parts = line.rstrip("\n").split(",")
    if len(parts) < 6:
        return None
    epoch_s, src, dst, proto, tcp_dport, udp_dport = parts[:6]
    if not src or not dst:
        return None
    try:
        epoch = float(epoch_s)
    except ValueError:
        epoch = time.time()
    dport = tcp_dport or udp_dport or ""
    return make_event(epoch, src, dst, proto or "IP", dport)


async def broadcast(event):
    if not CLIENTS:
        return
    msg = json.dumps(event)
    await asyncio.gather(
        *(c.send(msg) for c in list(CLIENTS)),
        return_exceptions=True,
    )


async def ws_handler(ws):
    CLIENTS.add(ws)
    try:
        if HOME:
            await ws.send(json.dumps({"type": "home", **HOME}))
        async for _ in ws:        # ignore client messages
            pass
    finally:
        CLIENTS.discard(ws)


async def pump(stream):
    """Read packet lines from an async stream and broadcast events."""
    while True:
        line = await stream.readline()
        if not line:
            break
        event = parse_line(line.decode("utf-8", "replace"))
        if event:
            await broadcast(event)


async def run_tshark():
    """Launch capture.sh locally and stream its stdout."""
    script = str(Path(__file__).resolve().parent.parent / "capture" / "capture.sh")
    proc = await asyncio.create_subprocess_exec(
        "bash", script, CONFIG.get("iface", "eth0"),
        stdout=asyncio.subprocess.PIPE,
    )
    await pump(proc.stdout)


DEMO_DEVICES = {
    "192.168.1.42": "jake-laptop",
    "192.168.1.10": "nas",
    "192.168.1.20": "living-room-tv",
    "192.168.1.55": "jake-iphone",
    "192.168.1.56": "sarah-iphone",
    "192.168.1.70": "echo-dot",
    "192.168.1.71": "nest-thermostat",
    "192.168.1.72": "ring-doorbell",
    "192.168.1.80": "ps5",
    "192.168.1.90": "work-macbook",
}


async def run_demo():
    """Emit synthetic flows so the map populates without tshark or a GeoIP DB."""
    devices = DEMO_DEVICES   # demo is synthetic; ignore real config device map
    src_ips = list(devices.keys())
    print("DEMO MODE: emitting synthetic flows", file=sys.stderr)
    while True:
        src = random.choice(src_ips)
        ip, host, lat, lng, city, country = random.choice(DEMO_DESTS)
        proto, dport = random.choice(DEMO_PROTOS)
        event = {
            "type": "flow",
            "ts": time.time(),
            "src_ip": src,
            "device": devices[src],
            "dst_ip": ip,
            "dst_host": host,
            "proto": proto,
            "dport": dport,
            "lat": lat,
            "lng": lng,
            "city": city,
            "country": country,
        }
        await broadcast(event)
        await asyncio.sleep(random.uniform(0.3, 1.2))


async def run_stdin():
    """Read the packet stream piped into stdin (capture node over ssh)."""
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(
        lambda: asyncio.StreamReaderProtocol(reader), sys.stdin
    )
    await pump(reader)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--stdin", action="store_true",
                    help="read packet stream from stdin instead of launching tshark")
    ap.add_argument("--demo", action="store_true",
                    help="emit synthetic flows (no tshark/GeoIP DB needed)")
    args = ap.parse_args()

    load_config(args.config)

    global GEO
    if not args.demo:
        if geoip2 is None:
            sys.exit("geoip2 not installed; run `pip install -r requirements.txt` "
                     "or use --demo")
        mmdb = CONFIG.get("mmdb_path", "GeoLite2-City.mmdb")
        if not Path(mmdb).exists():
            sys.exit(f"GeoIP DB not found at {mmdb}. Download GeoLite2-City.mmdb "
                     f"from MaxMind, or run with --demo.")
        GEO = geoip2.database.Reader(mmdb)

    global HOME
    HOME = await asyncio.get_running_loop().run_in_executor(None, resolve_home)
    print(f"home: {HOME['city']} {HOME['country']} ({HOME['ip']}) "
          f"@ {HOME['lat']},{HOME['lng']}", file=sys.stderr)

    host, port = CONFIG.get("ws_host", "0.0.0.0"), CONFIG.get("ws_port", 8765)
    async with websockets.serve(ws_handler, host, port):
        print(f"WebSocket up on ws://{host}:{port}", file=sys.stderr)
        if args.demo:
            source = run_demo()
        elif args.stdin:
            source = run_stdin()
        else:
            source = run_tshark()
        await source


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
