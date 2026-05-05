import type { SourceKind } from '@prisma/client';
import { logger } from '@/lib/logger.js';
import { getSettingsSection } from '@/lib/settings.js';
import { shopeeSource } from './shopee.js';
import { mercadoLivreSource } from './mercadolivre.js';
import { promobitSource } from './promobit.js';
import { amazonPaapiSource } from './amazon_paapi.js';
import type { SourceAdapter } from './types.js';

// ML: usa só API pública como fallback. O caminho principal é o cookie
// panel (mercadolivre_panel.ts) chamado direto pelo search-by-category.
// Apify-ML foi removido (dead code — nunca foi usado em prod).
const mercadoLivreAdapter: SourceAdapter = mercadoLivreSource;

/**
 * Amazon: provider switch via settings.marketplaces.amazonProvider
 *   - 'paapi'    → adapter PA-API oficial (precisa credentials válidas)
 *   - 'disabled' (default) → null, cron pula silenciosamente
 *
 * Apify-Amazon foi removido — decisão é usar só PA-API quando liberar (10
 * vendas qualificadas em 180 dias). Pra Shopee, adapter Open API único.
 */
async function pickAmazonAdapter(): Promise<SourceAdapter | null> {
  try {
    const cfg = await getSettingsSection<{ amazonProvider?: string }>('marketplaces');
    switch (cfg.amazonProvider) {
      case 'paapi':
        return amazonPaapiSource;
      case 'disabled':
      default:
        return null;
    }
  } catch (err) {
    logger.error({ err }, 'pickAmazonAdapter: failed to read settings — defaulting to disabled');
    return null;
  }
}

/**
 * Factory async — substitui o `sourceRegistry` estático antigo. Permite
 * trocar de provider via settings sem reiniciar o backend (cron lê a setting
 * a cada tick via cache de 5s).
 */
export async function getAdapter(kind: SourceKind): Promise<SourceAdapter | null> {
  switch (kind) {
    case 'AMAZON':
      return pickAmazonAdapter();
    case 'SHOPEE':
      return shopeeSource;
    case 'MERCADOLIVRE':
      return mercadoLivreAdapter;
    case 'PROMOBIT':
      return promobitSource;
    default:
      return null;
  }
}
