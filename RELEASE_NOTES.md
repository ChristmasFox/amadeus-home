# Amadeus 1.4.7

Amadeus 1.4.7 — Operation Skuld Final Migration Blocker Fixes.

- Implemented full HomeLab backup path with verified artifacts and checksums for all MIGRATE services.
- Added explicit secret restore mode mapping logical IDs to clean destination targets.
- Added sanitized live observation and contract comparison mode to service inventory (MANUAL_BLOCKER on missing contract entries).
- Hardened state machine with gate verifiers before phase advancement.
- Enhanced safe pre-migration GC with real protected image set (running images, exact 9Router image, releases, rollback tags).
- Corrected destination capacity model to use max(configured_floor, measured_requirement + growth margin).
- Wired all migration blocker tests into package scripts release gate.
- Fixed documentation path consistency (`/home/nyannyan` as Linux guest).
