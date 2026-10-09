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

# Read one fixed, sanitized file. The forced-command account has no database
# access and cannot supply a path, account, SQL fragment, or shell command.
python3 - <<'PY'
import json
import re
from pathlib import Path

snapshot_path = Path('/var/lib/amadeus-accounting/subscription-usage-public.json')
account_ids = [f'Labmem{i:03d}' for i in range(1, 6)] + ['M204-Net-Core']
protocol_ids = ('hy2', 'vless')
source_ids = ('provider', 'hysteria_traffic', 'hysteria_online', 'xray', 'xray_online', 'reality_fallback')

def count(value):
    return value if type(value) is int and value >= 0 else None

def timestamp(value):
    if isinstance(value, str) and len(value) <= 64 and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)', value):
        return value
    return None

def protocol(value):
    if not isinstance(value, dict):
        value = {}
    status = value.get('status') if value.get('status') in ('ok', 'stale', 'error', 'unknown') else 'unknown'
    return {
        'uploadBytes': count(value.get('uploadBytes')),
        'downloadBytes': count(value.get('downloadBytes')),
        'totalBytes': count(value.get('totalBytes')),
        'lastCounterSampleAt': timestamp(value.get('lastCounterSampleAt')),
        'status': status,
        'onlineCount': count(value.get('onlineCount')),
        'onlineCountKind': value.get('onlineCountKind') if value.get('onlineCountKind') in ('client_instances', 'unique_source_ips') else None,
        'onlineStatus': value.get('onlineStatus') if value.get('onlineStatus') in ('ok', 'stale', 'error', 'unknown') else 'unknown',
        'onlineSampledAt': timestamp(value.get('onlineSampledAt')),
        'windowBytes': count(value.get('windowBytes')),
        'windowSampleCount': count(value.get('windowSampleCount')) or 0,
    }

def account(value, expected_id):
    if not isinstance(value, dict) or value.get('accountId') != expected_id:
        return None
    protocols = value.get('protocols') if isinstance(value.get('protocols'), dict) else {}
    return {
        'accountId': expected_id,
        'enabled': value.get('enabled') is True,
        'protocols': {p: protocol(protocols.get(p)) for p in protocol_ids},
        'totalMonitoredBytes': count(value.get('totalMonitoredBytes')),
        'knownMonitoredBytes': count(value.get('knownMonitoredBytes')),
        'totalsComplete': value.get('totalsComplete') is True,
        'windowBytes': count(value.get('windowBytes')),
        'windowComplete': value.get('windowComplete') is True,
    }

try:
    raw = json.loads(snapshot_path.read_text(encoding='utf-8'))
    if not isinstance(raw, dict):
        raise ValueError
    rows = raw.get('accounts')
    if not isinstance(rows, list):
        raise ValueError
    by_id = {row.get('accountId'): row for row in rows if isinstance(row, dict)}
    if set(by_id) != set(account_ids):
        raise ValueError
    accounts = [account(by_id[key], key) for key in account_ids]
    legacy = account(raw.get('legacy'), 'legacy')
    if legacy is None or any(item is None for item in accounts):
        raise ValueError
    sources_in = raw.get('sources') if isinstance(raw.get('sources'), dict) else {}
    sources = {}
    for name in source_ids:
        value = sources_in.get(name) if isinstance(sources_in.get(name), dict) else {}
        status = value.get('status') if value.get('status') in ('ok', 'stale', 'error', 'unknown') else 'unknown'
        error_code = value.get('errorCode') if value.get('errorCode') in ('unreachable', 'invalid_response', 'timeout', 'unavailable', 'unsupported_version') else None
        sources[name] = {
            'status': status,
            'checkedAt': timestamp(value.get('checkedAt')),
            'lastSuccessfulAt': timestamp(value.get('lastSuccessfulAt')),
            'lastErrorAt': timestamp(value.get('lastErrorAt')),
            'errorCode': error_code,
        }
    security_in = raw.get('security') if isinstance(raw.get('security'), dict) else {}
    fallback_in = security_in.get('realityFallback') if isinstance(security_in.get('realityFallback'), dict) else {}
    auth_in = security_in.get('hysteriaAuth') if isinstance(security_in.get('hysteriaAuth'), dict) else {}
    security_statuses = ('ok', 'stale', 'error', 'unknown')
    fallback_status = fallback_in.get('status') if fallback_in.get('status') in security_statuses else 'unknown'
    auth_status = auth_in.get('status') if auth_in.get('status') in security_statuses else 'unknown'
    limiter_mode = auth_in.get('limiterMode') if auth_in.get('limiterMode') in ('telemetry', 'enforce') else 'unknown'
    allowed_signal_codes = {
        'hy2_auth_failures', 'hy2_auth_rate_limited',
        'reality_fallback_traffic', 'account_dominant_window',
    }
    signals_in = security_in.get('signals') if isinstance(security_in.get('signals'), list) else []
    signals = []
    for signal in signals_in[:16]:
        if not isinstance(signal, dict) or signal.get('code') not in allowed_signal_codes:
            continue
        clean_signal = {'code': signal['code']}
        if signal['code'] == 'account_dominant_window' and signal.get('accountId') in account_ids:
            clean_signal['accountId'] = signal['accountId']
            clean_signal['sharePercent'] = count(signal.get('sharePercent'))
            clean_signal['thresholdPercent'] = count(signal.get('thresholdPercent'))
            clean_signal['windowBytes'] = count(signal.get('windowBytes'))
        else:
            clean_signal['value'] = count(signal.get('value'))
            clean_signal['threshold'] = count(signal.get('threshold'))
        signals.append(clean_signal)
    security = {
        'realityFallback': {
            'uplinkBytes': count(fallback_in.get('uplinkBytes')),
            'downlinkBytes': count(fallback_in.get('downlinkBytes')),
            'totalBytes': count(fallback_in.get('totalBytes')),
            'windowUplinkBytes': count(fallback_in.get('windowUplinkBytes')),
            'windowDownlinkBytes': count(fallback_in.get('windowDownlinkBytes')),
            'windowTotalBytes': count(fallback_in.get('windowTotalBytes')),
            'lastCounterSampleAt': timestamp(fallback_in.get('lastCounterSampleAt')),
            'status': fallback_status,
            'checkedAt': timestamp(fallback_in.get('checkedAt')),
            'lastSuccessfulAt': timestamp(fallback_in.get('lastSuccessfulAt')),
        },
        'hysteriaAuth': {
            'status': auth_status,
            'windowSeconds': count(auth_in.get('windowSeconds')),
            'authFailuresWindow': count(auth_in.get('authFailuresWindow')),
            'authRateLimitedWindow': count(auth_in.get('authRateLimitedWindow')),
            'limiterMode': limiter_mode,
            'limiterWindowSeconds': count(auth_in.get('limiterWindowSeconds')),
            'limiterWindowCoverageSeconds': count(auth_in.get('limiterWindowCoverageSeconds')),
            'authFailuresLimiterWindow': count(auth_in.get('authFailuresLimiterWindow')),
            'authRateLimitedLimiterWindow': count(auth_in.get('authRateLimitedLimiterWindow')),
            'uniqueFailureSourcesWindowApproximate': count(auth_in.get('uniqueFailureSourcesWindowApproximate')),
            'uniqueFailureSourcesWindowSeconds': count(auth_in.get('uniqueFailureSourcesWindowSeconds')),
            'trackingCapacityReached': auth_in.get('trackingCapacityReached') is True,
            'processStartedAt': timestamp(auth_in.get('processStartedAt')),
            'lastFailureAt': timestamp(auth_in.get('lastFailureAt')),
        },
        'signals': signals,
    }
    provider_in = raw.get('provider') if isinstance(raw.get('provider'), dict) else {}
    provider = {
        'baselineCounterBytes': count(provider_in.get('baselineCounterBytes')),
        'lastCounterBytes': count(provider_in.get('lastCounterBytes')),
        'deltaSinceMonitoringStartBytes': count(provider_in.get('deltaSinceMonitoringStartBytes')),
        'totalBytes': count(provider_in.get('totalBytes')),
        'resetAt': timestamp(provider_in.get('resetAt')),
        'sampledAt': timestamp(provider_in.get('sampledAt')),
    }
    window_in = raw.get('reportWindow') if isinstance(raw.get('reportWindow'), dict) else {}
    top_in = window_in.get('topAccount') if isinstance(window_in.get('topAccount'), dict) else None
    top = None
    if top_in and top_in.get('accountId') in (*account_ids, 'legacy') and count(top_in.get('windowBytes')) is not None:
        top = {'accountId': top_in['accountId'], 'windowBytes': count(top_in['windowBytes'])}
    result = {
        'generatedAt': timestamp(raw.get('generatedAt')),
        'monitoringStartedAt': timestamp(raw.get('monitoringStartedAt')),
        'accounts': accounts,
        'legacy': legacy,
        'protocolTotals': {
            p: {
                'knownBytes': count((raw.get('protocolTotals') or {}).get(p, {}).get('knownBytes')),
                'observedAccounts': count((raw.get('protocolTotals') or {}).get(p, {}).get('observedAccounts')),
                'complete': (raw.get('protocolTotals') or {}).get(p, {}).get('complete') is True,
                'source': sources['hysteria_traffic' if p == 'hy2' else 'xray'],
            } for p in protocol_ids
        },
        'knownProxyAccountedBytes': count(raw.get('knownProxyAccountedBytes')),
        'proxyAccountedBytes': count(raw.get('proxyAccountedBytes')),
        'proxyAccountedComplete': raw.get('proxyAccountedComplete') is True,
        'sources': sources,
        'reportWindow': {
            'seconds': count(window_in.get('seconds')),
            'startAt': timestamp(window_in.get('startAt')),
            'endAt': timestamp(window_in.get('endAt')),
            'topAccount': top,
        },
        'provider': provider,
        'reconciliation': {
            'status': 'calibrated' if isinstance(raw.get('reconciliation'), dict) and raw['reconciliation'].get('status') == 'calibrated' else 'uncalibrated',
            'providerDeltaBytes': provider['deltaSinceMonitoringStartBytes'],
            'proxyAccountedBytes': count(raw.get('proxyAccountedBytes')),
            'gapBytes': count((raw.get('reconciliation') or {}).get('gapBytes')) if (raw.get('reconciliation') or {}).get('status') == 'calibrated' else None,
        },
        'security': security,
    }
    encoded = json.dumps(result, separators=(',', ':'), ensure_ascii=False)
    if len(encoded) > 64000:
        raise ValueError
    print('ACCOUNTING_SNAPSHOT_JSON=' + encoded)
except Exception:
    print('ACCOUNTING_STATUS=unavailable')
PY
