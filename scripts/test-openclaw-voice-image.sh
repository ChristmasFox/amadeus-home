#!/usr/bin/env bash
# No live Gateway, channel or secret is touched. Exercise child process ABI.
set -Eeuo pipefail
MODE=dry-run
IMAGE=""
while (($#)); do
  case "$1" in
    --dry-run) MODE=dry-run ;;
    --apply) MODE=apply ;;
    --image) shift; IMAGE="${1:?--image requires a tag}" ;;
    --help|-h) echo 'Usage: scripts/test-openclaw-voice-image.sh --image IMAGE [--dry-run|--apply]'; exit 0 ;;
    *) echo "Unexpected argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[[ -n "$IMAGE" ]] || { echo '--image required' >&2; exit 2; }
printf 'MODE=%s\nIMAGE=%s\n' "$MODE" "$IMAGE"
if [[ "$MODE" == dry-run ]]; then
  echo 'PLAN=network-none Node/Longbridge import and ffmpeg child MP3->Ogg/Opus, no live data'
  exit 0
fi
docker --context orbstack image inspect "$IMAGE" >/dev/null
docker --context orbstack run --rm --network none --workdir /app/dist/extensions/amadeus \
  --entrypoint /usr/local/bin/node "$IMAGE" -e '
const {spawnSync}=require("node:child_process");
if(!process.env.LD_LIBRARY_PATH || !process.execPath.endsWith("/node.glibc")) throw new Error("node_worker_exec_path_changed");
const worker=spawnSync(process.execPath,["-e",`process.stdout.write("worker-ready")`],{encoding:"utf8"});
if(worker.status!==0 || worker.stdout!=="worker-ready") throw new Error("node_worker_spawn_failed");
import("longbridge").then(sdk=>{
  if(!sdk || !Object.keys(sdk).length) throw new Error("longbridge_import_failed");
  const src=spawnSync("/usr/bin/ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","anullsrc=r=24000:cl=mono","-t","1","-f","mp3","pipe:1"],{maxBuffer:2*1024*1024});
  if(src.status!==0||!src.stdout?.length) throw new Error("mp3_fixture_failed");
  const out=spawnSync("/usr/bin/ffmpeg",["-hide_banner","-loglevel","error","-nostdin","-f","mp3","-i","pipe:0","-ac","1","-ar","48000","-c:a","libopus","-b:a","64k","-f","opus","pipe:1"],{input:src.stdout,maxBuffer:2*1024*1024});
  if(out.status!==0||!out.stdout?.subarray(0,4).equals(Buffer.from("OggS"))) throw new Error("opus_child_failed");
  const probe=spawnSync("/usr/bin/ffprobe",["-hide_banner","-version"],{encoding:"utf8"});
  if(probe.status!==0) throw new Error("ffprobe_child_failed");
  console.log("PRIVATE_NODE_WORKERS=passed");
  console.log("LONGBRIDGE_BINDING=passed");
  console.log("CHILD_FFMPEG_OPUS=passed");
  console.log("CHILD_FFPROBE=passed");
}).catch(e=>{console.error("VOICE_IMAGE_FIXTURE_FAILED="+e.message);process.exitCode=1});'
