import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.openclaw_telemetry_mount import ARCHIVE_TARGET, ARCHIVE_VOLUME, ensure_archive_env, ensure_archive_mount, install


COMPOSE = """services:
  openclaw:
    image: local/openclaw:old
    environment:
      PUBG_DATABASE_PATH: /data/pubg.sqlite
    volumes:
      - /data/config:/home/node/.openclaw
      - /data:/data
  9router:
    image: local/9router:unchanged
    volumes:
      - /data/9router:/data
"""


class OpenClawTelemetryMountTests(unittest.TestCase):
    def test_installs_archive_mount_only_for_openclaw_and_is_idempotent(self):
        updated = ensure_archive_mount(COMPOSE, "local/openclaw:git-abc123")
        self.assertIn("image: local/openclaw:git-abc123", updated)
        self.assertEqual(updated.count(ARCHIVE_TARGET), 1)
        self.assertIn(f"      - {ARCHIVE_VOLUME}\n", updated)
        self.assertIn("  9router:\n    image: local/9router:unchanged\n", updated)
        self.assertIn("      - /data/9router:/data\n", updated)
        self.assertEqual(ensure_archive_mount(updated, "local/openclaw:git-abc123"), updated)

    def test_rejects_ambiguous_archive_mounts(self):
        duplicate = COMPOSE.replace("      - /data:/data\n", f"      - {ARCHIVE_VOLUME}\n      - {ARCHIVE_VOLUME}\n")
        with self.assertRaisesRegex(ValueError, "archive_mount_ambiguous"):
            ensure_archive_mount(duplicate, "local/openclaw:git-abc123")

    def test_archive_env_updates_one_key_and_preserves_other_runtime_settings(self):
        before = "OPENCLAW_HTTP_PROXY=http://proxy.invalid:7897\nPUBG_TELEMETRY_ARCHIVE_HOST_DIR=/old/archive\n"
        after = ensure_archive_env(before, "/Volumes/Avalon/archive")
        self.assertEqual(after, "OPENCLAW_HTTP_PROXY=http://proxy.invalid:7897\nPUBG_TELEMETRY_ARCHIVE_HOST_DIR=/Volumes/Avalon/archive\n")
        self.assertEqual(ensure_archive_env(after, "/Volumes/Avalon/archive"), after)

    def test_rejects_duplicate_archive_environment(self):
        with self.assertRaisesRegex(ValueError, "archive_env_ambiguous"):
            ensure_archive_env("PUBG_TELEMETRY_ARCHIVE_HOST_DIR=/one\nPUBG_TELEMETRY_ARCHIVE_HOST_DIR=/two\n", "/archive")

    def test_install_updates_only_openclaw_config_and_prepares_archive_directory(self):
        with TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            compose = root / "docker-compose.yml"
            env = root / ".env"
            archive = root / "archive"
            compose.write_text(COMPOSE, encoding="utf-8")
            env.write_text("OPENCLAW_HTTP_PROXY=http://proxy.invalid:7897\n", encoding="utf-8")
            (archive / "match-folder").mkdir(parents=True)
            payload = archive / "match-folder" / "capture.json.gz"
            payload.write_bytes(b"private telemetry")
            payload.chmod(0o644)
            with patch("scripts.openclaw_telemetry_mount.os.chown") as chown:
                install(compose, env, "local/openclaw:git-abc123", str(archive))
            updated = compose.read_text(encoding="utf-8")
            self.assertEqual(updated.count(ARCHIVE_TARGET), 1)
            self.assertIn("local/9router:unchanged", updated)
            self.assertIn("OPENCLAW_HTTP_PROXY=http://proxy.invalid:7897\n", env.read_text(encoding="utf-8"))
            self.assertIn(f"PUBG_TELEMETRY_ARCHIVE_HOST_DIR={archive}\n", env.read_text(encoding="utf-8"))
            self.assertEqual(archive.stat().st_mode & 0o777, 0o700)
            self.assertEqual((archive / "match-folder").stat().st_mode & 0o777, 0o700)
            self.assertEqual(payload.stat().st_mode & 0o777, 0o600)
            self.assertEqual(chown.call_count, 3)
            chown.assert_any_call(archive, 1000, 1000, follow_symlinks=False)
            chown.assert_any_call(archive / "match-folder", 1000, 1000, follow_symlinks=False)
            chown.assert_any_call(payload, 1000, 1000, follow_symlinks=False)

    def test_invalid_compose_leaves_archive_directory_and_runtime_config_untouched(self):
        with TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            compose = root / "docker-compose.yml"
            env = root / ".env"
            archive = root / "archive"
            compose.write_text("services:\n  openclaw:\n    image: old\n    image: duplicate\n", encoding="utf-8")
            before = compose.read_text(encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "image_ambiguous"):
                install(compose, env, "local/openclaw:git-abc123", str(archive))
            self.assertEqual(compose.read_text(encoding="utf-8"), before)
            self.assertFalse(env.exists())
            self.assertFalse(archive.exists())

    def test_candidate_installs_and_checks_the_persistent_mount_with_rollback_config(self):
        deploy_script = Path(__file__).resolve().parents[1] / "deploy-openclaw.sh"
        source = deploy_script.read_text(encoding="utf-8")
        self.assertIn('"$ROOT_DIR/scripts/openclaw_telemetry_mount.py"', source)
        self.assertIn("PUBG_TELEMETRY_ARCHIVE_MOUNT=passed", source)
        self.assertIn("--user node openclaw", source)
        self.assertIn("pubg-telemetry-archive.before", source)
        self.assertIn("PUBG_TELEMETRY_ARCHIVE_SOURCE=verified", source)
        self.assertIn("PUBG_TELEMETRY_ARCHIVE_BACKUP=verified", source)
        self.assertIn("openclaw-compose.env.before", source)


if __name__ == "__main__":
    unittest.main()
