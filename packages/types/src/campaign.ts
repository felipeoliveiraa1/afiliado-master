import { z } from 'zod';

export const campaignFiltersSchema = z.object({
  sources: z.array(z.string()).optional(),
  minDiscount: z.number().optional(),
  minScore: z.number().optional(),
  categories: z.array(z.string()).optional(),
  maxPrice: z.number().optional(),
});
export type CampaignFilters = z.infer<typeof campaignFiltersSchema>;

export const campaignScheduleSchema = z.object({
  intervalMinutes: z.number().int().min(5),
});
export type CampaignSchedule = z.infer<typeof campaignScheduleSchema>;

export const createCampaignBodySchema = z.object({
  name: z.string(),
  filters: campaignFiltersSchema.optional(),
  schedule: campaignScheduleSchema.optional(),
  channelIds: z.array(z.string()).min(1),
});
export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>;

export const campaignDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  filters: campaignFiltersSchema.partial(),
  schedule: campaignScheduleSchema.partial().optional(),
  createdAt: z.union([z.string(), z.date()]),
});
export type CampaignDTO = z.infer<typeof campaignDTOSchema>;
