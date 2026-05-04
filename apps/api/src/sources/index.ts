import type { SourceKind } from '@prisma/client';
import { env } from '@/config/env.js';
import { shopeeSource } from './shopee.js';
import { amazonSource } from './amazon.js';
import { mercadoLivreSource } from './mercadolivre.js';
import { mercadoLivreApifySource } from './mercadolivre-apify.js';
import { promobitSource } from './promobit.js';
import type { SourceAdapter } from './types.js';

const mercadoLivreAdapter: SourceAdapter =
  env.MERCADOLIVRE_SCRAPER === 'apify' ? mercadoLivreApifySource : mercadoLivreSource;

export const sourceRegistry: Record<SourceKind, SourceAdapter | null> = {
  SHOPEE: shopeeSource,
  AMAZON: amazonSource,
  MERCADOLIVRE: mercadoLivreAdapter,
  PROMOBIT: promobitSource,
};
