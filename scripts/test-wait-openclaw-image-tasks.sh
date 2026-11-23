#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
cat >"$fixture/orb" <<'EOF'
#!/usr/bin/env bash
if [[ "${TEST_MODE:-}" == invalid ]]; then printf 'not json'; exit 0; fi
count=0
[[ -f "$TEST_COUNTER" ]] && count="$(cat "$TEST_COUNTER")"
echo "$((count + 1))" > "$TEST_COUNTER"
if ((count == 0)); then echo '{"tasks":[{"taskKind":"image_generation"}]}'; else echo '{"tasks":[]}'; fi
EOF
chmod +x "$fixture/orb"
export PATH="$fixture:$PATH" TEST_COUNTER="$fixture/count" LAB_IMAGE_DRAIN_DELAY_SECONDS=0 LAB_IMAGE_DRAIN_ATTEMPTS=2
bash "$root/scripts/wait-openclaw-image-tasks.sh" fixture >/dev/null
[[ "$(cat "$TEST_COUNTER")" == 2 ]]
if TEST_MODE=invalid bash "$root/scripts/wait-openclaw-image-tasks.sh" fixture >/dev/null 2>&1; then exit 1; fi
echo 'Image-generation drain tests passed'
