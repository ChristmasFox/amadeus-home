#!/bin/sh
set -eu

# This probe is intentionally argument-free and read-only. Install it as
# /usr/local/sbin/amadeus-vps-readonly-probe and use it as the forced command
# for the dedicated Amadeus SSH public key.
printf 'VPS_PROBE_VERSION=1\n'
printf 'VPS_SERVICES_PROBE_VERSION=1\n'
printf 'HOSTNAME='
hostname 2>/dev/null || true
printf 'UPTIME_SECONDS='
awk '{print int($1)}' /proc/uptime 2>/dev/null || true
printf 'UPTIME_TEXT='
uptime -p 2>/dev/null || true
printf 'LOAD_AVERAGE='
awk '{print $1, $2, $3}' /proc/loadavg 2>/dev/null || true
awk '/^MemTotal:/{total=$2*1024} /^MemAvailable:/{available=$2*1024} END{printf "MEMORY_BYTES=%d %d\n", available, total}' /proc/meminfo 2>/dev/null || true
df -P -B1 / 2>/dev/null | awk 'NR==2{gsub("%","",$5); printf "ROOTFS=%s %s %s %s %s\n", $1, $2, $3, $4, $5}' || true

for unit in caddy.service xray.service hysteria-server.service frps.service; do
  active="$(systemctl is-active "$unit" 2>/dev/null || true)"
  enabled="$(systemctl is-enabled "$unit" 2>/dev/null || true)"
  printf 'SERVICE\t%s\t%s\t%s\n' "$unit" "$active" "$enabled"
done
