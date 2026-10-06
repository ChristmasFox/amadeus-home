#!/usr/bin/env python3
"""Idempotently reconcile Amadeus's image Combo via 9Router management APIs.

The desired chain is Git-managed. All writes require --apply; a minimal,
protected, external checkpoint precedes them. No database editing, provider
connection changes, credential copies, or 9Router restart are performed.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import stat

from nine_router_management import Dashboard, local_cli_token

ROOT = Path(__file__).resolve().parents[1]
DESIRED_PATH = ROOT / "infra/9router/model-capabilities.json"
NAME = "amadeus-image"


def desired_image() -> dict:
    data = json.loads(DESIRED_PATH.read_text())
    if set(data) != {"image"} or set(data["image"]) != {"name", "kind", "strategy", "models"}:
        raise RuntimeError("image_desired_state_shape_invalid")
    desired = data["image"]
    if desired["name"] != NAME or desired["kind"] != "image" or desired["strategy"] != "fallback":
        raise RuntimeError("image_desired_state_identity_invalid")
    models = desired["models"]
    if not isinstance(models, list) or len(models) != 1 or any(not isinstance(x, str) or not x.strip() for x in models):
        raise RuntimeError("image_desired_state_models_invalid")
    return desired


def combo_from(api: Dashboard) -> dict | None:
    combos = api.request("GET", "/api/combos").get("combos")
    if not isinstance(combos, list):
        raise RuntimeError("combos_response_invalid")
    matches = [c for c in combos if isinstance(c, dict) and c.get("name") == NAME]
    if len(matches) > 1:
        raise RuntimeError("ambiguous_amadeus_image_combo")
    if not matches:
        return None
    current = matches[0]
    if current.get("kind") != "image":
        raise RuntimeError("amadeus_image_wrong_kind; refusing to repurpose existing Combo")
    if not isinstance(current.get("id"), str) or not current["id"] or not isinstance(current.get("models"), list):
        raise RuntimeError("amadeus_image_combo_response_invalid")
    if any(not isinstance(x, str) for x in current["models"]):
        raise RuntimeError("amadeus_image_models_response_invalid")
    return {"id": current["id"], "name": NAME, "kind": "image", "models": list(current["models"])}


def strategy_state_from(settings: dict) -> tuple[bool, bool, str | None]:
    strategies = settings.get("comboStrategies", {})
    if not isinstance(strategies, dict):
        raise RuntimeError("combo_strategies_response_invalid")
    entry = strategies.get(NAME)
    if entry is None and NAME not in strategies:
        return False, False, None
    if not isinstance(entry, dict):
        raise RuntimeError("amadeus_image_strategy_response_invalid")
    if "fallbackStrategy" not in entry:
        return True, False, None
    if not isinstance(entry["fallbackStrategy"], str):
        raise RuntimeError("amadeus_image_fallback_strategy_invalid")
    return True, True, entry["fallbackStrategy"]


def snapshot(api: Dashboard) -> dict:
    combo = combo_from(api)
    aliases = api.request("GET", "/api/models/alias").get("aliases", {})
    if not isinstance(aliases, dict):
        raise RuntimeError("aliases_response_invalid")
    if NAME in aliases:
        raise RuntimeError("amadeus_image_alias_conflict; refusing to shadow an existing alias")
    strategy_present, fallback_present, fallback_value = strategy_state_from(api.request("GET", "/api/settings"))
    return {
        "schemaVersion": 1,
        "combo": combo,
        "strategyEntryPresent": strategy_present,
        "fallbackStrategyPresent": fallback_present,
        "fallbackStrategy": fallback_value,
    }


def write_checkpoint(directory: Path, state: dict) -> Path:
    if not directory.is_absolute() or directory.resolve().is_relative_to(ROOT):
        raise ValueError("checkpoint_directory_must_be_absolute_and_outside_git")
    old_umask = os.umask(0o077)
    try:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if directory.is_symlink() or not directory.is_dir() or stat.S_IMODE(directory.stat().st_mode) & 0o077:
            raise ValueError("checkpoint_directory_not_private")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        target = directory / f"amadeus-image-preapply-{stamp}-{os.getpid()}.json"
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(target, flags, 0o600)
        with os.fdopen(descriptor, "w") as out:
            json.dump(state, out, ensure_ascii=False, indent=2)
            out.write("\n")
            out.flush()
            os.fsync(out.fileno())
        return target
    finally:
        os.umask(old_umask)


def read_checkpoint(path: Path) -> dict:
    if not path.is_absolute() or path.resolve().is_relative_to(ROOT) or path.is_symlink():
        raise ValueError("checkpoint_must_be_external_regular_file")
    if not path.is_file() or stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError("checkpoint_not_private")
    state = json.loads(path.read_text())
    if set(state) != {"schemaVersion", "combo", "strategyEntryPresent", "fallbackStrategyPresent", "fallbackStrategy"} or state["schemaVersion"] != 1:
        raise ValueError("checkpoint_schema_invalid")
    combo = state["combo"]
    if combo is not None and (set(combo) != {"id", "name", "kind", "models"} or combo["name"] != NAME or combo["kind"] != "image" or
                              not isinstance(combo["id"], str) or not re.fullmatch(r"[A-Za-z0-9-]{1,128}", combo["id"]) or
                              not isinstance(combo["models"], list) or any(not isinstance(x, str) for x in combo["models"])):
        raise ValueError("checkpoint_combo_invalid")
    if not isinstance(state["strategyEntryPresent"], bool) or not isinstance(state["fallbackStrategyPresent"], bool) or \
            (state["fallbackStrategyPresent"] and not state["strategyEntryPresent"]):
        raise ValueError("checkpoint_strategy_invalid")
    if state["fallbackStrategyPresent"] and not isinstance(state["fallbackStrategy"], str):
        raise ValueError("checkpoint_fallback_invalid")
    if not state["fallbackStrategyPresent"] and state["fallbackStrategy"] is not None:
        raise ValueError("checkpoint_fallback_invalid")
    return state


def set_fallback_strategy(api: Dashboard, *, present: bool, value: str | None) -> str:
    settings = api.request("GET", "/api/settings")
    strategies = settings.get("comboStrategies", {})
    if not isinstance(strategies, dict):
        raise RuntimeError("combo_strategies_response_invalid")
    revised = dict(strategies)
    entry = revised.get(NAME, {})
    if not isinstance(entry, dict):
        raise RuntimeError("amadeus_image_strategy_response_invalid")
    entry = dict(entry)
    if present:
        entry["fallbackStrategy"] = value
    else:
        entry.pop("fallbackStrategy", None)
    if entry:
        revised[NAME] = entry
    else:
        revised.pop(NAME, None)
    if revised == strategies:
        return "existing"
    api.request("PATCH", "/api/settings", {"comboStrategies": revised})
    return "reconciled"


def ensure_image(api: Dashboard, desired: dict, before: dict) -> tuple[str, str]:
    combo = before["combo"]
    if combo is None:
        api.request("POST", "/api/combos", {"name": NAME, "kind": "image", "models": desired["models"]})
        combo_action = "created"
    elif combo["models"] == desired["models"]:
        combo_action = "existing"
    else:
        api.request("PUT", "/api/combos/" + combo["id"], {"models": desired["models"]})
        combo_action = "reconciled"
    strategy_action = set_fallback_strategy(api, present=True, value="fallback")
    after = snapshot(api)
    if after["combo"] is None or after["combo"]["models"] != desired["models"] or not after["fallbackStrategyPresent"] or after["fallbackStrategy"] != "fallback":
        raise RuntimeError("amadeus_image_post_apply_verification_failed")
    return combo_action, strategy_action


def verify_live(api: Dashboard, desired: dict) -> None:
    state = snapshot(api)
    if state["combo"] is None or state["combo"]["models"] != desired["models"] or \
            not state["fallbackStrategyPresent"] or state["fallbackStrategy"] != desired["strategy"]:
        raise RuntimeError("amadeus_image_live_combo_not_canonical; provision before OpenClaw switch")


def restore_image(api: Dashboard, before: dict) -> tuple[str, str]:
    current = snapshot(api)
    original = before["combo"]
    combo = current["combo"]
    if original is None:
        if combo is not None:
            api.request("DELETE", "/api/combos/" + combo["id"])
            combo_action = "removed"
        else:
            combo_action = "already_absent"
    elif combo is None:
        api.request("POST", "/api/combos", {"name": NAME, "kind": "image", "models": original["models"]})
        combo_action = "restored"
    elif combo["models"] != original["models"]:
        api.request("PUT", "/api/combos/" + combo["id"], {"models": original["models"]})
        combo_action = "restored"
    else:
        combo_action = "existing"
    strategy_action = set_fallback_strategy(api, present=before["fallbackStrategyPresent"], value=before["fallbackStrategy"])
    after = snapshot(api)
    if (after["combo"] is None) != (original is None) or (original and after["combo"]["models"] != original["models"]) or \
            after["strategyEntryPresent"] != before["strategyEntryPresent"] or \
            after["fallbackStrategyPresent"] != before["fallbackStrategyPresent"] or after["fallbackStrategy"] != before["fallbackStrategy"]:
        raise RuntimeError("amadeus_image_post_restore_verification_failed")
    return combo_action, strategy_action


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="explicitly write the 9Router Combo; default is plan-only")
    parser.add_argument("--verify-live", action="store_true", help="authenticated read-only desired-state gate")
    parser.add_argument("--machine", default=os.environ.get("ORBSTACK_MACHINE", "nyannyan"))
    parser.add_argument("--checkpoint-dir", type=Path, help="protected external directory for the pre-apply Combo snapshot")
    parser.add_argument("--restore-checkpoint", type=Path, help="restore only amadeus-image from this protected snapshot")
    args = parser.parse_args()
    desired = desired_image()
    if args.verify_live and (args.apply or args.restore_checkpoint or args.checkpoint_dir):
        parser.error("--verify-live is read-only and cannot be combined with apply or checkpoint options")
    if not args.apply and not args.verify_live:
        print("MODE=dry-run; no dashboard authentication or write")
        print("IMAGE_COMBO=" + json.dumps(desired, ensure_ascii=False, sort_keys=True))
        if args.restore_checkpoint:
            print("RESTORE=plan-only; pass --apply to restore")
        return
    if args.restore_checkpoint and args.checkpoint_dir:
        parser.error("--restore-checkpoint and --checkpoint-dir are mutually exclusive")
    if args.apply and not args.restore_checkpoint and not args.checkpoint_dir:
        parser.error("--apply requires --checkpoint-dir outside Git")
    before = read_checkpoint(args.restore_checkpoint) if args.restore_checkpoint else None
    api = Dashboard("http://127.0.0.1:20128", cli_token=local_cli_token(args.machine))
    api.request("GET", "/api/health")  # fail closed on auth/availability before any write
    if args.verify_live:
        verify_live(api, desired)
        print("IMAGE_COMBO_LIVE=ready kind=image strategy=fallback order=canonical")
        return
    if before is None:
        before = snapshot(api)  # wrong kind or alias conflict stops before a checkpoint/write
        checkpoint = write_checkpoint(args.checkpoint_dir, before)
        print("ROLLBACK_CHECKPOINT=" + str(checkpoint))
        combo_action, strategy_action = ensure_image(api, desired, before)
        print("IMAGE_COMBO=" + combo_action)
        print("IMAGE_STRATEGY=" + strategy_action)
    else:
        combo_action, strategy_action = restore_image(api, before)
        print("IMAGE_COMBO_ROLLBACK=" + combo_action)
        print("IMAGE_STRATEGY_ROLLBACK=" + strategy_action)


if __name__ == "__main__":
    main()
