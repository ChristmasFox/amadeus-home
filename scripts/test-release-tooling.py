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
snapshot = load_module("lab_runtime_snapshot", "lab-runtime-snapshot.py")
impact = load_module("image_impact", "image-impact.py")
oci = load_module("verify_pubg_saas_oci", "verify-pubg-saas-oci.py")
provenance = load_module("verify_image_provenance", "verify-image-provenance.py")
test_database = load_module("validate_pubg_saas_test_database", "validate-pubg-saas-test-database.py")


def invoke(*args: str, cwd: Path = ROOT, env=None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, check=False)


now = datetime(2026, 10, 15, 8, 0, tzinfo=timezone.utc)
sha = "a" * 40
digest = "sha256:" + "b" * 64
assert '{{with (index .Config "Labels")}}' in snapshot.IMAGE_INSPECT_FORMAT
fixture_image_id = "sha256:" + "c" * 64
missing_labels = "|".join((
    fixture_image_id, "[]", "<no value>", "<no value>", "<no value>", "<no value>",
    "2026-10-15T07:00:00.000000000Z",
))
with tempfile.TemporaryDirectory(prefix="release-snapshot-git-") as temporary:
    unavailable = snapshot.parse_image_inspect_output(
        missing_labels,
        fixture_image_id,
        "local/product-radar:git-ffffffffffff-20261015070000",
        Path(temporary),
    )
    assert unavailable["gitSha"] is None and unavailable["version"] is None
    assert unavailable["provenanceSource"] == "unavailable"
current_sha = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
current_prefix = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short=12", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
current_version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
tag_fallback = snapshot.parse_image_inspect_output(
    missing_labels,
    fixture_image_id,
    f"local/openclaw-amadeus:git-{current_prefix}-20261015070000",
)
assert tag_fallback["gitSha"] == current_sha and tag_fallback["version"] == current_version
assert tag_fallback["provenanceSource"] == "immutable-image-tag+git-source"
inherited_labels = "|".join((
    fixture_image_id, "[]", "base-image", "e" * 40, "2026.9.4",
    "2026-09-10T22:52:04.118Z", "2026-10-15T07:00:00.000000000Z",
))
ignored_base_labels = snapshot.parse_image_inspect_output(
    inherited_labels,
    fixture_image_id,
    f"local/openclaw-amadeus:git-{current_prefix}-20261015070000",
)
assert ignored_base_labels["gitSha"] == current_sha and ignored_base_labels["version"] == current_version
assert ignored_base_labels["builtAt"] == "2026-10-15T07:00:00.000000000Z"
assert ignored_base_labels["provenanceSource"] == "immutable-image-tag+git-source"
labelled = snapshot.parse_image_inspect_output(
    "|".join((fixture_image_id, f'["local/image@{digest}"]', snapshot.PROVENANCE_MARKER, sha, "1.10.5", "2026-10-15T07:00:00Z", "2026-10-15T07:00:00.000000000Z")),
    fixture_image_id,
    "local/image:ci",
)
assert labelled["digest"] == digest and labelled["gitSha"] == sha and labelled["version"] == "1.10.5"
assert labelled["provenanceSource"] == "oci-label"
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


def oci_fixture(path: Path, labels: dict[str, str], include_attestations: bool = False) -> None:
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
        if include_attestations:
            attestation_config = json.dumps({
                "architecture": "unknown",
                "os": "unknown",
                "config": {"Labels": {}},
                "rootfs": {"type": "layers", "diff_ids": []},
            }, separators=(",", ":")).encode()
            attestation_config_hash = hashlib.sha256(attestation_config).hexdigest()
            entries[f"blobs/sha256/{attestation_config_hash}"] = attestation_config
            attestation_manifest = json.dumps({
                "schemaVersion": 2,
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "config": {
                    "mediaType": "application/vnd.oci.image.config.v1+json",
                    "digest": f"sha256:{attestation_config_hash}",
                    "size": len(attestation_config),
                },
                "layers": [],
            }, separators=(",", ":")).encode()
            attestation_hash = hashlib.sha256(attestation_manifest).hexdigest()
            entries[f"blobs/sha256/{attestation_hash}"] = attestation_manifest
            manifests.append({
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "digest": f"sha256:{attestation_hash}",
                "size": len(attestation_manifest),
                "platform": {"architecture": "unknown", "os": "unknown"},
                "annotations": {
                    "vnd.docker.reference.type": "attestation-manifest",
                    "vnd.docker.reference.digest": f"sha256:{manifest_hash}",
                },
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
    "com.amadeus.release.provenance": "amadeus-product-release-v1",
    "org.opencontainers.image.revision": sha,
    "org.opencontainers.image.version": "1.10.5",
    "org.opencontainers.image.created": "2026-10-15T07:00:00Z",
}
provenance.validate(labels, sha, "1.10.5", "2026-10-15T07:00:00Z")
assert test_database.validate_test_database_url(None) == "missing"
assert test_database.validate_test_database_url(
    "postgresql://postgres:fixturepass@localhost:5432/pubg_test"
) is None
assert test_database.validate_test_database_url("postgres://user@127.0.0.1:5432/team_testing") is None
assert test_database.validate_test_database_url("postgres://user@db.example.com:5432/pubg_test") == "host"
assert test_database.validate_test_database_url("postgres://user@localhost:5432/production") == "database_name"
assert test_database.validate_test_database_url(
    "postgres://user@localhost:5432/pubg_test?host=db.example.com"
) == "query_parameters"
assert test_database.validate_test_database_url("https://localhost:5432/pubg_test") == "scheme"
safe_test_database = invoke(
    "python3", str(ROOT / "scripts/validate-pubg-saas-test-database.py"),
    env={**os.environ, "PUBG_SAAS_TEST_DATABASE_URL": "postgresql://postgres:fixturepass@localhost:5432/pubg_test"},
)
assert safe_test_database.returncode == 0 and "GATE_TEST_DATABASE=SAFE" in safe_test_database.stdout
unsafe_test_database_url = "postgresql://tester:fixturepass@db.example.com:5432/production"
unsafe_test_database = invoke(
    "python3", str(ROOT / "scripts/validate-pubg-saas-test-database.py"),
    env={**os.environ, "PUBG_SAAS_TEST_DATABASE_URL": unsafe_test_database_url},
)
assert unsafe_test_database.returncode != 0 and "reason=host" in unsafe_test_database.stderr
assert "fixturepass" not in unsafe_test_database.stdout + unsafe_test_database.stderr
try:
    provenance.validate({**labels, "com.amadeus.release.provenance": "base-image"}, sha, "1.10.5", "2026-10-15T07:00:00Z")
except ValueError as error:
    assert "provenance" in str(error)
else:
    raise AssertionError("image without the product provenance marker unexpectedly passed")
with tempfile.TemporaryDirectory(prefix="release-oci-test-") as temporary:
    archive = Path(temporary) / "gate.oci.tar"
    oci_fixture(archive, labels, include_attestations=True)
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
gate_verify_env = dict(os.environ)
gate_verify_env.pop("PUBG_SAAS_TEST_DATABASE_URL", None)
gate_verify_without_database = invoke(
    "bash", str(ROOT / "scripts/release-gate.sh"), "verify", env=gate_verify_env,
)
assert gate_verify_without_database.returncode != 0
assert "GATE_TEST_DATABASE=BLOCKED reason=missing" in gate_verify_without_database.stderr
assert "test:pubg-saas" not in gate_verify_without_database.stdout
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
    assert help_output.stderr == "", f"{wrapper} help must not execute shell substitutions: {help_output.stderr}"
lab_help = invoke("bash", str(ROOT / "scripts/release-lab.sh"), "--help").stdout
gate_help = invoke("bash", str(ROOT / "scripts/release-gate.sh"), "--help").stdout
assert "Lab build selection" in lab_help and "--memory-acceptance" in lab_help
assert "--environment" not in lab_help and "Gate" not in lab_help
assert "gate-local|gate-staging|gate-prod" in gate_help
assert "M2 remains paused" in gate_help and "reviewed" in gate_help
assert "PUBG_SAAS_TEST_DATABASE_URL" in gate_help
assert "database named `test`/`testing`" in gate_help
assert all(option not in gate_help for option in ("--build-auto", "--lineage-bridge", "--live", "--memory-acceptance"))
release_cli = (ROOT / "scripts/release-cli.sh").read_text(encoding="utf-8")
assert 'manifest_services="$(python3 - "$MANIFEST"' in release_cli
assert 'snapshot_args+=(--service "$service")' in release_cli
assert "--promote-live-candidate" in release_cli and "LIVE_CANDIDATE_MATCH=passed" in release_cli

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
    full_commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    changed_paths = impact.git_names(ROOT, full_commit, "HEAD")
    expected_openclaw = "build" if impact.classify(ROOT, "openclaw", changed_paths)[0] != "REUSE" else "reuse"
    expected_radar = "build" if impact.classify(ROOT, "radar", changed_paths)[0] != "REUSE" else "reuse"
    assert f"AUTO_SCOPE_OPENCLAW={expected_openclaw}" in plan.stdout
    assert f"AUTO_SCOPE_PRODUCT_RADAR={expected_radar}" in plan.stdout
    orb_calls = log.read_text(encoding="utf-8")
    assert "docker inspect" in orb_calls and "docker compose" not in orb_calls and "docker run" not in orb_calls

print("RELEASE_TOOLING_TEST=passed manifest=protected drift=synthetic candidate=48h-reminder oci=amd64+arm64 cli=fail-closed product-help=distinct gate-test-db=loopback-only")
