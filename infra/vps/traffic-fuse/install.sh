#!/usr/bin/env bash
# Root-only runtime install of the traffic fuse on amadeus-gateway.
# Run on the VPS from a staged copy of infra/vps (traffic-fuse/ and systemd/).
# Installs and enables the sampling timer and the midnight release timer with
# autoApply=false; the rescue units are installed but never enabled (armed by hand).
set -euo pipefail
src="${1:?usage: install.sh <staged-infra-vps-dir> [interface]}"
iface="${2:-eth0}"
lib=/usr/local/libexec/amadeus-vps-traffic-fuse
state=/var/lib/amadeus-traffic-fuse
getent group amadeus-accounting-snapshot >/dev/null
install -d -m 0755 -o root -g root "$lib" /etc/amadeus
install -m 0755 -o root -g root "$src/traffic-fuse/traffic_fuse.py" "$src/traffic-fuse/tc_helper.py" "$lib/"
install -d -m 2750 -o root -g amadeus-accounting-snapshot "$state"
if [ ! -e /etc/amadeus/traffic-fuse.json ]; then
  python3 - "$src/traffic-fuse/traffic-fuse.json.example" "$iface" <<'PY'
import json, sys
config = json.load(open(sys.argv[1]))
config["interface"] = sys.argv[2]
open("/etc/amadeus/traffic-fuse.json", "w").write(json.dumps(config, indent=2) + "\n")
PY
  chown root:root /etc/amadeus/traffic-fuse.json
  chmod 0644 /etc/amadeus/traffic-fuse.json
fi
for unit in amadeus-vps-traffic-fuse.service amadeus-vps-traffic-fuse.timer amadeus-vps-traffic-fuse-release.service amadeus-vps-traffic-fuse-release.timer amadeus-vps-traffic-fuse-rescue.service amadeus-vps-traffic-fuse-rescue.timer; do
  install -m 0644 -o root -g root "$src/systemd/$unit.example" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now amadeus-vps-traffic-fuse.timer amadeus-vps-traffic-fuse-release.timer
