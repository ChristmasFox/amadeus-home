#!/usr/bin/env python3
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile

script = Path(__file__).with_name('install-lab-auto-repair.py').resolve()
with tempfile.TemporaryDirectory(prefix='lab-repair-installer-') as tmp:
    home = Path(tmp)
    bindir = home / 'bin'
    bindir.mkdir()
    launchctl = bindir / 'launchctl'
    launchctl.write_text('''#!/bin/sh
case "$1" in
  bootstrap) touch "$HOME/loaded" ;;
  bootout) rm -f "$HOME/loaded" ;;
  print) test -f "$HOME/loaded" ;;
esac
''')
    launchctl.chmod(0o755)
    env = dict(os.environ, HOME=str(home), PATH=str(bindir) + os.pathsep + os.environ['PATH'])
    def call(action):
        return subprocess.run(['python3', str(script), action], env=env, capture_output=True, text=True)
    assert call('check').returncode != 0
    assert call('install').returncode == 0
    plist = home / 'Library/LaunchAgents/com.amadeus.lab-auto-repair.plist'
    data = plistlib.loads(plist.read_bytes())
    assert data['StartInterval'] == 30 and data['EnvironmentVariables']['ORBSTACK_MACHINE'] == 'nyannyan'
    assert plist.stat().st_mode & 0o077 == 0
    assert call('check').returncode == 0
    assert call('uninstall').returncode == 0
    assert not plist.exists()
print('Lab auto-repair scheduler tests passed')
