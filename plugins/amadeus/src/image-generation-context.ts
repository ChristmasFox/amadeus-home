const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;
export const MAX_IMAGE_REQUEST_CONTEXT = 480;

/** Keep original request text small and printable; callers must treat it as untrusted context only. */
export function boundedImageRequestContext(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const clean = value.normalize('NFC').replace(CONTROL, '').replace(/\s+/gu, ' ').trim();
  if (!clean) return undefined;
  return [...clean].slice(0, MAX_IMAGE_REQUEST_CONTEXT).join('');
}

export type ImageRequestLanguage = 'chinese' | 'japanese' | 'english' | 'unknown';

/** Language detection is used only for deterministic failure notices, never routing or task decisions. */
export function detectImageRequestLanguage(value: string | undefined): ImageRequestLanguage {
  if (!value) return 'unknown';
  if (/[\u3040-\u30ff\u31f0-\u31ff]/u.test(value)) return 'japanese';
  if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(value)) return 'chinese';
  if (/[A-Za-z]/u.test(value)) return 'english';
  return 'unknown';
}
