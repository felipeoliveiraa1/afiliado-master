import { z } from 'zod';
import { sourceKindSchema, cookieHealthSchema } from './source.js';
import { dispatchStatusSchema } from './dispatch.js';

export const statsTodaySchema = z.object({
  offersToday: z.array(
    z.object({
      sourceId: z.string(),
      _count: z.number(),
    }),
  ),
  dispatchAgg: z.array(
    z.object({
      status: dispatchStatusSchema,
      _count: z.number(),
    }),
  ),
  cookieHealth: z.array(
    z.object({
      kind: sourceKindSchema,
      cookieHealth: cookieHealthSchema.nullable().optional(),
      cookieValidatedAt: z.union([z.string(), z.date()]).nullable().optional(),
    }),
  ),
});
export type StatsToday = z.infer<typeof statsTodaySchema>;
