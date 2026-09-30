import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import type { AttachmentPart } from './delivery-envelope.js';

export const MAX_ASSET_BYTES = 64 * 1024 * 1024;
export type AssetMetadata = Readonly<{ imageId: string; storageKey: string; mimeType: string; byteSize: number; sha256: string; status: string }>;
export type ResolvedDeliveryAsset = Readonly<{ bytes: Buffer; mimeType: string; fileName: string; byteSize: number; sha256: string }>;
export function assetPath(root: string, storageKey: string): string {
  if (!storageKey || isAbsolute(storageKey) || storageKey.includes('\\') || storageKey.includes('\0') || storageKey.split('/').some((item) => item === '..' || item === '.' || !item)) throw new Error('asset_storage_key_invalid');
  const path = resolve(root, storageKey);
  const rel = relative(resolve(root), path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('asset_storage_key_invalid');
  return path;
}
function sniffMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return undefined;
}
/** Registered metadata is authoritative. Reads never trust an Agent path. */
export async function readRegisteredAsset(root: string, part: AttachmentPart, metadata: AssetMetadata): Promise<ResolvedDeliveryAsset> {
  if (metadata.imageId !== part.assetId || metadata.status !== 'ready') throw new Error('asset_not_ready');
  if (!Number.isSafeInteger(metadata.byteSize) || metadata.byteSize <= 0 || metadata.byteSize > MAX_ASSET_BYTES || !/^[a-f0-9]{64}$/u.test(metadata.sha256)) throw new Error('asset_metadata_invalid');
  if (part.mimeType !== metadata.mimeType || (part.byteSize !== undefined && part.byteSize !== metadata.byteSize) || (part.sha256 !== undefined && part.sha256 !== metadata.sha256)) throw new Error('asset_metadata_mismatch');
  const base = await realpath(root);
  const candidate = assetPath(base, metadata.storageKey);
  const canonical = await realpath(candidate);
  if (canonical !== candidate || !relative(base, canonical) || relative(base, canonical).startsWith('..') || isAbsolute(relative(base, canonical))) throw new Error('asset_symlink_escape');
  const file = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (await realpath(candidate) !== canonical) throw new Error('asset_symlink_race');
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== metadata.byteSize) throw new Error('asset_size_mismatch');
    // Bounded read and digest verification also detect races/content replacement.
    const bytes = Buffer.alloc(metadata.byteSize);
    let offset = 0;
    while (offset < bytes.length) { const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset); if (!bytesRead) throw new Error('asset_truncated'); offset += bytesRead; }
    if ((await file.stat()).size !== bytes.length || sniffMime(bytes) !== metadata.mimeType || createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) throw new Error('asset_integrity_mismatch');
    return { bytes, mimeType: metadata.mimeType, fileName: part.fileName, byteSize: bytes.length, sha256: metadata.sha256 };
  } finally { await file.close(); }
}
