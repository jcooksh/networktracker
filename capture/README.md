# Capture node

Run on a Raspberry Pi attached to a SPAN/mirror port, or directly on an OpenWRT/pfSense router.

## Install
```bash
sudo apt update && sudo apt install -y tshark   # Debian/Pi OS
# allow non-root capture:
sudo dpkg-reconfigure wireshark-common   # answer "Yes"
sudo usermod -aG wireshark $USER          # re-login after
```

## Run capture, pipe to backend

`capture.sh` emits one CSV line per packet on stdout. Pipe it to the backend over SSH (so capture node and backend can be separate boxes):

```bash
# on capture node, send to backend via ssh:
./capture.sh eth0 | ssh user@backend-host 'python3 /path/to/backend/server.py --stdin'
```

Or, if backend runs on the same box, the backend launches tshark itself (default — see `backend/server.py`). In that case you don't run `capture.sh` manually.

## Why no bottleneck
- Pi is on a **mirror port** → passive copy, not inline.
- `-s 96` snaplen + field extraction → metadata only, no payload buffering.
- BPF filter drops LAN-internal + multicast noise before userspace.
