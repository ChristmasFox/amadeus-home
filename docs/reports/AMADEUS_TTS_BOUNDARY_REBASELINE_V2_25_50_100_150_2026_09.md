# Amadeus TTS Boundary Rebaseline V2 — 25 / 50 / 100 / 150 Codepoints

Generated: `2026-09-27T10:40:57.215829+00:00` UTC
Control: `prod-1.6.2-a-mlx-auto-interactive`
Quantiles: Hyndman-Fan type 7 (linear interpolation; h=(n-1)p); 20 successful samples per length (10 A + 10 B).

Measurement-only extract. Production 1.6.2 TTS control and output policy were unchanged. No output-length recommendation is made.

| Codepoints | Endpoint total ms p50 / p95 / max | Model ms p50 / p95 / max | Audio ms p50 / p95 / max | RTF p50 / p95 / max |
|---:|---:|---:|---:|---:|
| 25 | 4288.6 / 4913.1 / 5206.6 | 4258.8 / 4880.5 / 5164.7 | 4560.0 / 5048.0 / 5200.0 | 0.936 / 1.027 / 1.133 |
| 50 | 5710.3 / 6314.4 / 6316.0 | 5675.6 / 6264.9 / 6266.6 | 8593.5 / 9287.3 / 9426.0 | 0.683 / 0.724 / 0.728 |
| 100 | 8386.9 / 9185.1 / 9328.3 | 8327.4 / 9121.4 / 9267.8 | 15280.0 / 15932.0 / 16160.0 | 0.546 / 0.597 / 0.633 |
| 150 | 11106.0 / 11871.9 / 12290.9 | 11017.0 / 11665.0 / 12206.0 | 22600.0 / 24393.1 / 25782.0 | 0.494 / 0.518 / 0.549 |

### Fixture-family check (endpoint / model p50, p95, max ms)

| Codepoints | A endpoint | A model | B endpoint | B model |
|---:|---:|---:|---:|---:|
| 25 | 4296.1 / 5061.5 / 5206.6 | 4267.4 / 5018.9 / 5164.7 | 4255.4 / 4766.4 / 4897.7 | 4224.8 / 4734.8 / 4865.5 |
| 50 | 5761.7 / 6249.4 / 6299.3 | 5720.5 / 6205.1 / 6248.2 | 5682.1 / 6315.2 / 6316.0 | 5646.9 / 6265.8 / 6266.6 |
| 100 | 8355.9 / 9043.7 / 9328.3 | 8296.2 / 8958.8 / 9267.8 | 8404.0 / 8981.0 / 9177.6 | 8340.5 / 8911.2 / 9113.7 |
| 150 | 11242.1 / 11786.2 / 11849.8 | 11167.0 / 11592.5 / 11636.5 | 10057.6 / 11957.9 / 12290.9 | 9991.2 / 11877.2 / 12206.0 |

### Representative listening artifacts

Verified fixture-A MP3, exact paired text, and metadata are preserved outside Git in the protected run root:

`boundary-rebaseline-v2-safe-25-200-2026-09/listening/25`, `.../listening/50`, `.../listening/100`, `.../listening/150`.

Artifact SHA-256 values are listed in the companion JSON.

### Provenance and limits

- Fixture SHA-256: `2342110427127531e30f18b7c8d350d367d5b2364b7329a6d8117155729a505c`; schedule SHA-256: `6c307496951095b0c377e17efc78aa048f6df1e03679f9c47dd12dcbdddf7f80`.
- Protected evidence hashes: run manifest `145b775a8f56d8a6d7f65eb8d50269d719b693f8406a15109073b07939236500`; matrix `8accaeb7ea8e2602a0b21560dd543500b8153ece0d7f97bd8cc5fc567d5b802b`; listening index `86575da43d469a80adbc1a2066a811c27470bc554b53255a9f97adfd9c10acff`.
- These four buckets completed before the owner stopped the next bucket. This extract includes only the requested lengths, does not pool other runs, and does not claim full 25–600 Goal completion.
- Soak/contention/recovery are not included; no production policy recommendation is made.
