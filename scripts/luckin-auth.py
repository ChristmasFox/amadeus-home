#!/usr/bin/env python3
"""Install or remove one person's own Luckin authorization for Lab (operator-side, never through chat).

The token comes from a private file the person's own official sign-in produced (an env file with LUCKIN_API_TOKEN=...) or from a
hidden prompt; it is never printed, never put in an environment variable of the service, and never written anywhere but that
person's 600 authorization file, named by a hash of their sender key.

  luckin-auth.py set    --sender-key whatsapp:<digits> --auth-dir DIR [--token-file FILE] [--expires-at ISO]
  luckin-auth.py remove --sender-key whatsapp:<digits> --auth-dir DIR
"""
import argparse, datetime, getpass, hashlib, json, os, re, sys, tempfile

def file_id(sender_key: str) -> str:
    return hashlib.sha256(sender_key.encode()).hexdigest()[:32]

def read_token(path: str | None) -> str:
    if path:
        text = open(path, encoding="utf-8").read()
        match = re.search(r"^\s*(?:export\s+)?LUCKIN_[A-Z_]*TOKEN\s*=\s*['\"]?([^'\"\s]+)", text, re.M)
        token = match.group(1) if match else text.strip()
    else:
        token = getpass.getpass("Luckin token (hidden): ").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token or any(ch.isspace() for ch in token):
        raise SystemExit("no usable token found")
    return token

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["set", "remove"])
    parser.add_argument("--sender-key", required=True, help="whatsapp:<digits of the sender>")
    parser.add_argument("--auth-dir", required=True)
    parser.add_argument("--token-file")
    parser.add_argument("--expires-at")
    parser.add_argument("--uid", type=int, help="owner uid for the files (the service user)")
    args = parser.parse_args()
    if not re.fullmatch(r"whatsapp:\d{5,20}", args.sender_key):
        raise SystemExit("sender key must look like whatsapp:<digits>")
    target = os.path.join(args.auth_dir, f"{file_id(args.sender_key)}.auth.json")
    if args.action == "remove":
        for suffix in ("auth", "orders"):
            path = os.path.join(args.auth_dir, f"{file_id(args.sender_key)}.{suffix}.json")
            if os.path.exists(path):
                os.remove(path)
        print("removed")
        return
    token = read_token(args.token_file)
    os.makedirs(args.auth_dir, mode=0o700, exist_ok=True)
    os.chmod(args.auth_dir, 0o700)
    record = {"token": token, "savedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    if args.expires_at:
        datetime.datetime.fromisoformat(args.expires_at.replace("Z", "+00:00"))
        record["expiresAt"] = args.expires_at
    fd, temp = tempfile.mkstemp(dir=args.auth_dir, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(record, handle)
    os.chmod(temp, 0o600)
    if args.uid is not None:
        os.chown(temp, args.uid, -1)
        os.chown(args.auth_dir, args.uid, -1)
    os.replace(temp, target)
    print(f"saved authorization file {os.path.basename(target)} (token not shown)")

if __name__ == "__main__":
    main()
