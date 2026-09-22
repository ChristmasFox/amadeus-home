# Amadeus-M204 Git SSH clone preparation

Date: 2026-09-22 (Asia/Shanghai)
Status: TARGET KEY PREPARED — GitHub read authorization and clone pending

## Initial access result

The target has Git installed, but had no SSH public key and no GitHub SSH authorization. A batch-mode
`git ls-remote git@github.com:ChristmasFox/amadeus-home.git HEAD` correctly failed with GitHub public-key
authentication denied. No password, token, or control-side private key was requested or copied.

## Target-local preparation

- Generated a dedicated ED25519 key only at `/Users/nyannyan/.ssh/amadeus_m204_github_ed25519` with mode 600.
- Added a managed SSH alias `github-amadeus` in `/Users/nyannyan/.ssh/config`, which uses that identity,
  connects to `github.com` as `git`, and uses `IdentitiesOnly yes`.
- Public-key fingerprint: `SHA256:BtBgNalGaD3A1gTQQHRpkU6ma/eyzYTbh9Y9H1mKJVQ`.
- The public key must be added to repository `ChristmasFox/amadeus-home` as a **read-only Deploy key**.
  Write access must remain disabled.

## Next validation

After repository authorization, run only:

```sh
git ls-remote git@github-amadeus:ChristmasFox/amadeus-home.git HEAD
git clone git@github-amadeus:ChristmasFox/amadeus-home.git /Users/nyannyan/agent-monorepo
```

The clone is not yet performed. It must be followed by the tracked clean-host bootstrap checks; it does not
authorize secret/data restoration, a second runtime, or cutover.
