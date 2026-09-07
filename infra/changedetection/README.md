# changedetection.io sensor

`docker-compose.example.yml` is the repository-owned standalone template for the
changedetection datastore. Product Radar owns the webhook contract and source
refetch; changedetection only observes the configured URL and emits a JSON
notification.

For the bundled local/CasaOS Product Radar stack, use the corresponding
compose file under `apps/product-radar/` or
`infra/docker/casaos/product-radar/`; do not run two changedetection
containers against the same datastore. Port `5000` is intentionally not
published in either template.
