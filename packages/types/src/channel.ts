import { z } from 'zod';

export const channelKindSchema = z.enum(['WHATSAPP_GROUP', 'TELEGRAM_CHANNEL']);
export type ChannelKind = z.infer<typeof channelKindSchema>;

export const channelSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: channelKindSchema,
  evolutionInstance: z.string().nullable().optional(),
  whatsappGroupId: z.string().nullable().optional(),
  telegramBotToken: z.string().nullable().optional(),
  telegramChatId: z.string().nullable().optional(),
  enabled: z.boolean(),
  dailySent: z.number().int(),
});
export type ChannelDTO = z.infer<typeof channelSchema>;

export const createChannelBodySchema = z.object({
  name: z.string(),
  kind: channelKindSchema,
  evolutionInstance: z.string().optional(),
  whatsappGroupId: z.string().optional(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
});
export type CreateChannelBody = z.infer<typeof createChannelBodySchema>;
