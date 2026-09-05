import type { PlatformCapabilities, PlatformId } from './contracts.js';

const TEXT_CAPABILITIES: PlatformCapabilities = {
  supportsMarkdown: true,
  supportsCodeBlock: true,
  supportsReply: true,
  supportsImages: true,
  supportsFiles: true,
  supportsStreaming: false,
  supportsButtons: false,
  maxMessageLength: 1800,
};

const PLATFORM_CAPABILITIES: Record<PlatformId, PlatformCapabilities> = {
  kook: { ...TEXT_CAPABILITIES, maxMessageLength: 1800 },
  telegram: { ...TEXT_CAPABILITIES, supportsButtons: true, maxMessageLength: 4096 },
  wechat: { ...TEXT_CAPABILITIES, supportsMarkdown: false, supportsCodeBlock: false, maxMessageLength: 2000 },
  // Cloud API text messages are limited to 4096 characters. Interactive
  // messages are intentionally left for a later PresentationModel extension.
  whatsapp: {
    ...TEXT_CAPABILITIES,
    supportsImages: false,
    supportsFiles: false,
    supportsMarkdown: false,
    supportsButtons: false,
    maxMessageLength: 4096,
  },
};

export function getPlatformCapabilities(platform: PlatformId): PlatformCapabilities {
  return { ...PLATFORM_CAPABILITIES[platform] };
}
