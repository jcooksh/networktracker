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
import sys
import time
from pathlib import Path

import geoip2.database
import websockets

CONFIG = {}
GEO = None            # geoip2 Reader
CLIENTS = set()       # connected websockets
DEDUP = {}            # (src,dst,proto) -> last_seen_epoch


def load_config(path):
    global CONFIG
    CONFIG = json.loads(Path(path).read_text())


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
    args = ap.parse_args()

    load_config(args.config)
    global GEO
    GEO = geoip2.database.Reader(CONFIG["mmdb_path"])

    host, port = CONFIG.get("ws_host", "0.0.0.0"), CONFIG.get("ws_port", 8765)
    async with websockets.serve(ws_handler, host, port):
        print(f"WebSocket up on ws://{host}:{port}", file=sys.stderr)
        source = run_stdin() if args.stdin else run_tshark()
        await source


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
