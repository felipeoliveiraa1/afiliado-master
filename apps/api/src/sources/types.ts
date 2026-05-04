import type { SourceKind } from '@prisma/client';

export type RawOffer = {
  externalId: string;
  title: string;
  description?: string;
  imageUrl?: string;
  price: number;
  originalPrice?: number;
  discountPct?: number;
  category?: string;
  url: string;
  affiliateUrl?: string;
  commissionPct?: number;
  rating?: number;
  ratingCount?: number;
  salesCount?: number;
  raw?: Record<string, unknown>;
};

export interface SourceAdapter {
  kind: SourceKind;
  fetch(opts?: { limit?: number; keyword?: string; categoryId?: string }): Promise<RawOffer[]>;
}
