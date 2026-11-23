#!/usr/bin/env python3
"""Install or inspect the M204 Lab repair worker launchd service."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LABEL = 'com.amadeus.lab-auto-repair'
PLIST = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
DOMAIN = f'gui/{os.getuid()}'


def definition():
    return {'Label': LABEL,
            # zsh sources the host's proxy configuration via .zshenv.
            'ProgramArguments': ['/bin/zsh', '-lc', 'exec /usr/bin/python3 "$1"', '--', str(ROOT / 'scripts/lab-auto-repair.py')],
            'StartInterval': 30, 'RunAtLoad': True, 'ProcessType': 'Utility',
            'EnvironmentVariables': {'HOME': str(Path.home()), 'ORBSTACK_MACHINE': 'nyannyan',
                                     'PATH': str(Path.home() / 'Library/pnpm/bin') + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
            'StandardOutPath': '/dev/null', 'StandardErrorPath': '/dev/null'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['install', 'check', 'uninstall'])
    args = parser.parse_args()
    if args.action == 'install':
        PLIST.parent.mkdir(parents=True, exist_ok=True)
        PLIST.write_bytes(plistlib.dumps(definition(), sort_keys=False))
        PLIST.chmod(0o600)
        subprocess.run(['launchctl', 'bootout', f'{DOMAIN}/{LABEL}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['launchctl', 'bootstrap', DOMAIN, str(PLIST)], check=True)
    elif args.action == 'uninstall':
        subprocess.run(['launchctl', 'bootout', f'{DOMAIN}/{LABEL}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        PLIST.unlink(missing_ok=True)
        return
    loaded = subprocess.run(['launchctl', 'print', f'{DOMAIN}/{LABEL}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if not PLIST.is_file() or plistlib.loads(PLIST.read_bytes()) != definition() or not loaded:
        raise SystemExit('Lab auto-repair scheduler is not installed or not loaded')
    print('LAB_AUTO_REPAIR_SCHEDULER=loaded')


if __name__ == '__main__':
    main()
