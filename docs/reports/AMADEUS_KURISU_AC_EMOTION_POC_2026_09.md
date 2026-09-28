# Amadeus Kurisu A/C Emotion PoC — 2026-09-28

Status: **execution complete; `pending_owner_listening`**.

This is an isolated listening comparison. The production `com.amadeus.qwen3-tts`
service, its profile, routing, port, and LaunchAgent were not changed.

## Fixed comparison

- Target: the exact Japanese sentence in `experiments/kurisu-ac-emotion-poc/config.json`.
- Target UTF-8 length: 348 bytes.
- Accepted Kurisu reference: same production asset for A0 and C; SHA-256
  `fb1ed35df7a872cea3e12d77546e9d7ba885df562214d320007b5e5d1b4482fa`.
- A0: current production `qwen3-tts-1.7b`, Kurisu `kurisu-v1`, accepted Base
  1.7B MLX ICL/reference path.
- C0–C5: OminiX MLX `qwen3-tts-mlx` Base x-vector clone path, upstream commit
  `4988a3fcfa48b8cb5d0780a501b92c6a41401523`, using
  `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit` at revision
  `e7dd0585652209fa0d7783659aad4e8a324de11c`. C seed: `424242`; language:
  Japanese. C1–C5 used the fixed instruct strings in the experiment config.
- All C samples use Base clone/clone+instruct APIs. No CustomVoice path was used.
- Final policy for all samples: mono, 24 kHz MP3, 96 kbps, no loudness
  normalization. C WAV-to-MP3 encoding used `ffmpeg libmp3lame`.

## Objective metrics

`RTF = synthesis wall seconds / source waveform duration seconds`. The duration
column is `source -> final MP3`; encode time is post-synthesis and excluded from
RTF.

| ID | Path / conditioning | Source s | Final s | Synth wall ms | Encode ms | RTF | Final SHA-256 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| A0 | production Base 1.7B ICL/reference | 16.640 | 16.704 | 10,345.3 | 158 | 0.622 | `c2660b83ed72b40a61802c2d7292627ce07f6af8cee60174ebdb91ab8e6c0ac5` |
| C0 | Base x-vector, neutral | 18.240 | 18.288 | 9,357.1 | 61.525 | 0.513 | `6779cbaa6c7e7267e20c2926865c7ce4af276cdb6f9a0d1e0fcea9237cdf9e2c` |
| C1 | Base x-vector + angry instruct | 17.200 | 17.256 | 8,043.4 | 43.422 | 0.468 | `7a66ad4df73441b1dfcbf02d349c0483ccc4f2764b3859f3c85438dcfb90dd93` |
| C2 | Base x-vector + soft instruct | 18.240 | 18.288 | 7,856.0 | 43.006 | 0.431 | `ab34494b71d0c6c170e02c35282e4f13913d7c709a7edeb625a95c5a0a5ff30c` |
| C3 | Base x-vector + embarrassed instruct | 17.280 | 17.328 | 7,050.0 | 42.119 | 0.408 | `95abc275103ad80d0a480578996bbf2445a704349d03bfb42a9e384cbcc4be8e` |
| C4 | Base x-vector + sad instruct | 20.000 | 20.064 | 8,297.3 | 45.642 | 0.415 | `5154a9d88bed465a245c993a976b12bfffa616e65ac0629cb44f1885b0ae862a` |
| C5 | Base x-vector + sarcastic instruct | 17.520 | 17.568 | 7,137.8 | 42.103 | 0.407 | `2446da3b03f97ed1d1e6788d2d7a98cb98c613a9c1388c3746d7bf007f76be` |

## Runtime safety evidence

- Pre-run and post-run production health: `ready`, model `qwen3-tts-1.7b`,
  voice `kurisu-v1`.
- Production LaunchAgent PID was `50062` before and after; last-exit state stayed
  `never exited`. No production restart, stop, reload, profile change, or route
  change occurred.
- OminiX ran as one temporary foreground process, generated C0 then C1–C5
  sequentially, exited successfully, and has no resident listener after the run.
- A sampled high-pressure point during C generation reached 25% system-wide
  free memory and swapouts increased from 25,575,710 to 25,887,938 pages;
  production health stayed ready. The run was not expanded or rerun. Post-stop
  memory capture was 74% free; swapouts were 26,036,668.
- Private reference audio, generated audio, model assets, raw runtime logs,
  delivery receipts, and owner target remain outside Git under the external
  experiment run. Only this content-safe report and reproducible config/check
  are committed.

## WhatsApp delivery

The existing linked WhatsApp `secondary` account and protected configured owner
target were used through the canonical OpenClaw CLI. No alternate sender or
transport was used.

| Item | Result | Evidence |
| --- | --- | --- |
| Intro | sent | canonical CLI receipt, sanitized externally |
| A0 | sent with one MP3 attachment | canonical CLI receipt; owner confirmed A0 received |
| C0 | sent with one MP3 attachment | canonical CLI receipt, `dryRun=false`, `handledBy=core` |
| C1 | sent with one MP3 attachment | canonical CLI receipt, `dryRun=false`, `handledBy=core` |
| C2 | sent with one MP3 attachment | canonical CLI receipt, `dryRun=false`, `handledBy=core` |
| C3 | sent with one MP3 attachment | canonical CLI receipt, `dryRun=false`, `handledBy=core` |
| C4 | sent with one MP3 attachment | canonical CLI receipt, `dryRun=false`, `handledBy=core` |
| C5 | sent with one MP3 attachment | canonical CLI receipt, `dryRun=false`, `handledBy=core` |
| Metrics summary | sent | canonical CLI receipt, sanitized externally |

The audio labels were sent in fixed order A0, C0, C1, C2, C3, C4, C5. Receipt
IDs are retained only in the external run evidence and are not committed here.

## Acceptance boundary

No automated ranking or winner is declared. Speaker identity, Kurisu character
fidelity, Japanese prosody, naturalness, audible emotion, voice drift, and
artifacts remain owner-listening questions. The next action is to wait for owner
listening feedback; do not promote C or modify production TTS in this Goal.
