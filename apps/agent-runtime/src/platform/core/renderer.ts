import type { BotResponse, NormalizedBotMessage, PlatformCapabilities, PlatformId, PlatformRenderer, PresentationModel } from './contracts.js';
import { getPlatformCapabilities } from './capabilities.js';
import { splitMessage } from './chunking.js';

function presentationBlocks(presentation: PresentationModel, maxLength: number): string[] {
  const sectionTexts = presentation.sections
    .map((section) => section.text ?? (section.lines?.join('\n') ?? ''))
    .filter(Boolean);
  if (!presentation.type.startsWith('review_') || sectionTexts.length === 0) return splitMessage(presentation.fallbackText, maxLength);
  const chunks: string[] = [];
  let current = '';
  for (const sectionText of sectionTexts) {
    const blocks = splitMessage(sectionText, maxLength);
    for (const block of blocks) {
      if (!current) {
        current = block;
      } else if (current.length + 2 + block.length <= maxLength) {
        current += `\n\n${block}`;
      } else {
        chunks.push(current);
        current = block;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : splitMessage(presentation.fallbackText, maxLength);
}

export class TextPlatformRenderer implements PlatformRenderer {
  readonly capabilities: PlatformCapabilities;

  constructor(readonly platform: PlatformId, capabilities: PlatformCapabilities = getPlatformCapabilities(platform)) {
    this.capabilities = capabilities;
  }

  render(presentation: PresentationModel, message?: NormalizedBotMessage): BotResponse {
    const chunks = presentationBlocks(presentation, this.capabilities.maxMessageLength);
    const rawKeyboard = presentation.metadata.inlineKeyboard;
    const keyboard = Array.isArray(rawKeyboard)
      ? rawKeyboard.filter((item): item is { text: string; callbackData: string } => Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).text === 'string' && typeof (item as Record<string, unknown>).callbackData === 'string'))
      : [];
    return {
      messages: chunks.map((text, index) => ({
        type: 'text' as const,
        text,
        ...(this.capabilities.supportsButtons && index === 0 && keyboard.length ? { buttons: keyboard } : {}),
      })),
      replyTo: this.capabilities.supportsReply ? message?.message.replyToMessageId ?? message?.message.id ?? null : null,
      metadata: { presentationType: presentation.type, platform: this.platform },
    };
  }
}

const renderers = new Map<PlatformId, PlatformRenderer>();

export function registerPlatformRenderer(renderer: PlatformRenderer): void {
  renderers.set(renderer.platform, renderer);
}

export function renderForPlatform(presentation: PresentationModel, message: NormalizedBotMessage): BotResponse {
  const renderer = renderers.get(message.platform) ?? new TextPlatformRenderer(message.platform);
  return renderer.render(presentation, message);
}
