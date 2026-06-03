#!/usr/bin/env bash
# Usage: ./capture.sh <iface>
# Emits CSV: epoch,src_ip,dst_ip,proto,dport  — one line per packet.
# Metadata only (snaplen 96), filtered to outbound IPv4, no payload to disk.
set -euo pipefail
IFACE="${1:-eth0}"

# BPF: IPv4 only, drop LAN-internal (RFC1918) sources->dests and multicast.
BPF='ip and not (dst net 192.168.0.0/16 or dst net 10.0.0.0/8 or dst net 172.16.0.0/12) and not multicast'

exec tshark -i "$IFACE" -s 96 -l -n -q \
  -f "$BPF" \
  -T fields \
  -e frame.time_epoch \
  -e ip.src \
  -e ip.dst \
  -e _ws.col.Protocol \
  -e tcp.dstport -e udp.dstport \
  -E separator=, -E quote=n
