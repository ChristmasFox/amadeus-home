import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One authorization file per sender, named by a hash of the sender key (never the number) and readable only by the service. */
export type LuckinAuthRecord = Readonly<{ token: string; savedAt: string; expiresAt?: string }>;
type OrdersFile = { orders: Array<{ ref: string; orderId: string; createdAt: string }> };

export const senderFileId = (senderKey: string): string => createHash('sha256').update(senderKey).digest('hex').slice(0, 32);

export class LuckinAuthStore {
  constructor(private readonly dir: string) {}
  private file(senderKey: string, suffix = 'auth'): string { return join(this.dir, `${senderFileId(senderKey)}.${suffix}.json`); }

  async read(senderKey: string): Promise<LuckinAuthRecord | undefined> {
    try {
      const value = JSON.parse(await readFile(this.file(senderKey), 'utf8')) as Partial<LuckinAuthRecord>;
      return typeof value.token === 'string' && value.token ? { token: value.token, savedAt: String(value.savedAt ?? ''), ...(value.expiresAt ? { expiresAt: String(value.expiresAt) } : {}) } : undefined;
    } catch { return undefined; }
  }

  async write(senderKey: string, record: LuckinAuthRecord): Promise<void> { await this.writePrivate(this.file(senderKey), record); }

  private async writePrivate(path: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, path);
  }

  /** The orders this sender created through Lab; a short reference stands for the long order id in chat. */
  async addOrder(senderKey: string, orderId: string, now: Date): Promise<string> {
    const file = await this.orders(senderKey);
    const existing = file.orders.find((order) => order.orderId === orderId);
    if (existing) return existing.ref;
    let ref = orderId.slice(-6);
    while (file.orders.some((order) => order.ref === ref)) ref = randomBytes(3).toString('hex');
    file.orders.push({ ref, orderId, createdAt: now.toISOString() });
    await this.writePrivate(this.file(senderKey, 'orders'), { orders: file.orders.slice(-50) });
    return ref;
  }
  async orderIdFor(senderKey: string, ref: string): Promise<string | undefined> { return (await this.orders(senderKey)).orders.find((order) => order.ref === ref)?.orderId; }
  private async orders(senderKey: string): Promise<OrdersFile> {
    try { const value = JSON.parse(await readFile(this.file(senderKey, 'orders'), 'utf8')) as OrdersFile; return Array.isArray(value.orders) ? value : { orders: [] }; } catch { return { orders: [] }; }
  }
}
