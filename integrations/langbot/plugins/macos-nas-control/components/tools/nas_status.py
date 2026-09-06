from __future__ import annotations

import os
import re
from typing import Any

try:
    from langbot_plugin.api.definition.components.tool.tool import Tool
except ImportError:
    # Keep pure formatter tests runnable outside the LangBot container. The
    # real plugin runtime always provides the framework base class.
    class Tool:
        pass


def _clean(value: Any, limit: int = 240) -> str:
    text = str(value or '').replace('\r', ' ').replace('\n', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:limit]


def _parse_status(raw: str) -> tuple[dict[str, str], list[str]]:
    fields: dict[str, str] = {}
    processes: list[str] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith('TOP_PROCESS='):
            processes.append(line.split('=', 1)[1].strip())
            continue
        if '=' in line:
            key, value = line.split('=', 1)
            fields[key.strip()] = value.strip()
    return fields, processes


def _disk_line(value: str, label: str) -> str:
    parts = [part.strip() for part in value.split('|')]
    if len(parts) < 4 or not any(parts):
        return f'{label}：不可用'
    size, used, available, capacity = parts[:4]
    warning = ' ⚠️' if capacity.rstrip('%').isdigit() and int(capacity.rstrip('%')) >= 90 else ''
    return f'{label}：{used} / {size}，可用 {available}，已用 {capacity}{warning}'


def format_nas_status(raw: str) -> str:
    """Render the allowlisted NAS status response as a compact mobile card."""
    fields, processes = _parse_status(raw)
    if fields.get('NAS_STATUS_VERSION') != '2':
        # Backwards-compatible rendering while an older forced-command script
        # is still installed on the Mac host.
        legacy = [line.strip() for line in raw.splitlines() if line.strip()]
        host = next((line.split('=', 1)[1] for line in legacy if line.startswith('host=')), '未知')
        uptime = next((line.split('=', 1)[1] for line in legacy if line.startswith('uptime=')), '未知')
        disk_index = next((index for index, line in enumerate(legacy) if line == 'disk:'), -1)
        disk = legacy[disk_index + 1] if disk_index >= 0 and disk_index + 1 < len(legacy) else '不可用'
        return '\n'.join([
            '🖥️ NAS 状态',
            f'主机：{_clean(host)}',
            f'运行时间：{_clean(uptime)}',
            f'💾 磁盘：{_clean(disk)}',
        ])

    host = _clean(fields.get('HOST', '未知'))
    os_name = _clean(fields.get('OS_NAME', 'macOS'))
    os_version = _clean(fields.get('OS_VERSION', ''))
    os_build = _clean(fields.get('OS_BUILD', ''))
    system = ' '.join(part for part in (os_name, os_version and f'v{os_version}', os_build and f'({os_build})') if part)
    model = _clean(fields.get('MODEL', '未知'))
    cpu = f"{_clean(fields.get('CPU_LOGICAL', fields.get('CPU_PHYSICAL', '未知')))} 逻辑核"
    if fields.get('CPU_PHYSICAL') and fields.get('CPU_LOGICAL') and fields['CPU_PHYSICAL'] != fields['CPU_LOGICAL']:
        cpu = f"{_clean(fields['CPU_PHYSICAL'])} 核 / {_clean(fields['CPU_LOGICAL'])} 逻辑核"
    load = _clean(fields.get('LOAD_AVERAGE', '未知'))
    uptime = _clean(fields.get('UPTIME', '未知'))
    user_count = _clean(fields.get('USER_COUNT', '0'))

    memory = '不可用'
    total_bytes = fields.get('MEM_TOTAL_BYTES', '')
    free_percent = fields.get('MEM_FREE_PERCENT', '')
    if total_bytes.isdigit():
        total_gib = int(total_bytes) / (1024 ** 3)
        if free_percent.isdigit():
            free = int(free_percent)
            memory = f'{total_gib:.1f} GiB，总计；已用 {100 - free}% / 可用 {free}%'
        else:
            memory = f'{total_gib:.1f} GiB，总计；可用比例未知'

    network_parts = [part for part in (
        _clean(fields.get('NETWORK_INTERFACE', '')),
        _clean(fields.get('IP_ADDRESS', '')),
        _clean(fields.get('GATEWAY', '')) and f"网关 {_clean(fields['GATEWAY'])}",
    ) if part]
    network = ' · '.join(network_parts) or '不可用'
    power = _clean(fields.get('POWER', '不可用'))
    cloudflared = _clean(fields.get('CLOUDFLARED', '未知'))

    lines = [
        '🖥️ NAS 系统状态',
        f'✅ 主机：{host}',
        f'🧩 系统：{system or "macOS"}',
        f'💻 型号：{model}',
        f'⚙️ CPU：{cpu}',
        f'📈 负载：{load}',
        f'⏱️ 运行：{uptime}',
        f'👤 登录用户：{user_count}',
        f'🧠 内存：{memory}',
        '💾 磁盘：',
        f'  {_disk_line(fields.get("DISK_ROOT", ""), "系统盘")}',
        f'  {_disk_line(fields.get("DISK_AVALON", ""), "Avalon")}',
        f'🌐 网络：{network}',
        f'🔋 电源：{power}',
        f'☁️ cloudflared：{cloudflared}',
    ]
    if processes:
        lines.append('🔥 高占用进程：')
        for process in processes[:3]:
            parts = process.split('|', 3)
            if len(parts) == 4:
                lines.append(f'  {parts[1]} · CPU {parts[2]}% · 内存 {parts[3]}%')
            else:
                lines.append(f'  {_clean(process, 160)}')
    return '\n'.join(lines)


async def run_remote(command: str) -> str:
    import asyncssh

    async with asyncssh.connect(
        os.environ.get('MAC_CONTROL_HOST', 'host.docker.internal'),
        username=os.environ.get('MAC_CONTROL_USER', 'blacksidev'),
        client_keys=[os.environ.get('MAC_CONTROL_KEY', '/run/langbot-ssh/id_ed25519')],
        known_hosts=None,
        login_timeout=8,
    ) as connection:
        result = await connection.run(command, check=False, timeout=15)
        if result.exit_status != 0:
            raise RuntimeError(result.stderr.strip() or 'remote command failed')
        return result.stdout.strip()


class NasStatusTool(Tool):
    async def call(self, params, session, query_id) -> str:
        try:
            return format_nas_status(await run_remote('nas.status'))
        except Exception as exc:
            return f'❌ NAS 状态获取失败：{type(exc).__name__}'
