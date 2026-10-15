#!/usr/bin/env python3
"""No-runtime synthetic checks for release state, OCI provenance and CLI guards."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


state = load_module("release_state", "release-state.py")
oci = load_module("verify_pubg_saas_oci", "verify-pubg-saas-oci.py")
provenance = load_module("verify_image_provenance", "verify-image-provenance.py")


def invoke(*args: str, cwd: Path = ROOT, env=None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, check=False)


now = datetime(2026, 10, 15, 8, 0, tzinfo=timezone.utc)
sha = "a" * 40
digest = "sha256:" + "b" * 64
manifest = {
    "manifestSchema": state.MANIFEST_SCHEMA,
    "product": "lab",
    "environment": "lab-maintainer",
    "status": "candidate",
    "version": "1.10.5",
    "gitSha": sha,
    "imageRefs": [{
        "service": "openclaw", "imageRef": "local/openclaw-amadeus:git-aaaaaaaaaaaa-20261015T070000Z",
        "composeDigest": "sha256:" + "e" * 64,
        "configDigest": "sha256:" + "f" * 64,
    }],
    "imageDigests": [{
        "service": "openclaw", "digest": digest, "gitSha": sha,
        "version": "1.10.5", "builtAt": "2026-10-15T07:00:00Z",
        "provenanceSource": "oci-label",
    }],
    "builtAt": "2026-10-15T07:00:00Z",
    "deployedAt": "2026-10-15T07:15:00Z",
    "schemaVersion": None,
    "checkpointRef": "checkpoint/lab-20261015",
    "actor": "operator",
    "approvalRef": "goal-review/p3-candidate",
    "validationRef": "validation/lab-20261015",
    "candidateAt": "2026-10-15T07:15:00Z",
    "releaseTag": None,
    "rollbackFrom": None,
}
runtime = [{
    "service": "openclaw",
    "digest": digest,
    "imageRef": manifest["imageRefs"][0]["imageRef"],
    "composeDigest": "sha256:" + "e" * 64,
    "configDigest": "sha256:" + "f" * 64,
    "state": "running",
    "health": "healthy",
    "version": "1.10.5",
    "gitSha": sha,
    "builtAt": "2026-10-15T07:00:00Z",
    "provenanceSource": "oci-label",
    "schemaVersion": None,
}]

checked = state.validate_manifest(manifest)
assert state.doctor(checked, runtime, now)[0] == "UNRELEASED_CANDIDATE"
for invalid_manifest, expected_error in (
    ({**manifest, "environment": "gate-local"}, "Lab environment must be lab-maintainer"),
    ({**manifest, "approvalRef": "https://user:password@example.invalid/review"}, "approvalRef must be a non-secret identifier"),
):
    try:
        state.validate_manifest(invalid_manifest)
    except state.StateError as error:
        assert expected_error in str(error)
    else:
        raise AssertionError(f"invalid release manifest unexpectedly passed: {expected_error}")
old_time = now + timedelta(hours=56)
old_state, old_reasons = state.doctor(checked, runtime, old_time)
assert old_state == "UNRELEASED_CANDIDATE" and "reminder due" in old_reasons[0] and "no automatic shutdown" in old_reasons[0]
assert state.doctor(checked, [{**runtime[0], "digest": "sha256:" + "c" * 64}], now)[0] == "IMAGE_DRIFT"
assert state.doctor(checked, [{**runtime[0], "state": "restarting"}], now)[0] == "RUNTIME_DRIFT"
assert state.doctor(checked, [{**runtime[0], "gitSha": "d" * 40}], now)[0] == "SOURCE_DRIFT"
assert state.doctor(checked, [{**runtime[0], "composeDigest": "sha256:" + "d" * 64}], now)[0] == "RUNTIME_DRIFT"

with tempfile.TemporaryDirectory(prefix="release-state-test-") as temporary:
    root = Path(temporary)
    private = root / "private"
    private.mkdir(mode=0o700)
    os.chmod(private, 0o700)
    input_path = root / "manifest.json"
    output_path = private / "candidate.json"
    input_path.write_text(json.dumps(manifest), encoding="utf-8")
    result = invoke("python3", str(ROOT / "scripts/release-state.py"), "write", "--input", str(input_path), "--output", str(output_path))
    assert result.returncode != 0 and "requires --apply" in result.stderr
    result = invoke("python3", str(ROOT / "scripts/release-state.py"), "write", "--input", str(input_path), "--output", str(output_path), "--apply")
    assert result.returncode == 0, result.stderr
    assert stat.S_IMODE(output_path.stat().st_mode) == 0o600
    result = invoke("python3", str(ROOT / "scripts/release-state.py"), "write", "--input", str(input_path), "--output", str(output_path), "--apply")
    assert result.returncode != 0 and "File exists" in result.stderr
    result = invoke("python3", str(ROOT / "scripts/release-state.py"), "write", "--input", str(input_path), "--output", str(ROOT / "release-state-forbidden.json"), "--apply")
    assert result.returncode != 0 and "outside the Git repository" in result.stderr
    runtime_path = root / "runtime.json"
    runtime_path.write_text(json.dumps({
        "runtimeSchema": state.RUNTIME_SCHEMA,
        "product": "lab",
        "environment": "lab-maintainer",
        "capturedAt": "2026-10-15T07:30:00Z",
        "services": [{
            **runtime[0], "builtAt": "2026-10-15T07:00:00Z",
            "provenanceSource": "oci-label", "exitCode": 0,
        }],
    }), encoding="utf-8")
    composed_path = private / "composed-candidate.json"
    compose_args = [
        "python3", str(ROOT / "scripts/release-state.py"), "compose",
        "--product", "lab", "--environment", "lab-maintainer", "--status", "candidate",
        "--version", "1.10.5", "--git-sha", sha, "--runtime", str(runtime_path),
        "--checkpoint-ref", "checkpoint/lab-01", "--actor", "codex",
        "--approval-ref", "goal-review/p3", "--validation-ref", "validation/lab-01",
        "--output", str(composed_path), "--now", "2026-10-15T07:30:00Z",
    ]
    result = invoke(*compose_args)
    assert result.returncode != 0 and "requires --apply" in result.stderr
    result = invoke(*compose_args, "--apply")
    assert result.returncode == 0, result.stderr
    composed = json.loads(composed_path.read_text(encoding="utf-8"))
    assert composed["candidateAt"] == "2026-10-15T07:30:00Z"
    assert composed["imageDigests"][0]["provenanceSource"] == "oci-label"


def oci_fixture(path: Path, labels: dict[str, str]) -> None:
    entries: dict[str, bytes] = {}
    manifests = []
    for arch in ("amd64", "arm64"):
        config = json.dumps({
            "architecture": arch,
            "os": "linux",
            "config": {"Labels": labels},
            "rootfs": {"type": "layers", "diff_ids": []},
        }, separators=(",", ":")).encode()
        config_hash = hashlib.sha256(config).hexdigest()
        entries[f"blobs/sha256/{config_hash}"] = config
        image_manifest = json.dumps({
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "config": {"mediaType": "application/vnd.oci.image.config.v1+json", "digest": f"sha256:{config_hash}", "size": len(config)},
            "layers": [],
        }, separators=(",", ":")).encode()
        manifest_hash = hashlib.sha256(image_manifest).hexdigest()
        entries[f"blobs/sha256/{manifest_hash}"] = image_manifest
        manifests.append({
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "digest": f"sha256:{manifest_hash}",
            "size": len(image_manifest),
            "platform": {"architecture": arch, "os": "linux"},
        })
    entries["oci-layout"] = b'{"imageLayoutVersion":"1.0.0"}'
    entries["index.json"] = json.dumps({"schemaVersion": 2, "manifests": manifests}, separators=(",", ":")).encode()
    with tarfile.open(path, "w") as archive:
        for name, contents in entries.items():
            import io
            info = tarfile.TarInfo(name)
            info.size = len(contents)
            archive.addfile(info, io.BytesIO(contents))


labels = {
    "org.opencontainers.image.revision": sha,
    "org.opencontainers.image.version": "1.10.5",
    "org.opencontainers.image.created": "2026-10-15T07:00:00Z",
}
provenance.validate(labels, sha, "1.10.5", "2026-10-15T07:00:00Z")
with tempfile.TemporaryDirectory(prefix="release-oci-test-") as temporary:
    archive = Path(temporary) / "gate.oci.tar"
    oci_fixture(archive, labels)
    assert oci.verify(archive, labels) == {"linux/amd64", "linux/arm64"}
    try:
        oci.verify(archive, {**labels, "org.opencontainers.image.version": "0.1.1"})
    except ValueError as error:
        assert "oci_provenance_label_mismatch:version" in str(error)
    else:
        raise AssertionError("wrong product version label unexpectedly passed")

gate_plan = invoke("bash", str(ROOT / "scripts/release-gate.sh"), "plan")
assert gate_plan.returncode == 0 and "GATE_ADAPTER=unconfigured" in gate_plan.stdout
gate_status = invoke("bash", str(ROOT / "scripts/release-gate.sh"), "status")
assert gate_status.returncode == 0 and "DRIFT_STATUS=UNKNOWN" in gate_status.stdout
gate_apply = invoke("bash", str(ROOT / "scripts/release-gate.sh"), "candidate", "--apply")
assert gate_apply.returncode != 0 and "--approval-ref" in gate_apply.stderr
credential_ref = invoke(
    "bash", str(ROOT / "scripts/release-lab.sh"), "candidate", "--apply",
    "--approval-ref", "deployment-token-123",
)
assert credential_ref.returncode != 0 and "--approval-ref must be a non-secret identifier" in credential_ref.stderr
credential_ref_dry_run = invoke(
    "bash", str(ROOT / "scripts/release-lab.sh"), "candidate",
    "--approval-ref", "deployment-secret-123",
)
assert credential_ref_dry_run.returncode != 0
assert "deployment-secret-123" not in credential_ref_dry_run.stdout
assert "deployment-secret-123" not in credential_ref_dry_run.stderr
credential_actor = invoke(
    "bash", str(ROOT / "scripts/release-lab.sh"), "candidate", "--apply",
    "--approval-ref", "review-123",
    env={**os.environ, "RELEASE_ACTOR_ID": "operator-api-key"},
)
assert credential_actor.returncode != 0 and "RELEASE_ACTOR_ID" in credential_actor.stderr
memory_on_candidate = invoke(
    "bash", str(ROOT / "scripts/release-lab.sh"), "candidate",
    "--memory-acceptance", "/tmp/acceptance.json",
)
assert memory_on_candidate.returncode != 0 and "formal Lab release" in memory_on_candidate.stderr
memory_on_gate = invoke(
    "bash", str(ROOT / "scripts/release-gate.sh"), "release",
    "--memory-acceptance", "/tmp/acceptance.json",
)
assert memory_on_gate.returncode != 0 and "applies only to Lab" in memory_on_gate.stderr
lab_apply = invoke("bash", str(ROOT / "scripts/release-lab.sh"), "plan", "--apply")
assert lab_apply.returncode != 0 and "not valid for plan" in lab_apply.stderr
for wrapper in ("release-lab.sh", "release-gate.sh"):
    help_output = invoke("bash", str(ROOT / "scripts" / wrapper), "--help")
    assert help_output.returncode == 0 and "rollback-plan" in help_output.stdout

with tempfile.TemporaryDirectory(prefix="release-cli-dry-run-") as temporary:
    root = Path(temporary)
    bin_dir = root / "bin"
    bin_dir.mkdir()
    profile = root / "host-profile.env"
    profile.write_text('ORBSTACK_MACHINE=synthetic\n', encoding="utf-8")
    log = root / "orb.log"
    commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short=12", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    orb_stub = bin_dir / "orb"
    orb_stub.write_text(
        "#!/usr/bin/env bash\nset -eu\nlast=''\nfor arg in \"$@\"; do last=\"$arg\"; done\nprintf '%s\\n' \"$*\" >> \"$ORB_LOG\"\n"
        f"case \"$last\" in openclaw) echo 'local/openclaw-amadeus:git-{commit}-20261015080000' ;;\n"
        f"product-radar) echo 'local/product-radar:git-{commit}-20261015080000' ;;\n*) exit 2 ;;\nesac\n",
        encoding="utf-8",
    )
    orb_stub.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "AMADEUS_HOST_PROFILE": str(profile), "ORB_LOG": str(log)}
    plan = invoke("bash", str(ROOT / "scripts/release-lab.sh"), "candidate", "--build-auto", env=env)
    assert plan.returncode == 0, plan.stderr
    assert "MODE=dry-run" in plan.stdout and "DEPLOYMENT_PHASE=candidate" in plan.stdout
    assert "AUTO_SCOPE_OPENCLAW=build" in plan.stdout and "AUTO_SCOPE_PRODUCT_RADAR=build" in plan.stdout
    orb_calls = log.read_text(encoding="utf-8")
    assert "docker inspect" in orb_calls and "docker compose" not in orb_calls and "docker run" not in orb_calls

print("RELEASE_TOOLING_TEST=passed manifest=protected drift=synthetic candidate=48h-reminder oci=amd64+arm64 cli=fail-closed")
