import { z } from 'zod';

export const dispatchStatusSchema = z.enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED']);
export type DispatchStatus = z.infer<typeof dispatchStatusSchema>;

export const dispatchDTOSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  offerId: z.string(),
  channelId: z.string(),
  status: dispatchStatusSchema,
  scheduledFor: z.union([z.string(), z.date()]),
  sentAt: z.union([z.string(), z.date()]).nullable().optional(),
  externalMsgId: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  clickCount: z.number().int(),
  createdAt: z.union([z.string(), z.date()]),
  offer: z
    .object({
      title: z.string(),
      imageUrl: z.string().nullable().optional(),
    })
    .optional(),
  channel: z
    .object({
      name: z.string(),
    })
    .optional(),
});
export type DispatchDTO = z.infer<typeof dispatchDTOSchema>;
