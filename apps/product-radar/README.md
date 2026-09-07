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
