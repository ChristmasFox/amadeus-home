# HomeLab frpc Image Lab mapping — 2026-10-08

## Protected pre-change checkpoint

The original `/DATA/AppData/frpc/frpc.toml` is preserved outside the Git
repository at:

```text
/Volumes/Avalon/backups/amadeus-image-lab/frpc/20261008T075816Z/frpc.toml.pre
```

The backup directory is `0700`; the config copy is `0600`, owned by `root:root`.
Its SHA-256 is:

```text
3acae5225538009551c5d5aee5564b709a6b9700227c774666b9625f60ef0e01
```

Secret values are not included in this checkpoint.

## Apply and evidence

- The pre-change config passed `frpc verify` and contained eight proxies.
- The HomeLab guest reached the Mac UI at `192.168.5.3:<SERVICE_PORT>` immediately
  before apply.
- Exactly one proxy was appended:

  ```toml
  [[proxies]]
  name = "qwen-image-lab-tcp"
  type = "tcp"
  localIP = "192.168.5.3"
  localPort = <SERVICE_PORT>
  remotePort = <SERVICE_PORT>
  ```

- The post-change config passed `frpc verify`, remains `0600 root:root`, and
  parses to nine proxies with exactly one `qwen-image-lab-tcp` entry. Its
  SHA-256 is
  `b138ffb3304e44a95518c5f637d61d3535d5acc14e84c22710b2b92f768df008`.
- `frpc.service` restarted and is active. The new session logged in and
  registered all nine proxies; `qwen-image-lab-tcp` reported `start proxy
  success`.
- The Caddy public route returns the Image Lab password page. The public
  unauthenticated gates return 401. VPS IPv4/IPv6 INPUT guards block direct
  non-loopback access to port <SERVICE_PORT>.

## Rollback

Restore only the previous frpc config, then validate and restart:

```sh
orb -m example-node -u root install -m 600 \
  /Volumes/Avalon/backups/amadeus-image-lab/frpc/20261008T075816Z/frpc.toml.pre \
  /DATA/AppData/frpc/frpc.toml
orb -m example-node -u root /usr/local/bin/frpc verify -c /DATA/AppData/frpc/frpc.toml
orb -m example-node -u root systemctl restart frpc
```

The VPS Caddy, frps admission, and firewall checkpoints are separate and must
remain in place while the site or tunnel is being rolled back.
