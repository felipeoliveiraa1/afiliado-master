import { z } from 'zod';

export const sourceKindSchema = z.enum(['SHOPEE', 'AMAZON', 'MERCADOLIVRE', 'PROMOBIT']);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const cookieHealthSchema = z.object({
  valid: z.boolean(),
  affiliateName: z.string().optional(),
  tag: z.string().optional(),
  checkedAt: z.string(),
  errorMessage: z.string().optional(),
});
export type CookieHealth = z.infer<typeof cookieHealthSchema>;

export const sourceCookieStatusSchema = z.object({
  kind: sourceKindSchema,
  enabled: z.boolean().optional(),
  cookieHealth: cookieHealthSchema.nullable().optional(),
  cookieValidatedAt: z.string().nullable().optional(),
});
export type SourceCookieStatus = z.infer<typeof sourceCookieStatusSchema>;

export const fetchSourceBodySchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});
export type FetchSourceBody = z.infer<typeof fetchSourceBodySchema>;

export const searchByCategoryBodySchema = z.object({
  categoryId: z.string().min(1),
  subCategoryId: z.string().optional(),
  bestSellersOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  autoImport: z.boolean().optional(),
});
export type SearchByCategoryBody = z.infer<typeof searchByCategoryBodySchema>;

export const mlPanelProductSchema = z.object({
  externalId: z.string(),
  title: z.string(),
  imageUrl: z.string().optional(),
  price: z.number(),
  originalPrice: z.number().optional(),
  discountPct: z.number().optional(),
  url: z.string(),
  affiliateUrl: z.string().optional(),
  category: z.string().optional(),
  isBestSeller: z.boolean().optional(),
  participatesInProgram: z.boolean(),
});
export type MlPanelProduct = z.infer<typeof mlPanelProductSchema>;
