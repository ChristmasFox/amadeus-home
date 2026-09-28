// Pure Japanese speech/text delivery policy; tested independently of compiled patches.
export function resolveAmadeusJapaneseSpeechText(visibleText, explicitTtsText = '') {
  const source = typeof visibleText === 'string' ? visibleText : '';
  const labeledCandidates = source.split(/\r?\n/u)
    .map((line) => line.trim().match(/^日本語[：:]\s*(.*)$/u)?.[1]?.trim() ?? '')
    .filter((line) => line && /[\u3040-\u30ff]/u.test(line));
  if (labeledCandidates.length > 0) return labeledCandidates.at(-1);

  const explicit = typeof explicitTtsText === 'string' ? explicitTtsText.trim() : '';
  if (explicit && !/(?:^|\n)\s*(?:中文|日本語)[：:]/u.test(explicit) && /[\u3040-\u30ff]/u.test(explicit)) {
    return explicit;
  }
  return '';
}

export function isAmadeusBilingualVoiceContract(visibleText) {
  const lines = (typeof visibleText === 'string' ? visibleText : '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 2 || !/^中文[：:]\s*\S/u.test(lines[0])) return false;
  const japanese = lines[1].match(/^日本語[：:]\s*(.*)$/u)?.[1]?.trim() ?? '';
  return Boolean(japanese && /[\u3040-\u30ff]/u.test(japanese));
}

export function ensureAmadeusJapaneseVoiceText(payload, isVoiceInbound) {
  if (!payload || typeof payload !== 'object') return payload;
  // The same final-response guard also covers an explicitly tagged typed
  // voice reply. Untagged typed media without TTS metadata is untouched.
  if (!isVoiceInbound && typeof payload.ttsSupplement?.spokenText !== 'string'
      && !(payload.audioAsVoice === true && typeof payload.spokenText === 'string')) return payload;
  const hasMedia = (typeof payload.mediaUrl === 'string' && payload.mediaUrl.trim().length > 0)
    || (Array.isArray(payload.mediaUrls) && payload.mediaUrls.some((url) => typeof url === 'string' && url.trim().length > 0));
  if (!hasMedia) return payload;
  const isTtsVoice = payload.audioAsVoice === true || typeof payload.ttsSupplement?.spokenText === 'string';
  if (!isTtsVoice) return payload;
  const supplementText = typeof payload.ttsSupplement?.spokenText === 'string' ? payload.ttsSupplement.spokenText : '';
  const spokenText = (supplementText || (typeof payload.spokenText === 'string' ? payload.spokenText : '')).trim();
  const visibleText = typeof payload.text === 'string' ? payload.text : '';
  const spokenTextIsStructuredOrMultiline = /(?:^|\n)\s*(?:中文|日本語)[：:]/u.test(spokenText) || /\r?\n/u.test(spokenText);
  if (spokenTextIsStructuredOrMultiline || !/[\u3040-\u30ff]/u.test(spokenText)) {
    // An untagged or non-Japanese final must never become a Chinese WhatsApp PTT.
    const safeText = visibleText.split(/\r?\n/u).filter((line) => !/^日本語[：:]/u.test(line.trim())).join('\n').trim();
    const warning = '日语语音暂时无法生成，请稍后重试。';
    const { mediaUrl: _mediaUrl, mediaUrls: _mediaUrls, audioAsVoice: _audioAsVoice,
      spokenText: _spokenText, ttsSupplement: _ttsSupplement, trustedLocalMedia: _trustedLocalMedia,
      ...textOnlyPayload } = payload;
    return { ...textOnlyPayload, text: safeText ? `${safeText}\n${warning}` : warning };
  }
  const normalizeAmadeusBilingualVisibleText = (sourceText, spoken) => {
    const chineseLines = (typeof sourceText === 'string' ? sourceText : '')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !/^日本語[：:]/u.test(line))
      .join('\n')
      .trim()
      .replace(/^中文[：:]\s*/u, '')
      .trim();
    return `中文：${chineseLines}\n\n日本語：${spoken}`;
  };
  const nextText = normalizeAmadeusBilingualVisibleText(visibleText, spokenText);
  return nextText === visibleText ? payload : { ...payload, text: nextText };
}
