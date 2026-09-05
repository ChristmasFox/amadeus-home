export function splitMessage(text: string, maxLength: number): string[] {
  if (maxLength < 1) throw new Error('maxLength must be positive');
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const candidate = remaining.slice(0, maxLength + 1);
    const paragraphBreak = candidate.lastIndexOf('\n\n');
    const lineBreak = candidate.lastIndexOf('\n');
    const spaceBreak = candidate.lastIndexOf(' ');
    const splitAt = paragraphBreak > 0 ? paragraphBreak : lineBreak > 0 ? lineBreak : spaceBreak > 0 ? spaceBreak : maxLength;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}
