# Qwen Image Lab

The local bridge and `sd-server` bind only to loopback ports 18793 and 18795.
The bridge validates the pinned model, patched stable-diffusion.cpp binary and
Fun-Acc/PDD adapter before listening. It admits one active request and one
bounded waiter. A request selects `quality` or `fast`; the bridge stops the
current `sd-server` before starting the other profile, so at most one model
process is resident.

`infra/macos/qwen-image-engine.json` pins Quality: Qwen-Image-2.1 base model,
16 steps, CFG 1 and Metal. `infra/macos/qwen-image-fast-engine.json` pins Fast:
the real Alibaba Fun-Acc/PDD adapter, four steps, CFG 1, the trained custom
sigma grid, q8_0 prefix caching with the runtime's auto behavior if q8_0 cannot
initialize, mmap, Flash Attention and a 900-second idle lease. The browser
cannot select either engine's internal parameters.

Text-to-image generation accepts `1024x1024`, `1024x768` and `768x1024`.
Single-reference edits automatically use the reference geometry when it meets
the model's 32px alignment, 1024px edge and 1MP limits; otherwise the bridge
scales it proportionally to fit. Reference bytes and MIME are preserved. Seed
`-1` becomes a server-generated seed; the result and task history display the
effective seed and actual output dimensions. Edit strength is set internally to
1.0, and prompt-injected engine arguments are rejected. Generation has a
900-second bridge deadline and a 910-second UI proxy deadline; model loading
retains its separate 600-second deadline.

Model assets remain under `/Volumes/Avalon/models`; their paths, revisions,
byte counts and hashes are pinned in the two engine JSON files. Apply local
service changes with the Mac-only manager:

```sh
infra/macos/manage-qwen-image.sh --dry-run
infra/macos/manage-qwen-image.sh --restart --apply
```

## LAN and public UI

`infra/macos/manage-qwen-image-debug-ui.sh` manages the lightweight UI on port
18798. Private and loopback Host/client pairs keep no-login LAN access. The
exact public Host `image.nyannyan.top` requires the password-only login and a
server-side 12-hour session. The scrypt verifier belongs at
`~/Library/Application Support/Amadeus/secrets/qwen-image-lab-auth.json`, mode
`0600`; provision it with `infra/macos/provision-qwen-image-public-auth.py`
from a protected password source on stdin. The plaintext password is never
part of repository files, HTML, logs, checkpoints or proxy configuration.

The public route is limited to the UI on TCP 18798 through HomeLab frpc,
`amadeus-gateway` frps and VPS Caddy. The bridge and model engine are never
forwarded. Caddy terminates TLS for `https://image.nyannyan.top`; the
application owns password authentication, exact Host/Origin validation and
session cookies. Arbitrary `X-Forwarded-*` headers are ignored.

Run `infra/macos/manage-qwen-image-debug-ui.sh` for a dry-run, then pass
`--apply` to install/start or update the LaunchAgent. Use `--status` to inspect
and `--stop --apply` to stop. Keep the public port out of router forwards; frp
is the only remote path. Same-origin writes are required for both LAN and
public sessions, with the public origin fixed to the exact HTTPS hostname.

The UI supports PNG, JPEG and WebP references up to 10 MB, one generation/edit
request at a time, a prompt, profile and seed. Resolution is selectable for
generation and automatic for edits. Task-history images open in a modal without
replacing the current result preview. Task history shows the profile, actual
output resolution, effective seed, elapsed time and a safe failure summary. It
is held in UI process memory. Successful PNGs are
automatically saved under `~/Pictures/Amadeus/QwenImage` with files mode `0600`
and directory mode `0700`; public task responses do not disclose local paths.
