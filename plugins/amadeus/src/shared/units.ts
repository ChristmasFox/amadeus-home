/**
 * One byte-size convention for owner-facing reports: binary units labelled as such, fixed precision.
 * TiB and GiB keep two decimals, MiB and KiB are whole numbers. The agents' own "GB" strings are 1024-based.
 */
const UNIT_GIB: Record<string, number> = { B: 1 / 1024 ** 3, KB: 1 / 1024 ** 2, MB: 1 / 1024, GB: 1, TB: 1024, KIB: 1 / 1024 ** 2, MIB: 1 / 1024, GIB: 1, TIB: 1024 };

/** A capacity as GiB: "15.20 GB" (a 1024-based label) and "-514.81 MB" parse, a bare number is bytes. */
export function capacityGiB(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value / 1024 ** 3 : null;
  if (typeof value !== 'string') return null;
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*([KMGT]?i?B)\s*$/iu.exec(value);
  const factor = match?.[2] ? UNIT_GIB[match[2].toUpperCase()] : undefined;
  return match?.[1] && factor !== undefined ? Number(match[1]) * factor : null;
}

export function formatCapacity(gib: number | null): string {
  if (gib === null) return '未知';
  const size = Math.abs(gib);
  if (size >= 1024) return `${(gib / 1024).toFixed(2)} TiB`;
  if (size >= 1) return `${gib.toFixed(2)} GiB`;
  if (size >= 1 / 1024) return `${Math.round(gib * 1024)} MiB`;
  if (size > 0) return `${Math.round(gib * 1024 ** 2)} KiB`;
  return '0 B';
}

export function formatBytes(bytes: number): string {
  return formatCapacity(bytes / 1024 ** 3);
}

/**
 * Adds a ready-made `xxxBytesText` beside every `xxxBytes` number so the model copies one agreed string instead of
 * converting bytes itself. Chart-like `points` arrays are left alone.
 */
export function withByteText<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => withByteText(item)) as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'points') { out[key] = item; continue; }
    out[key] = withByteText(item);
    if (/Bytes$/u.test(key) && typeof item === 'number' && Number.isFinite(item) && item >= 0) out[`${key}Text`] = formatBytes(item);
  }
  return out as T;
}
