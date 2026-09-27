#!/usr/bin/env python3
"""Capture a sanitized immutable production-control manifest before measurements."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "apps/qwen3-tts-service"
sys.path.insert(0, str(APP))
import production_boundary as boundary
from production_boundary_runtime import check_host_route, runtime_snapshot

PLIST_PATH = Path.home() / "Library/LaunchAgents/com.amadeus.qwen3-tts.plist"
PROFILE_PATH = Path.home() / "Library/Application Support/Amadeus/voices/kurisu-v1"
REFERENCE_FILES = ("reference.wav", "reference.txt")


def command(args: list[str], timeout_s: float = 10) -> str:
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout_s, check=False)
    if result.returncode != 0:
        raise RuntimeError("control_command_failed:" + Path(args[0]).name)
    return result.stdout.strip()


def protected_file(path: Path) -> None:
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("protected_control_file_required")


def write_private(path: Path, value: object) -> None:
    data = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def host_machine() -> str:
    profile = Path(os.environ.get("AMADEUS_HOST_PROFILE", ROOT / "infra/host-profile.env"))
    machine = "ubuntu"
    if profile.is_file():
        for line in profile.read_text().splitlines():
            match = re.match(r"\s*ORBSTACK_MACHINE\s*=\s*['\"]?([^#'\"\s]+)", line)
            if match:
                machine = match.group(1)
    return machine



def live_launchd_projection() -> tuple[dict, dict]:
    output = command(["launchctl", "print", f"gui/{os.getuid()}/com.amadeus.qwen3-tts"], timeout_s=5)
    selected = {"AMADEUS_TTS_ENGINE", "AMADEUS_TTS_BIND", "AMADEUS_TTS_PORT",
                "AMADEUS_TTS_VOICE_DIR", "AMADEUS_TTS_MLX_MODEL_PATH", "AMADEUS_TTS_MODEL_PATH",
                "AMADEUS_TTS_TOKEN_FILE", "AMADEUS_TTS_LOG_DIR"}
    env = {}
    for line in output.splitlines():
        match = re.match(r"^\s*([A-Z0-9_]+) => (.*)$", line)
        if match and match.group(1) in selected:
            env[match.group(1)] = match.group(2).strip()
    spawn = re.search(r"^\s*spawn type = ([A-Za-z_-]+)(?: \((\d+)\))?", output, re.M)
    program = re.search(r"^\s*program = (.+)$", output, re.M)
    projection = {
        "spawn_type": spawn.group(1).lower() if spawn else None,
        "process_type": "Interactive" if spawn and spawn.group(1).lower() == "interactive" else None,
        "process_type_numeric": int(spawn.group(2)) if spawn and spawn.group(2) else None,
        "program_basename": Path(program.group(1).strip()).name if program else None,
    }
    return projection, env

def live_openclaw_tts(machine: str) -> dict:
    js = ("const c=require('/home/node/.openclaw/openclaw.json');"
          "const t=c.tts||{};const p=t.providers?.[t.provider]||{};"
          "console.log(JSON.stringify({provider:t.provider,timeoutMs:t.timeoutMs,"
          "maxTextLength:t.maxTextLength,responseFormat:p.responseFormat,model:p.model,"
          "speakerVoice:p.speakerVoice,baseUrl:p.baseUrl}));")
    result = subprocess.run(
        ["orb", "-m", machine, "-u", "root", "docker", "exec", "openclaw", "node", "-e", js],
        capture_output=True, text=True, timeout=20, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("live_openclaw_tts_control_unavailable")
    value = json.loads(result.stdout.strip())
    expected = {"provider": "openai", "timeoutMs": 120000, "maxTextLength": 1200,
                "responseFormat": "mp3", "model": "amadeus-tts", "speakerVoice": "kurisu-v1",
                "baseUrl": "http://9router:20128/v1"}
    if value != expected:
        raise RuntimeError("live_openclaw_tts_control_mismatch")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the protected control manifest")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--reference-baseline", type=Path, required=True,
                        help="protected pre-MLX reference backup directory for byte-equality verification")
    args = parser.parse_args()
    if not args.apply:
        print("CONTROL_CAPTURE=plan_only; --apply required")
        return
    output = args.output_dir.resolve()
    if not output.is_dir() or output.is_symlink() or output.stat().st_mode & 0o077:
        raise ValueError("private_run_root_required")
    if ROOT == output or ROOT in output.parents:
        raise ValueError("external_output_required")
    if (output / "control-manifest.json").exists():
        raise FileExistsError("control_manifest_already_captured")
    baseline = args.reference_baseline.resolve()
    if not baseline.is_dir() or baseline.is_symlink() or baseline.stat().st_mode & 0o077:
        raise ValueError("protected_reference_baseline_required")
    baseline_manifest_path = baseline / "manifest.json"
    protected_file(baseline_manifest_path)
    baseline_manifest = json.loads(baseline_manifest_path.read_text())
    current_profile_ok = PROFILE_PATH.is_dir() and not PROFILE_PATH.is_symlink()
    for name in REFERENCE_FILES:
        current = PROFILE_PATH / name
        saved = baseline / name
        protected_file(current)
        protected_file(saved)
        current_sha = hashlib.sha256(current.read_bytes()).hexdigest()
        saved_sha = hashlib.sha256(saved.read_bytes()).hexdigest()
        expected = baseline_manifest.get("files", {}).get(name, {}).get("sha256")
        if current_sha != saved_sha or current_sha != expected:
            current_profile_ok = False
    if not current_profile_ok:
        raise RuntimeError("protected_production_reference_changed")

    if not PLIST_PATH.is_file() or PLIST_PATH.is_symlink() or PLIST_PATH.stat().st_mode & 0o077:
        raise ValueError("protected_launchagent_plist_required")
    disk_plist_bytes = PLIST_PATH.read_bytes()
    try:
        disk_plist = plistlib.loads(disk_plist_bytes)
        disk_plist_valid = isinstance(disk_plist, dict) and "EnvironmentVariables" in disk_plist
        disk_plist_shape = "valid_plist_dictionary" if disk_plist_valid else "valid_plist_wrong_shape"
    except plistlib.InvalidFileException:
        try:
            disk_plist = json.loads(disk_plist_bytes)
            disk_plist_shape = "invalid_plist_json_" + ("dict" if isinstance(disk_plist, dict) else type(disk_plist).__name__)
        except (json.JSONDecodeError, UnicodeDecodeError):
            disk_plist_shape = "invalid_plist_unparseable"
        disk_plist_valid = False
    launchd_live, env = live_launchd_projection()
    config = json.loads((ROOT / "infra/macos/qwen3-tts-engine.json").read_text())
    source = ROOT / "apps/qwen3-tts-service/service.py"
    installed_service = Path(env.get("AMADEUS_TTS_SERVICE_PATH", Path.home() / "Library/Application Support/Amadeus/speech/service.py"))
    if not installed_service.is_file() or installed_service.is_symlink():
        raise RuntimeError("installed_service_source_missing")
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    installed_sha = hashlib.sha256(installed_service.read_bytes()).hexdigest()
    if source_sha != installed_sha:
        raise RuntimeError("installed_service_source_differs_from_git")

    token_path = Path(env.get("AMADEUS_TTS_TOKEN_FILE", ""))
    protected_file(token_path)
    if len(token_path.read_text().strip()) < 32:
        raise RuntimeError("protected_service_token_invalid")
    for name in REFERENCE_FILES:
        protected_file(PROFILE_PATH / name)
    expected_mlx_root = str(Path.home() / "Library/Application Support/Amadeus/speech/mlx-poc")
    if (env.get("AMADEUS_TTS_ENGINE") != "mlx" or launchd_live.get("process_type") != "Interactive" or
            config.get("productionEngine") != "mlx" or config.get("profileId") != "kurisu-v1" or
            not env.get("AMADEUS_TTS_MLX_MODEL_PATH", "").startswith(expected_mlx_root)):
        raise RuntimeError("in_memory_production_engine_or_scheduler_mismatch")
    if env.get("AMADEUS_TTS_VOICE_DIR") != str(PROFILE_PATH):
        raise RuntimeError("production_voice_profile_path_mismatch")
    if env.get("AMADEUS_TTS_PORT") != "18792" or env.get("AMADEUS_TTS_BIND") != "0.0.0.0":
        raise RuntimeError("production_tts_bind_or_port_mismatch")

    runtime = runtime_snapshot()
    if (runtime["health"].get("status") != "ready" or runtime["health"].get("http_status") != 200 or
            runtime["health"].get("model") != "qwen3-tts-1.7b" or runtime["health"].get("voice") != "kurisu-v1"):
        raise RuntimeError("production_tts_health_or_identity_not_ready")
    if (runtime["launchd"].get("state") != "running" or not runtime["launchd"].get("pid") or
            runtime["launchd"].get("process_type") != "Interactive"):
        raise RuntimeError("production_launchagent_not_running_interactive")
    active_pid = str(runtime["launchd"]["pid"])
    active_command = command(["ps", "-p", active_pid, "-o", "command="])
    if str(installed_service) not in active_command:
        raise RuntimeError("active_service_entrypoint_differs_from_verified_source")
    lsof_result = subprocess.run(["lsof", "-n", "-p", active_pid], capture_output=True, text=True, timeout=20, check=False)
    lsof_text = lsof_result.stdout.lower()
    live_mlx_library = "libmlx.dylib" in lsof_text or "mlx/core" in lsof_text
    live_torch_library = "libtorch" in lsof_text or "torch/lib" in lsof_text
    if not live_mlx_library or live_torch_library:
        raise RuntimeError("active_inference_process_does_not_confirm_mlx_backend")

    config_source = ROOT / "integrations/openclaw/openclaw.json.example"
    openclaw_example = json.loads(config_source.read_text())
    timeout_ms = int(openclaw_example["tts"]["timeoutMs"])
    openclaw_max_text = int(openclaw_example["tts"]["maxTextLength"])
    if timeout_ms != 120000:
        raise RuntimeError("git_declared_tts_external_timeout_mismatch")
    if openclaw_max_text != 1200:
        raise RuntimeError("git_declared_tts_text_ceiling_mismatch")

    service_text = source.read_text()
    def integer_constant(name: str) -> int:
        match = re.search(rf"^{name}\s*=\s*(\d+)(?:\s*#.*)?\s*$", service_text, re.M)
        if not match:
            raise RuntimeError("service_constant_missing:" + name)
        return int(match.group(1))
    worker_pending = integer_constant("MAX_PENDING_INFERENCES")
    start_timeout = integer_constant("QUEUE_START_TIMEOUT_S")
    max_text = integer_constant("MAX_TEXT")
    if (worker_pending != 1 or start_timeout != 5 or max_text != 1200 or
            "threading.Thread(target=self._run" not in service_text):
        raise RuntimeError("service_admission_contract_mismatch")
    mlx_source = (ROOT / "apps/qwen3-tts-service/mlx_engine.py").read_text()
    if 'lang_code="auto"' not in mlx_source:
        raise RuntimeError("production_language_is_not_auto")

    verify_script = ROOT / "infra/macos/verify-qwen3-mlx-assets.py"
    mlx_root = Path.home() / "Library/Application Support/Amadeus/speech/mlx-poc"
    verified = subprocess.run(
        [sys.executable, str(verify_script), "--root", str(mlx_root), "--config",
         str(ROOT / "infra/macos/qwen3-tts-engine.json")],
        capture_output=True, text=True, timeout=60, check=False,
    )
    if verified.returncode != 0 or "MLX_ASSETS=verified" not in verified.stdout:
        raise RuntimeError("pinned_mlx_asset_verification_failed")

    machine = host_machine()
    if not check_host_route(machine):
        raise RuntimeError("9router_to_host_tts_health_route_failed")
    fixtures, fixture_sha = boundary.load_fixture_manifest()
    schedule = json.loads((output / "schedule.json").read_text())
    schedule_sha = boundary.schedule_sha256(schedule)
    if schedule_sha != json.loads((output / "run-manifest.json").read_text()).get("schedule_sha256"):
        raise RuntimeError("frozen_schedule_hash_mismatch")

    os_version = command(["sw_vers", "-productVersion"])
    hardware = command(["system_profiler", "SPHardwareDataType"], timeout_s=30)
    model = re.search(r"Model Identifier:\s*(.+)", hardware)
    memory = re.search(r"Memory:\s*(.+)", hardware)
    version = (ROOT / "VERSION").read_text().strip()
    git_commit = command(["git", "-C", str(ROOT), "rev-parse", "HEAD"])
    git_main = command(["git", "-C", str(ROOT), "rev-parse", "main"])
    git_origin_main = command(["git", "-C", str(ROOT), "rev-parse", "origin/main"])
    git_branch = command(["git", "-C", str(ROOT), "branch", "--show-current"])
    if version != "1.6.2" or git_commit != git_main or git_commit != git_origin_main:
        raise RuntimeError("measurement_baseline_is_not_canonical_released_main_1_6_2")
    live_tts = live_openclaw_tts(machine)
    engine_config_sha = hashlib.sha256((ROOT / "infra/macos/qwen3-tts-engine.json").read_bytes()).hexdigest()
    control = {
        "control_id": boundary.CONTROL_ID,
        "captured_utc": command(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"]),
        "git_commit": git_commit,
        "canonical_main_commit": git_main,
        "origin_main_commit": git_origin_main,
        "measurement_baseline_is_canonical_main": True,
        "git_branch": git_branch,
        "version": version,
        "fixture_manifest_sha256": fixture_sha,
        "schedule_seed": json.loads((output / "run-manifest.json").read_text())["schedule_seed"],
        "schedule_sha256": schedule_sha,
        "service_source_sha256": source_sha,
        "engine_source_config_sha256": engine_config_sha,
        "engine_config": config,
        "engine": "mlx",
        "voice_profile_id": "kurisu-v1",
        "protected_a_reference_verified_unchanged": True,
        "language": "Auto",
        "one_worker_source_verified": True,
        "active_service_entrypoint_matches_installed_source": True,
        "active_mlx_library_mapped": live_mlx_library,
        "active_torch_library_mapped": live_torch_library,
        "launchd_process_type": launchd_live.get("process_type"),
        "launchd_spawn_type": launchd_live.get("spawn_type"),
        "launchd_spawn_type_numeric": launchd_live.get("process_type_numeric"),
        "launchd_program_basename": launchd_live.get("program_basename"),
        "disk_plist_valid_at_capture": disk_plist_valid,
        "disk_plist_shape_at_capture": disk_plist_shape,
        "disk_plist_mtime_ns": PLIST_PATH.stat().st_mtime_ns,
        "response_format": "mp3",
        "workers": 1,
        "pending_slots": worker_pending,
        "pending_start_timeout_s": start_timeout,
        "openclaw_external_timeout_ms": timeout_ms,
        "live_openclaw_tts_config": live_tts,
        "max_text_codepoints": max_text,
        "service_port": int(env["AMADEUS_TTS_PORT"]),
        "service_bind": env.get("AMADEUS_TTS_BIND"),
        "mac_model_identifier": model.group(1).strip() if model else None,
        "unified_memory": memory.group(1).strip() if memory else None,
        "macos_version": os_version,
        "runtime": runtime,
        "9router_host_tts_health_route": "ready",
        "host_machine": machine,
        "service_log_size_bytes": (Path.home() / "Library/Logs/Amadeus/qwen3-tts.log").stat().st_size,
        "fixture_lengths_verified": sorted(fixtures),
        "quantile_method": boundary.QUANTILE_METHOD,
        "endpoint_watchdog_s": boundary.WATCHDOG_S,
        "matrix_quiet_interval_s": boundary.QUIET_INTERVAL_S,
        "safety_stop_guards": {
            "memory_free_percent_below": 10,
            "physical_footprint_bytes_at_or_above": 20 * (1024 ** 3),
            "swap_growth_immediate_stop_bytes": 2 * (1024 ** 3),
            "swap_free_immediate_stop_bytes": 512 * (1024 ** 2),
            "swap_growth_persistent_warning_bytes": 512 * (1024 ** 2),
            "swap_growth_clear_decline_bytes": 128 * (1024 ** 2),
            "swap_growth_confirmation_window_s": 30,
            "swap_growth_max_confirmation_windows": 4,
        },
        "production_configuration_changed_by_goal": False,
    }
    write_private(output / "control-manifest.json", control)
    print("CONTROL_MANIFEST=verified_private")
    print("CONTROL_COMMIT=" + git_commit[:12] + " VERSION=" + version)
    print("CONTROL_PID=" + str(runtime["launchd"]["pid"]) + " HEALTH=ready NINE_ROUTER_ROUTE=ready")
    print("CONTROL_PROFILE=unchanged ENGINE=mlx PROCESS_TYPE=Interactive MAX_TEXT=1200")


if __name__ == "__main__":
    main()
