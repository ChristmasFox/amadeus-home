#!/usr/bin/env bash
set -Eeuo pipefail

LABEL="${1:?check label is required}"
shift
EVIDENCE_FILE="${VALIDATION_EVIDENCE_FILE:-}"
CACHE_DIR="${VALIDATION_CACHE_DIR:-}"
CACHE_KEY="${VALIDATION_CACHE_KEY:-}"
if [[ -n "$CACHE_DIR" && -n "$CACHE_KEY" ]]; then
  cache_file="$CACHE_DIR/$CACHE_KEY.ok"
  if [[ -f "$cache_file" ]]; then
    printf 'CHECK_REUSED|%s|key=%s\n' "$LABEL" "$CACHE_KEY"
    exit 0
  fi
fi
LOG_FILE="$(mktemp "${TMPDIR:-/tmp}/amadeus-check.XXXXXX")"
cleanup() { rm -f "$LOG_FILE"; }
trap cleanup EXIT
start_ns="$(date +%s%N 2>/dev/null || date +%s000000000)"
redact() {
  sed -E \
    -e 's#((api[_-]?key|access[_-]?token|bot[_-]?token|password|passphrase|secret|credential)[[:space:]]*[:=][[:space:]]*)[^[:space:]]+#\1<redacted>#Ig' \
    -e 's#(Bearer[[:space:]]+)[^[:space:]]+#\1<redacted>#Ig'
}
if "$@" >"$LOG_FILE" 2>&1; then
  end_ns="$(date +%s%N 2>/dev/null || date +%s000000000)"
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  lines="$(wc -l <"$LOG_FILE" | tr -d ' ')"
  printf 'CHECK_PASS|%s|ms=%s|output_lines=%s\n' "$LABEL" "$elapsed_ms" "$lines"
  status=passed
  if [[ -n "${cache_file:-}" ]]; then mkdir -p "$CACHE_DIR"; : >"$cache_file"; fi
else
  code=$?
  end_ns="$(date +%s%N 2>/dev/null || date +%s000000000)"
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  printf 'CHECK_FAIL|%s|exit=%s|ms=%s|diagnostic_tail=80\n' "$LABEL" "$code" "$elapsed_ms" >&2
  redact <"$LOG_FILE" | tail -n 80 >&2
  status=failed
fi
if [[ -n "$EVIDENCE_FILE" ]]; then
  mkdir -p "$(dirname -- "$EVIDENCE_FILE")"
  printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$LABEL" "$status" "${elapsed_ms:-0}" >>"$EVIDENCE_FILE"
fi
[[ "$status" == passed ]]
