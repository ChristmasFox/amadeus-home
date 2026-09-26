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

export function ensureAmadeusJapaneseVoiceText(payload, isVoiceInbound) {
  if (!isVoiceInbound || !payload || typeof payload !== 'object') return payload;
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
    // An untagged Chinese-only final must never become a Chinese WhatsApp PTT.
    // Return text-only instead of trying to relabel or reuse already-synthesized audio.
    const safeText = visibleText.split(/\r?\n/u).filter((line) => !/^日本語[：:]/u.test(line.trim())).join('\n').trim();
    const warning = '日语语音暂时无法生成，请稍后重试。';
    const { mediaUrl: _mediaUrl, mediaUrls: _mediaUrls, audioAsVoice: _audioAsVoice,
      spokenText: _spokenText, ttsSupplement: _ttsSupplement, trustedLocalMedia: _trustedLocalMedia,
      ...textOnlyPayload } = payload;
    return { ...textOnlyPayload, text: safeText ? `${safeText}\n${warning}` : warning };
  }
  const outputLines = [];
  let japaneseLineWritten = false;
  for (const line of visibleText.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (/^日本語[：:]/u.test(trimmed) || trimmed === spokenText) {
      if (!japaneseLineWritten) outputLines.push(`日本語：${spokenText}`);
      japaneseLineWritten = true;
      continue;
    }
    outputLines.push(line);
  }
  if (!japaneseLineWritten) outputLines.push(`日本語：${spokenText}`);
  const japaneseIndex = outputLines.findIndex((line) => /^日本語[：:]/u.test(line.trim()));
  if (japaneseIndex > 0) {
    let insertAt = japaneseIndex;
    while (insertAt > 0 && outputLines[insertAt - 1].trim() === '') {
      outputLines.splice(insertAt - 1, 1);
      insertAt -= 1;
    }
    outputLines.splice(insertAt, 0, '');
  }
  const nextText = outputLines.join('\n').trim();
  return nextText === visibleText ? payload : { ...payload, text: nextText };
}
