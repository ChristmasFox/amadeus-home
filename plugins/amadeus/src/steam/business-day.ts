import { BUSINESS_DAY_START, DEFAULT_TIMEZONE, businessDayLabel, businessDayWindow, latestCompleteBusinessDay, localTimeOn } from '@rine-kit/pubg-domain/core';

/**
 * Steam play time uses the SAME business day as the PUBG daily review: the same day arithmetic (the PUBG domain's own
 * `businessDayLabel` / `businessDayWindow` / `latestCompleteBusinessDay` / `localTimeOn`), the same defaults
 * (`DEFAULT_TIMEZONE`, `BUSINESS_DAY_START`) and the same configuration (the pubg plugin's `timezone` and
 * `businessDayStart`, with the same `PUBG_TIMEZONE` / `PUBG_BUSINESS_DAY_START` environment fallbacks). Nothing here
 * hard-codes a time zone, so the two can never drift apart.
 */
export const DAILY_PLAYTIME_CLOCK = '09:30';
export { BUSINESS_DAY_START, DEFAULT_TIMEZONE };

export interface BusinessCalendar {
  readonly timezone: string;
  /** HH:MM local time at which a business day begins. */
  readonly start: string;
  /** The business day (YYYY-MM-DD, the date it begins on) that contains this instant. */
  label(at: number): string;
  /** The instant range of a business day label, or undefined for a label that is not a real date. */
  windowOf(label: string): { startMs: number; endMs: number } | undefined;
  windowAt(at: number): { startMs: number; endMs: number };
  /** The last business day that has fully ended, as the PUBG daily review picks it. */
  latestComplete(now: number): string;
  /** When the daily 09:30 message for the business day `label` is due (09:30 the next local morning). */
  dueAt(label: string): number;
  /** "YYYY-MM-DD HH:mm" in the business time zone. */
  format(at: number): string;
  /** Plain-words description for tool results and notices. */
  describe(): string;
}

export function businessCalendar(timezone: string = DEFAULT_TIMEZONE, start: string = BUSINESS_DAY_START): BusinessCalendar {
  const windowOf = (label: string): { startMs: number; endMs: number } | undefined => {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(label)) return undefined;
    try {
      const window = businessDayWindow(label, timezone, start);
      return Number.isFinite(window.startMs) && businessDayLabel(window.startMs, timezone, start) === label ? { startMs: window.startMs, endMs: window.endMs } : undefined;
    } catch {
      return undefined;
    }
  };
  const label = (at: number): string => businessDayLabel(at, timezone, start);
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return {
    timezone, start, label, windowOf,
    windowAt: (at) => windowOf(label(at))!,
    latestComplete: (now) => latestCompleteBusinessDay(new Date(now), timezone, start),
    dueAt: (day) => localTimeOn(day, DAILY_PLAYTIME_CLOCK, timezone, 1).getTime(),
    format: (at) => format.format(new Date(at)).replace(/ /gu, ' '),
    describe: () => `每天 ${start} 切日（${timezone}，与 PUBG 业务日相同）`,
  };
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** The calendar the pubg plugin is configured with; unset values fall back exactly where PUBG falls back. */
export function businessCalendarFromConfig(openclawConfig: unknown, env: NodeJS.ProcessEnv = process.env): BusinessCalendar {
  const pubg = (openclawConfig as { plugins?: { entries?: { pubg?: { config?: Record<string, unknown> } } } } | undefined)?.plugins?.entries?.pubg?.config ?? {};
  return businessCalendar(text(pubg.timezone) ?? text(env.PUBG_TIMEZONE) ?? DEFAULT_TIMEZONE, text(pubg.businessDayStart) ?? text(env.PUBG_BUSINESS_DAY_START) ?? BUSINESS_DAY_START);
}
