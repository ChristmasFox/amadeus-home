# Amadeus image asset service

This is a host-native, non-conversational service for durable image asset
identity, controlled reads, and explicit Real-ESRGAN upscaling. It stores
originals and derived assets below the configured `AMADEUS_IMAGE_ASSET_ROOT`.
The default is the Mac-local Application Support directory because launchd
must have verified write access; a mounted external volume may be selected in
the host profile after that access is verified.
The SQLite registry defaults to `AMADEUS_IMAGE_REGISTRY_PATH` in the local
service directory so launchd does not depend on SQLite locking semantics on a
shared external volume.

Use `scripts/manage-amadeus-image-service.sh --plan install` to inspect the
resolved paths. Use `--apply install` only after confirming the current host
profile. The service token, Python environment, model cache, launchd plist and
asset registry are runtime state outside Git.

An omitted multiplier defaults to 2x; an explicit 4x request remains 4x.
The 2K/4K options cap the output long edge independently of the multiplier;
output-pixel/resource bounds still fail closed rather than silently downscaling
the requested multiplier.

The service never parses chat text, selects a channel, or performs automatic
upscaling. OpenClaw owns the semantic capability and passes either a trusted
`imageId` or scoped conversation/reply identifiers.
