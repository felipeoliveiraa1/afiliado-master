import { z } from 'zod';
import { sourceKindSchema } from './source.js';

export const offerSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  price: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  originalPrice: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v == null ? null : Number(v))),
  discountPct: z.number().nullable().optional(),
  category: z.string().nullable().optional(),
  url: z.string(),
  affiliateUrl: z.string().nullable().optional(),
  commissionPct: z.number().nullable().optional(),
  rating: z.number().nullable().optional(),
  ratingCount: z.number().nullable().optional(),
  salesCount: z.number().nullable().optional(),
  score: z.number().nullable().optional(),
  fetchedAt: z.union([z.string(), z.date()]),
  source: z.object({ kind: sourceKindSchema }).optional(),
});
export type OfferDTO = z.infer<typeof offerSchema>;

export const updateOfferBodySchema = z.object({
  affiliateUrl: z.string().url().optional(),
  title: z.string().optional(),
  imageUrl: z.string().url().optional(),
  price: z.number().positive().optional(),
  originalPrice: z.number().positive().optional(),
});
export type UpdateOfferBody = z.infer<typeof updateOfferBodySchema>;

export const importOfferItemSchema = z.object({
  externalId: z.string(),
  title: z.string().min(3),
  url: z.string().url(),
  affiliateUrl: z.string().url(),
  imageUrl: z.string().url().optional(),
  price: z.number().positive(),
  originalPrice: z.number().positive().optional(),
  category: z.string().optional(),
  commissionPct: z.number().min(0).max(100).optional(),
});
export type ImportOfferItem = z.infer<typeof importOfferItemSchema>;

export const importOffersBodySchema = z.object({
  sourceKind: z.enum(['SHOPEE', 'AMAZON', 'MERCADOLIVRE']),
  offers: z.array(importOfferItemSchema).min(1).max(100),
});
export type ImportOffersBody = z.infer<typeof importOffersBodySchema>;
