import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import type { AmadeusConfig } from './config.js';

export type NasAction = 'status' | 'disk' | 'sleep';

function clean(value: string, max = 240): string {
  return value.replace(/[\u0000\r\n]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function diskLine(value: string, label: string): string {
  const [size, used, available, capacity] = value.split('|').map((part) => part.trim());
  return size && used && available && capacity ? `${label}：已用 ${used} / ${size}，可用 ${available}，使用率 ${capacity}` : `${label}：不可用`;
}

function formatStatus(raw: string): string {
  const fields = new Map<string, string>();
  const processes: string[] = [];
  for (const line of raw.split('\n')) {
    const index = line.indexOf('=');
    if (line.startsWith('TOP_PROCESS=')) processes.push(line.slice('TOP_PROCESS='.length));
    else if (index > 0) fields.set(line.slice(0, index), line.slice(index + 1));
  }
  if (fields.get('NAS_STATUS_VERSION') !== '2') return clean(raw, 4000);
  const total = Number(fields.get('MEM_TOTAL_BYTES') ?? '');
  const free = Number(fields.get('MEM_FREE_PERCENT') ?? '');
  const memory = Number.isFinite(total) && total > 0
    ? `${(total / 1024 ** 3).toFixed(1)} GiB，总计；已用 ${Number.isFinite(free) ? 100 - free : '?'}%`
    : '不可用';
  const lines = [
    '🖥️ NAS 系统状态',
    `✅ 主机：${clean(fields.get('HOST') ?? '未知')}`,
    `🧩 系统：${clean([fields.get('OS_NAME'), fields.get('OS_VERSION') && `v${fields.get('OS_VERSION')}`, fields.get('OS_BUILD') && `(${fields.get('OS_BUILD')})`].filter(Boolean).join(' ') || 'macOS')}`,
    `💻 型号：${clean(fields.get('MODEL') ?? '未知')}`,
    `⚙️ CPU：${clean(fields.get('CPU_PHYSICAL') ?? '?')} 核 / ${clean(fields.get('CPU_LOGICAL') ?? '?')} 逻辑核`,
    `📈 负载：${clean(fields.get('LOAD_AVERAGE') ?? '未知')}`,
    `⏱️ 运行：${clean(fields.get('UPTIME') ?? '未知')}`,
    `🧠 内存：${memory}`,
    '💾 磁盘：',
    `  ${diskLine(fields.get('DISK_ROOT') ?? '', '系统盘')}`,
    `  ${diskLine(fields.get('DISK_AVALON') ?? '', 'Avalon')}`,
    `🌐 网络：${clean([fields.get('NETWORK_INTERFACE'), fields.get('IP_ADDRESS'), fields.get('GATEWAY') && `网关 ${fields.get('GATEWAY')}`].filter(Boolean).join(' · ') || '不可用')}`,
    `🔋 电源：${clean([fields.get('POWER_SOURCE'), fields.get('BATTERY_PERCENT'), fields.get('BATTERY_STATE')].filter(Boolean).join(' · ') || '不可用')}`,
    `☁️ cloudflared：${clean(fields.get('CLOUDFLARED') ?? '未知')}`,
  ];
  if (processes.length) lines.push('🔥 高占用进程：', ...processes.slice(0, 3).map((value) => `  ${clean(value, 160)}`));
  return lines.join('\n');
}

async function remote(config: AmadeusConfig, command: string, signal?: AbortSignal): Promise<string> {
  const key = await readFile(config.macSshKeyFile, 'utf8');
  if (!key.trim()) throw new Error('Mac SSH key is empty');
  const args = ['-i', config.macSshKeyFile, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=1'];
  if (config.macSshKnownHostsFile) args.push('-o', `UserKnownHostsFile=${config.macSshKnownHostsFile}`, '-o', 'StrictHostKeyChecking=yes');
  else args.push('-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null');
  args.push(`${config.macSshUser}@${config.macSshHost}`, command);
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const abort = (): void => { child.kill('SIGTERM'); };
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', reject);
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(clean(stderr || `NAS command exited with ${code ?? 'unknown'}`)));
    });
  });
}

export async function nas(config: AmadeusConfig, action: NasAction, context: OpenClawPluginToolContext, signal?: AbortSignal): Promise<unknown> {
  if (!config.macSshUser.trim()) throw new Error('Mac control user is not configured; set MAC_CONTROL_USER outside Git');
  if (action === 'sleep' && context.senderIsOwner !== true) throw new Error('NAS sleep requires owner identity');
  const raw = await remote(config, `nas.${action}`, signal);
  return { action, text: action === 'status' ? formatStatus(raw) : clean(raw, 4000) };
}
