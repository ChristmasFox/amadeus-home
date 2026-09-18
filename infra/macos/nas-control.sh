#!/bin/zsh
set -euo pipefail

requested_command="${SSH_ORIGINAL_COMMAND:-}"

compact() {
  print -r -- "${1:-}" | /usr/bin/tr '\n' ' ' | /usr/bin/sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

sysctl_value() {
  /usr/sbin/sysctl -n "$1" 2>/dev/null || true
}

humanize_blocks() {
  /usr/bin/awk -v blocks="$1" 'BEGIN {
    value = blocks * 512;
    unit = "B";
    if (value >= 1024) { value /= 1024; unit = "KiB"; }
    if (value >= 1024) { value /= 1024; unit = "MiB"; }
    if (value >= 1024) { value /= 1024; unit = "GiB"; }
    if (value >= 1024) { value /= 1024; unit = "TiB"; }
    if (value >= 1024) { value /= 1024; unit = "PiB"; }
    if (unit == "B" || value >= 100) printf "%.0f%s", value, unit;
    else printf "%.1f%s", value, unit;
  }'
}

disk_summary() {
  local mount="$1"
  local line total_blocks available_blocks used_blocks size used available capacity
  line=$(/bin/df -P "$mount" 2>/dev/null | /usr/bin/tail -n 1 || true)
  if [[ -z "$line" ]]; then
    print 'unavailable'
    return
  fi

  total_blocks=$(print -r -- "$line" | /usr/bin/awk '{print $2}')
  available_blocks=$(print -r -- "$line" | /usr/bin/awk '{print $4}')
  if [[ "$total_blocks" != <-> || "$available_blocks" != <-> ]] || (( total_blocks <= 0 || available_blocks < 0 || available_blocks > total_blocks )); then
    print 'unavailable'
    return
  fi

  # macOS APFS exposes the read-only system snapshot at `/`. Its df `Used`
  # column is only the snapshot usage, while `Avail` is container free space.
  # Derive actual occupied capacity as total blocks minus available blocks.
  used_blocks=$((total_blocks - available_blocks))
  size=$(humanize_blocks "$total_blocks")
  used=$(humanize_blocks "$used_blocks")
  available=$(humanize_blocks "$available_blocks")
  capacity=$(/usr/bin/awk -v used="$used_blocks" -v available="$available_blocks" 'BEGIN {
    total = used + available
    if (total > 0) printf "%.1f%%", used / total * 100
    else print "0.0%"
  }')
  print -r -- "$size|$used|$available|$capacity"
}

case "$requested_command" in
  nas.help)
    print 'nas.status nas.disk nas.sleep'
    ;;
  nas.status)
    os_name=$(compact "$(/usr/bin/sw_vers -productName 2>/dev/null || true)")
    os_version=$(compact "$(/usr/bin/sw_vers -productVersion 2>/dev/null || true)")
    os_build=$(compact "$(/usr/bin/sw_vers -buildVersion 2>/dev/null || true)")
    host=$(compact "$(/usr/sbin/scutil --get ComputerName 2>/dev/null || /bin/hostname)")
    model=$(compact "$(sysctl_value hw.model)")
    physical_cpu=$(compact "$(sysctl_value hw.ncpu)")
    logical_cpu=$(compact "$(sysctl_value hw.logicalcpu)")
    mem_total=$(compact "$(sysctl_value hw.memsize)")
    load_average=$(compact "$(sysctl_value vm.loadavg)" | /usr/bin/sed -E 's/^\{[[:space:]]*//; s/[[:space:]]*\}$//; s/[[:space:]]+/ /g')
    uptime_value=$(compact "$(/usr/bin/uptime 2>/dev/null || true)")
    user_count=$(compact "$(/usr/bin/who 2>/dev/null | /usr/bin/wc -l || true)")
    free_percent=$(compact "$(/usr/bin/memory_pressure -Q 2>/dev/null | /usr/bin/awk '/free percentage/ {gsub(/%/, "", $NF); print $NF; exit}' || true)")
    route_info=$(/sbin/route -n get default 2>/dev/null || true)
    gateway=$(compact "$(print -r -- "$route_info" | /usr/bin/awk '/gateway:/ {print $2; exit}')")
    interface=$(compact "$(print -r -- "$route_info" | /usr/bin/awk '/interface:/ {print $2; exit}')")
    ip_address=''
    for network_interface in en0 en1 en2 en3 en4 en5 en6 en7; do
      candidate=$(/usr/sbin/ipconfig getifaddr "$network_interface" 2>/dev/null || true)
      if [[ -n "$candidate" ]]; then
        ip_address="$candidate"
        [[ -n "$interface" ]] || interface="$network_interface"
        break
      fi
    done
    power_raw=$(/usr/bin/pmset -g batt 2>/dev/null | /usr/bin/tail -n 2 || true)
    power=$(compact "$power_raw")
    power_source=$(compact "$(print -r -- "$power_raw" | /usr/bin/awk -F"'" '/Now drawing from/ {print $2; exit}')")
    battery_line=$(print -r -- "$power_raw" | /usr/bin/awk '/[0-9]+%;/ {print; exit}')
    battery_percent=$(compact "$(print -r -- "$battery_line" | /usr/bin/sed -nE 's/.*[[:space:]]([0-9]+)%;.*/\1%/p')")
    battery_state=$(compact "$(print -r -- "$battery_line" | /usr/bin/sed -nE 's/.*%;[[:space:]]*([^;]+);.*/\1/p')")
    power_remaining=$(compact "$(print -r -- "$battery_line" | /usr/bin/sed -nE 's/.*;[[:space:]]*([0-9:]+) remaining.*/\1/p')")
    if print -r -- "$battery_line" | /usr/bin/grep -q 'present: true'; then
      power_connected='true'
    else
      power_connected='false'
    fi
    if /usr/bin/pgrep -x cloudflared >/dev/null 2>&1; then
      cloudflared='运行中'
    else
      cloudflared='未运行'
    fi

    print 'NAS_STATUS_VERSION=2'
    print "HOST=$(compact "$host")"
    print "OS_NAME=$(compact "$os_name")"
    print "OS_VERSION=$(compact "$os_version")"
    print "OS_BUILD=$(compact "$os_build")"
    print "MODEL=$(compact "$model")"
    print "CPU_PHYSICAL=$(compact "$physical_cpu")"
    print "CPU_LOGICAL=$(compact "$logical_cpu")"
    print "MEM_TOTAL_BYTES=$(compact "$mem_total")"
    print "MEM_FREE_PERCENT=$(compact "$free_percent")"
    print "LOAD_AVERAGE=$(compact "$load_average")"
    print "UPTIME=$(compact "$uptime_value")"
    print "USER_COUNT=$(compact "$user_count")"
    print "DISK_ROOT=$(disk_summary /)"
    print "DISK_AVALON=$(disk_summary /Volumes/Avalon)"
    print "NETWORK_INTERFACE=$(compact "$interface")"
    print "IP_ADDRESS=$(compact "$ip_address")"
    print "GATEWAY=$(compact "$gateway")"
    print "POWER=$(compact "$power")"
    print "POWER_SOURCE=$(compact "$power_source")"
    print "BATTERY_PERCENT=$(compact "$battery_percent")"
    print "BATTERY_STATE=$(compact "$battery_state")"
    print "POWER_REMAINING=$(compact "$power_remaining")"
    print "POWER_CONNECTED=$(compact "$power_connected")"
    print "CLOUDFLARED=$(compact "$cloudflared")"
    /bin/ps -Ao pid=,comm=,%cpu=,%mem= -r 2>/dev/null | /usr/bin/head -n 4 | while IFS= read -r process_line; do
      print "TOP_PROCESS=$(compact "$process_line" | /usr/bin/sed -E 's/[[:space:]]+/|/g')"
    done
    ;;
  nas.disk)
    print "系统盘：$(disk_summary /)"
    print "Avalon：$(disk_summary /Volumes/Avalon)"
    ;;
  nas.sleep)
    /usr/bin/pmset sleepnow
    ;;
  *)
    print -u2 "拒绝未授权命令: ${requested_command:-<empty>}"
    exit 126
    ;;
esac
