#!/usr/bin/env bash
set -Eeuo pipefail
machine="${1:?machine required}"
attempts="${LAB_IMAGE_DRAIN_ATTEMPTS:-360}"
delay="${LAB_IMAGE_DRAIN_DELAY_SECONDS:-5}"
[[ "$attempts" =~ ^[1-9][0-9]*$ && "$delay" =~ ^[0-9]+$ ]] || exit 2
for ((attempt=1; attempt<=attempts; attempt++)); do
  running="$(orb -m "$machine" -u root docker exec openclaw node /app/dist/index.js tasks list --json --status running \
    | python3 -c 'import json,sys; value=json.load(sys.stdin); tasks=value["tasks"]; assert isinstance(tasks,list); print(sum(1 for task in tasks if task.get("taskKind") == "image_generation"))')" || {
      echo 'Cannot verify image-generation task state.' >&2; exit 1;
    }
  [[ "$running" =~ ^[0-9]+$ ]] || exit 1
  if ((running == 0)); then echo 'IMAGE_GENERATION_TASKS=idle'; exit 0; fi
  sleep "$delay"
done
echo 'Image-generation tasks did not finish; router switch cancelled.' >&2
exit 1
