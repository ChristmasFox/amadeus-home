import { z } from 'zod';

export const PLATFORM_CONTRACT_VERSION = 1 as const;

export const PlatformIdSchema = z.enum(['kook', 'telegram', 'wechat', 'whatsapp']);
export type PlatformId = z.infer<typeof PlatformIdSchema>;

export const ChatTypeSchema = z.enum(['private', 'group']);
export type ChatType = z.infer<typeof ChatTypeSchema>;

export const PlatformIdentitySchema = z.object({
  platform: PlatformIdSchema,
  platformUserId: z.string().min(1),
  internalUserId: z.string().min(1).nullable(),
  displayName: z.string().nullable(),
});
export type PlatformIdentity = z.infer<typeof PlatformIdentitySchema>;

export const NormalizedChatSchema = z.object({
  type: ChatTypeSchema,
  id: z.string().min(1),
  name: z.string().nullable(),
});
export type NormalizedChat = z.infer<typeof NormalizedChatSchema>;

export const NormalizedMentionSchema = z.object({
  platformUserId: z.string().min(1),
  displayName: z.string().nullable(),
});
export type NormalizedMention = z.infer<typeof NormalizedMentionSchema>;

export const NormalizedAttachmentSchema = z.object({
  type: z.string().min(1),
  url: z.string().nullable(),
  name: z.string().nullable(),
  mimeType: z.string().nullable(),
});
export type NormalizedAttachment = z.infer<typeof NormalizedAttachmentSchema>;

export const NormalizedBotMessageSchema = z.object({
  version: z.literal(PLATFORM_CONTRACT_VERSION),
  platform: PlatformIdSchema,
  botId: z.string().min(1),
  user: PlatformIdentitySchema,
  chat: NormalizedChatSchema,
  message: z.object({
    id: z.string().min(1),
    text: z.string(),
    replyToMessageId: z.string().nullable(),
  }),
  mentions: z.array(NormalizedMentionSchema),
  attachments: z.array(NormalizedAttachmentSchema),
  timestamp: z.string().min(1),
  callback: z.object({
    id: z.string().min(1).nullable(),
    data: z.string().min(1),
  }).optional(),
  raw: z.unknown().optional(),
});
export type NormalizedBotMessage = z.infer<typeof NormalizedBotMessageSchema>;

export const PlatformCapabilitiesSchema = z.object({
  supportsMarkdown: z.boolean(),
  supportsCodeBlock: z.boolean(),
  supportsReply: z.boolean(),
  supportsImages: z.boolean(),
  supportsFiles: z.boolean(),
  supportsStreaming: z.boolean(),
  supportsButtons: z.boolean(),
  maxMessageLength: z.number().int().positive(),
});
export type PlatformCapabilities = z.infer<typeof PlatformCapabilitiesSchema>;

export const PresentationSectionSchema = z.object({
  type: z.string().min(1),
  title: z.string().optional(),
  text: z.string().optional(),
  lines: z.array(z.string()).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type PresentationSection = z.infer<typeof PresentationSectionSchema>;

export const PresentationModelSchema = z.object({
  version: z.literal(1),
  type: z.string().min(1),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  sections: z.array(PresentationSectionSchema),
  fallbackText: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type PresentationModel = z.infer<typeof PresentationModelSchema>;

export const BotResponseMessageSchema = z.object({
  type: z.enum(['text', 'image', 'file']),
  text: z.string().optional(),
  url: z.string().optional(),
  name: z.string().optional(),
  buttons: z.array(z.object({
    text: z.string().min(1),
    callbackData: z.string().min(1),
  })).optional(),
});
export type BotResponseMessage = z.infer<typeof BotResponseMessageSchema>;

export const BotResponseSchema = z.object({
  messages: z.array(BotResponseMessageSchema),
  replyTo: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type BotResponse = z.infer<typeof BotResponseSchema>;

export interface PlatformAdapter<TRawEvent = unknown> {
  readonly platform: PlatformId;
  normalize(event: TRawEvent): NormalizedBotMessage;
}

export interface PlatformRenderer {
  readonly platform: PlatformId;
  readonly capabilities: PlatformCapabilities;
  render(presentation: PresentationModel, message?: NormalizedBotMessage): BotResponse;
}

export interface PlatformSender<TTarget = unknown> {
  send(target: TTarget, response: BotResponse): Promise<void>;
}

const PLATFORM_ALIASES: Record<string, PlatformId> = {
  kook: 'kook',
  'kook-bot': 'kook',
  KOOK: 'kook',
  telegram: 'telegram',
  'telegram-bot': 'telegram',
  tg: 'telegram',
  wechat: 'wechat',
  wx: 'wechat',
  whatsapp: 'whatsapp',
  'whatsapp-cloud': 'whatsapp',
  'whatsapp-business': 'whatsapp',
  wa: 'whatsapp',
};

export function normalizePlatform(value: unknown): PlatformId {
  const normalized = String(value ?? '').trim();
  const platform = PLATFORM_ALIASES[normalized] ?? PLATFORM_ALIASES[normalized.toLowerCase()];
  if (!platform) throw new Error(`unsupported platform: ${normalized || 'empty'}`);
  return platform;
}

export function normalizeChatType(value: unknown): ChatType {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['private', 'person', 'direct', 'dm', 'user'].includes(normalized)) return 'private';
  return 'group';
}
