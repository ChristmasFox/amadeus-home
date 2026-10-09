# Public Qwen Image Lab — frps port admitted

Date: 2026-10-08 (Asia/Shanghai)

## Change

On `amadeus-gateway`, updated `/etc/frp/frps.toml` to add the single TCP port
`18798` to the allowed set and raise `maxPortsPerClient` from 10 to 11. No
other parsed config values changed. The candidate passed
`/usr/local/bin/frps verify` for pinned frps `0.69.0`; the live config passed
verification; systemd restarted frps successfully.

The complete listening-port set immediately before and after restart matched.
`18798` is not listening because the HomeLab frpc proxy has not been added.
Existing public proxy listeners therefore remained available after restart.

## Protected checkpoint and rollback

The root-only checkpoint is:

```text
/var/backups/amadeus-image-lab/20261008T074029Z/frps/frps.toml.pre
```

Its parent directory is mode `0700`, the saved config is mode `0600`, and its
SHA-256 is:

```text
ca0b359f8d58bbd3ba99b05148a5983a53c7459ed18f92de16b9e54de9af660b
```

Rollback the config and restart frps with:

```sh
sudo cp --preserve=mode,ownership /var/backups/amadeus-image-lab/20261008T074029Z/frps/frps.toml.pre /etc/frp/frps.toml
sudo /usr/local/bin/frps verify -c /etc/frp/frps.toml
sudo systemctl restart frps
```

## Subsequent loopback-only ingress guard

At the operator's explicit `Apply` instruction, persistent IPv4 and IPv6 INPUT
rules were added to drop non-loopback TCP `18798` while allowing loopback for
Caddy. A new SSH session succeeded, and normalized before/after comparisons
proved that no other active or persistent firewall rules changed. See
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-firewall.md`. The frps
allowlist entry remains unused until authenticated Mac UI is deployed.
