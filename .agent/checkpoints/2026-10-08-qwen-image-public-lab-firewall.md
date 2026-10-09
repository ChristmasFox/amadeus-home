# Public Qwen Image Lab — loopback-only ingress guard

Date: 2026-10-08 (Asia/Shanghai)

## Change

At the operator's explicit `Apply` instruction, added this single INPUT rule to
both IPv4 and IPv6:

```text
-A INPUT ! -i lo -p tcp -m tcp --dport 18798 -j DROP
```

This preserves the VPS Caddy upstream connection to `127.0.0.1:18798` and
blocks non-loopback traffic from reaching the FRP TCP port directly. The rule
was applied live and persisted with the existing enabled
`netfilter-persistent` service. Both `iptables-restore --test` and
`ip6tables-restore --test` passed. A new SSH connection succeeded after the
change. Normalized active and persistent ruleset comparisons confirmed that
only the intended rule was added. No listener on `18798` exists yet.

The source-managed rule is `infra/vps/qwen-image-public-input.rules`.

## Protected checkpoint

The root-only checkpoint is:

```text
/var/backups/amadeus-image-lab/20261008T074536Z/firewall
```

Its directory is root-owned mode `0700`; all four saved files are mode `0600`.
The saved files preserve the prior active IPv4/IPv6 rulesets and persistent
`rules.v4`/`rules.v6` files. Their SHA-256 values are:

```text
iptables.v4.active.pre  d82f9236bd08894deda96e57c8119713926c3ae3216698e70de8e920fd0df56f
iptables.v6.active.pre  127f17e087a1568b98241a650624be3e4dcd76c463d4591f5e337d7d9a256ffe
rules.v4.pre            a1c001f6acde8863b2c18adfbc48cbfbef8e5a2b98e19740c05096ff208d71ec
rules.v6.pre            a1c001f6acde8863b2c18adfbc48cbfbef8e5a2b98e19740c05096ff208d71ec
```

## Rollback

Remove only the exact rule from active IPv4/IPv6 state, then persist:

```sh
sudo iptables -D INPUT ! -i lo -p tcp -m tcp --dport 18798 -j DROP
sudo ip6tables -D INPUT ! -i lo -p tcp -m tcp --dport 18798 -j DROP
sudo netfilter-persistent save
```

The full protected prior files are available for recovery if needed.
