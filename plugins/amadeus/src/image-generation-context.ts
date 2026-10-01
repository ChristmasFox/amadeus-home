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

export function imageRequestLanguageInstruction(value: string | undefined): string {
  switch (detectImageRequestLanguage(value)) {
    case 'chinese': return 'The current user request is Chinese. Reply only in natural Chinese; do not switch to English or Japanese.';
    case 'japanese': return '現在のユーザーリクエストは日本語です。自然な日本語だけで返答し、英語や中国語に切り替えないでください。';
    case 'english': return 'The current user request is English. Reply only in natural English; do not switch to Chinese or Japanese.';
    case 'unknown': return 'Use the current scoped conversation language when it is clear.';
  }
}

/** Fail closed on a clearly wrong language; this guards against the model's persona-default language. */
export function imageResponseMatchesRequestLanguage(request: string | undefined, response: string): boolean {
  const expected = detectImageRequestLanguage(request);
  return expected === 'unknown' || detectImageRequestLanguage(response) === expected;
}
