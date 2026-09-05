#!/bin/zsh
set -euo pipefail

requested_command="${SSH_ORIGINAL_COMMAND:-}"

case "$requested_command" in
  nas.help)
    print 'nas.status nas.disk nas.sleep'
    ;;
  nas.status)
    print "host=$(scutil --get ComputerName 2>/dev/null || hostname)"
    print "uptime=$(uptime | sed 's/^ *//')"
    print 'disk:'
    /bin/df -h / | tail -n 1
    ;;
  nas.disk)
    /bin/df -h /
    ;;
  nas.sleep)
    /usr/bin/pmset sleepnow
    ;;
  *)
    print -u2 "拒绝未授权命令: ${requested_command:-<empty>}"
    exit 126
    ;;
esac
