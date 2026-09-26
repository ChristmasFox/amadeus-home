#!/usr/bin/env python3
"""Validate protected, pinned community MLX source/model/dependencies outside Git."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def preflight(root: Path, config: dict) -> dict:
    if not root.is_absolute() or root.is_symlink() or not root.is_dir() or root.stat().st_mode & 0o077:
        raise ValueError('private_mlx_root_required')
    source = root / 'mlx-audio'
    model = root / 'model-8bit'
    venv_python = root / 'venv/bin/python'
    if (not source.is_dir() or source.is_symlink() or not model.is_dir() or model.is_symlink()
            or model.stat().st_mode & 0o077 or not venv_python.is_file()):
        raise ValueError('protected_mlx_assets_missing')
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != config['mlxSourceRevision']:
        raise ValueError('mlx_source_revision_mismatch')
    if subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip():
        raise ValueError('mlx_source_dirty')
    version_script = ('import importlib.metadata as m,json; '
                      'print(json.dumps({n:m.version(n) for n in '+repr(['mlx-audio', *config['mlxDependencies']])+ '}))')
    versions = json.loads(subprocess.check_output([str(venv_python), '-c', version_script], text=True))
    expected_versions = {'mlx-audio': config['mlxPackageVersion'], **config['mlxDependencies']}
    if versions != expected_versions:
        raise ValueError('mlx_dependency_version_mismatch')
    files = sorted({model / 'config.json', *model.rglob('*.safetensors')})
    if len(files) < 3:
        raise ValueError('mlx_model_files_missing')
    checksums = {}
    for path in files:
        if path.is_symlink() or not path.is_file() or not path.stat().st_size or path.stat().st_mode & 0o077:
            raise ValueError('unprotected_mlx_model_file')
        checksums[str(path.relative_to(model))] = sha256(path)
    return {'sourceRevision': revision, 'modelId': config['mlxModelId'],
            'modelRevision': config['mlxModelRevision'], 'packageVersions': versions,
            'modelSha256': checksums}


def verify_manifest(root: Path, expected: dict) -> None:
    manifest = root / 'asset-manifest.json'
    if not manifest.is_file() or manifest.is_symlink() or manifest.stat().st_mode & 0o077:
        raise ValueError('protected_mlx_manifest_required')
    if json.loads(manifest.read_text()) != expected:
        raise ValueError('mlx_asset_manifest_mismatch')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--config', type=Path, default=Path(__file__).with_name('qwen3-tts-engine.json'))
    parser.add_argument('--write-manifest', action='store_true')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.write_manifest and not args.apply:
        raise SystemExit('--write-manifest requires --apply')
    config = json.loads(args.config.read_text())
    expected = preflight(args.root, config)
    if args.write_manifest:
        manifest = args.root / 'asset-manifest.json'
        if manifest.exists():
            verify_manifest(args.root, expected)
        else:
            fd = os.open(manifest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as target:
                target.write(json.dumps(expected, indent=2, sort_keys=True) + '\n')
    verify_manifest(args.root, expected)
    print('MLX_ASSETS=verified pinned source, model checksums and dependency versions (values suppressed)')

if __name__ == '__main__':
    main()
