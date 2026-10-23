import type { MatchHighlight } from '@rine-kit/pubg-intelligence';

export const highlightClock = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export const highlightDate = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '比赛时间未知';

/** A local PNG, rendered with native canvas; no uploads, model calls or third-party image service. */
export function drawHighlightPoster(canvas: HTMLCanvasElement, item: MatchHighlight): void {
  canvas.width = 1200; canvas.height = 1500;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('poster_canvas_unavailable');
  const background = ctx.createLinearGradient(0, 0, 1200, 1500);
  background.addColorStop(0, '#152c29'); background.addColorStop(0.65, '#0c1719'); background.addColorStop(1, '#122321');
  ctx.fillStyle = background; ctx.fillRect(0, 0, 1200, 1500);
  ctx.strokeStyle = '#29423d'; ctx.lineWidth = 1;
  for (let x = 0; x < 1200; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1500); ctx.stroke(); }
  for (let y = 0; y < 1500; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke(); }
  ctx.fillStyle = '#0e1b1b'; ctx.fillRect(56, 56, 1088, 1388);
  ctx.fillStyle = '#b8f277'; ctx.fillRect(56, 56, 8, 1388);
  const text = (value: string, x: number, y: number, size: number, color = '#e7efea', weight = 400) => {
    ctx.font = `${weight} ${size}px system-ui, "PingFang SC", sans-serif`; ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  const wrapped = (value: string, y: number, size: number, color: string, maxLines: number, lineHeight = size * 1.65) => {
    ctx.font = `400 ${size}px system-ui, "PingFang SC", sans-serif`;
    const lines: string[] = []; let line = '';
    for (const char of Array.from(value)) {
      if (ctx.measureText(line + char).width > 944 && line) { lines.push(line); line = char; } else line += char;
    }
    if (line) lines.push(line);
    lines.slice(0, maxLines).forEach((row, index) => {
      const last = index === maxLines - 1 && lines.length > maxLines;
      text(last ? `${row.slice(0, -1)}…` : row, 112, y + index * lineHeight, size, color);
    });
  };
  text('PUBG  /  SQUAD HIGHLIGHTS', 112, 144, 24, '#b8f277', 600);
  text(item.title, 112, 267, 68, '#f0f7ee', 700);
  text(`${highlightClock(item.startSeconds)} — ${highlightClock(item.endSeconds)}`, 112, 345, 48, '#b8f277', 600);
  wrapped(item.players.map((player) => player.name).join('  ×  '), 420, 30, '#dfebe4', 2);
  text(`${item.mapLabel}  ·  ${highlightDate(item.createdAt)}（上海）`, 112, 545, 25, '#8da79e');
  ctx.strokeStyle = '#345046'; ctx.beginPath(); ctx.moveTo(112, 593); ctx.lineTo(1056, 593); ctx.stroke();
  wrapped(item.summary, 671, 37, '#e0eae4', 4);
  text('发生过的瞬间，有迹可循。', 112, 950, 23, '#b8f277', 600);
  wrapped(item.notes.join(' ') || '依据原始遥测已记录事件生成。', 1005, 22, '#90a79f', 4, 36);
  text(`对局  ${item.matchId}`, 112, 1205, 18, '#8ca197');
  wrapped(`事件  ${item.evidence.slice(0, 5).map((ref) => ref.eventId).join(' · ')}${item.evidence.length > 5 ? ` · 共 ${item.evidence.length} 条` : ''}`, 1250, 18, '#8ca197', 2, 28);
  text('INTELLIGENCE LAB', 112, 1375, 24, '#b8f277', 600);
  text('私人比赛档案 · 高光海报', 765, 1375, 22, '#8da79e');
}

export async function exportHighlightPoster(item: MatchHighlight, share = false): Promise<'shared' | 'downloaded'> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas'); drawHighlightPoster(canvas, item);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('poster_encode_failed')), 'image/png'));
  const filename = `pubg-highlight-${item.id}.png`;
  const file = new File([blob], filename, { type: 'image/png' });
  if (share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: item.title, text: item.summary });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}
