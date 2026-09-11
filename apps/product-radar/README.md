# Product Radar V0.1

Product Radar is a standalone generic Seller Watch / Product Watch service.
The core only knows generic listings, watch types, source capabilities, sensor
ports, SQLite persistence, deterministic matching, events, and notification
channels. Bunjang lives in `src/sources/bunjang`; changedetection.io lives
behind `src/sensors/sensor.ts`.

## Local development

```sh
pnpm install
pnpm --filter @agent/product-radar typecheck
pnpm --filter @agent/product-radar test
pnpm --filter @agent/product-radar dev
```

The default local port is `5315`. Set `PRODUCT_RADAR_DATABASE_PATH` to a
writable SQLite path and provide `CHANGEDETECTION_BASE_URL` when a real sensor
is available. Secrets and admin recipient IDs are read from the environment or
external files only.

## Compose

`docker-compose.yml` runs Product Radar and changedetection on a private
internal network. changedetection has no published port. The CasaOS template
is under `infra/docker/casaos/product-radar/docker-compose.example.yml`; use
an explicit RELEASE deployment flow before copying it into CasaOS.

## API examples

Seller watch (initial listings become a silent baseline):

```sh
curl -X POST http://127.0.0.1:5315/api/watches \
  -H 'Content-Type: application/json' \
  -d '{
    "source": "bunjang",
    "type": "seller",
    "target": {"sellerUrl": "https://m.bunjang.co.kr/shops/4771473/products"},
    "rules": {
      "keywords": ["Chrome Hearts"],
      "keywordMode": "any",
      "excludeKeywords": [],
      "currency": "KRW",
      "maxPrice": 1000000
    },
    "intervalSeconds": 900
  }'
```

Product watch (initial snapshot is silent):

```sh
curl -X POST http://127.0.0.1:5315/api/watches \
  -H 'Content-Type: application/json' \
  -d '{
    "source": "bunjang",
    "type": "product",
    "target": {"productUrl": "https://m.bunjang.co.kr/products/418123655"},
    "rules": {"trackPrice": true, "trackStatus": true}
  }'
```

A changedetection notification is accepted at
`POST /api/sensors/changedetection/webhook` with `radarWatchId` and
`sensorWatchId`. The service deliberately ignores the sensor diff content and
refetches the source before creating an event.

Similarity feeds also have an internal scheduler that evaluates due feeds
every 30 seconds. changedetection remains a compatible trigger, but a dynamic
search page not producing a text diff cannot permanently stop Product Radar.
When a high-volume feed reaches the first-scan safety cap, the newest listing
is stored as a silent watermark; subsequent runs are incremental. A failed
scan does not publish staged listings or advance the watermark, and records
the feed as `DEGRADED` until a later successful run recovers it to `ACTIVE`.

For isolated admin/development verification, an API-key-authenticated
`POST /api/watches/:watchId/test-listing` accepts only `e2e-test-*` listing
identifiers. It enters the normal feed event, matcher, event, outbox, and
notification pipeline; it is not a direct notification shortcut. Remove the
temporary Watch and its test records after the verification run.

## V0.2 image similarity watch

V0.2 accepts an image attachment through the LangBot plugin and creates a
`similarity` watch. It queries the Bunjang public keyword feed (default Korean
clothing query `의류`, up to 60 newest candidates), downloads candidate images,
and compares them with a persisted deterministic perceptual feature vector.
The initial threshold is `0.60`; this is a visual similarity score, not a
claim of exact product identity. Existing candidates are a silent baseline;
only newly seen candidates at or above the threshold create
`SimilarListingMatchedEvent`.

The reference image is persisted as a feature under the Product Radar data
volume, so a temporary Telegram image URL is not required after creation.
The CasaOS deployment uses `hybrid`: new references are embedded by the local
`Marqo/marqo-fashionSigLIP` sidecar, while Sharp features are prepared in
parallel as a recovery path. Existing Sharp-only references and temporary
FashionSigLIP outages therefore remain usable. The local development default
is still `sharp`; set `PRODUCT_RADAR_IMAGE_MATCHER_PROVIDER=hybrid` only when a
FashionSigLIP sidecar is available.

FashionSigLIP is exposed through a narrow `/embed-batch` HTTP port. Product
Radar owns cache identity, cosine scoring, thresholds, and fallback behavior;
the model service does not know about Watches or marketplace semantics. The
first sidecar start downloads the model into
`/DATA/AppData/product-radar/fashion-siglip-cache` and can take several
minutes on CPU. The initial similarity threshold remains `0.60` until live
FashionSigLIP score calibration is completed.

Similarity watch API example:

```sh
curl -X POST http://127.0.0.1:5315/api/watches \
  -H 'Content-Type: application/json' \
  -d '{
    "source": "bunjang",
    "type": "similarity",
    "target": {
      "referenceImageUrl": "https://media.bunjang.co.kr/product/424506121_1_1788506179_w600.jpg",
      "searchQuery": "의류"
    },
    "rules": {"similarityThreshold": 0.6, "candidateLimit": 60},
    "intervalSeconds": 120
  }'
```

The V0.2 default candidate scope is the Bunjang Korean keyword feed
`의류`, not an unrestricted crawl of the whole marketplace. Use a more
specific `searchQuery` when the clothing category can be determined. The
reference image can be a URL or the `referenceImageBase64` data URI emitted by
LangBot; once the watch is created only the persisted `referenceImageId` is
kept in the Watch target.
