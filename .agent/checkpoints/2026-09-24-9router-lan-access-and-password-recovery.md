# 9router LAN access and password recovery

- Date: 2026-09-24 (Asia/Shanghai)
- Runtime: M204 / OrbStack guest `nyannyan`, CasaOS app `9router`
- Source template: `infra/docker/homelab/9router/docker-compose.example.yml`
- Live compose: `/var/lib/casaos/apps/9router/docker-compose.yml`
- External rollback checkpoint: `/DATA/AppData/9router/backups/access-recovery-20260924T141346Z`

## Change

The live port was bound to `127.0.0.1:20128`, which prevented LAN access through
`192.168.5.3`. The source template and live compose now default to `0.0.0.0:20128`.
`NINE_ROUTER_PORT` can still override the binding, and no frpc public mapping was added.

## Password recovery

The dashboard reported password authentication with an existing stored hash. Before changing
the credential, the compose file, runtime env, and complete `/DATA/AppData/9router/data` tree
were copied to the external checkpoint above. The 9router CLI token boundary was used to clear
the unknown stored password and set a temporary password. The temporary password is deliberately
absent from this checkpoint, Git, and command output.

## Acceptance

- `docker compose config --quiet`: passed.
- Live container: running; published port: `0.0.0.0:20128->20128/tcp`.
- `http://192.168.5.3:20128/api/health`: HTTP 200.
- `http://192.168.5.3:20128/login`: HTTP 200.
- Unauthenticated `/v1/models`: HTTP 401 (API key gate preserved).
- Temporary-password `/api/auth/login`: HTTP 200 and success true.
- Authenticated `/dashboard`: HTTP 200.
