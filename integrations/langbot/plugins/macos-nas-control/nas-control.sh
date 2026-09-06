#!/bin/zsh
set -euo pipefail

requested_command="${SSH_ORIGINAL_COMMAND:-}"

compact() {
  print -r -- "${1:-}" | /usr/bin/tr '\n' ' ' | /usr/bin/sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

sysctl_value() {
  /usr/sbin/sysctl -n "$1" 2>/dev/null || true
}

disk_summary() {
  local mount="$1"
  local line
  line=$(/bin/df -Ph "$mount" 2>/dev/null | /usr/bin/tail -n 1 || true)
  if [[ -z "$line" ]]; then
    print 'unavailable'
  else
    print -r -- "$line" | /usr/bin/awk '{printf "%s|%s|%s|%s", $2, $3, $4, $5}'
  fi
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
    power=$(compact "$(/usr/bin/pmset -g batt 2>/dev/null | /usr/bin/tail -n 2 || true)")
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
