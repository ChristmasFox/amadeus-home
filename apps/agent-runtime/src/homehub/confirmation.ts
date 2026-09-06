/** Opaque, bounded callback namespace shared by HomeHub and platform renderers. */
export const HOMEHUB_CALLBACK_VERSION = 'hh1' as const;
export type HomeHubCallbackAction = 'confirm' | 'cancel';

export interface HomeHubCallback {
  action: HomeHubCallbackAction;
  actionId: string;
}

/**
 * Keep callback data short enough for Telegram's 64-byte callback_data limit.
 * The complete binding (platform/chat/user/actionId) remains server-side in
 * ContextManager and is checked against the normalized callback event.
 */
export function homeHubCallbackData(action: HomeHubCallbackAction, actionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,48}$/u.test(actionId)) throw new Error('invalid HomeHub action ID');
  return `${HOMEHUB_CALLBACK_VERSION}:${action}:${actionId}`;
}

export function parseHomeHubCallback(value: unknown): HomeHubCallback | null {
  const text = String(value ?? '').trim();
  const match = text.match(/^hh1:(confirm|cancel):([A-Za-z0-9_-]{1,48})$/u);
  if (!match) return null;
  return { action: match[1] as HomeHubCallbackAction, actionId: match[2]! };
}

export function isHomeHubCallback(value: unknown): boolean {
  return parseHomeHubCallback(value) !== null;
}
