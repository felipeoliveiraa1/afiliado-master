import type { SourceKind } from '@prisma/client';
import { logger } from '@/lib/logger.js';
import { getSettingsSection } from '@/lib/settings.js';
import { shopeeSource } from './shopee.js';
import { mercadoLivreSource } from './mercadolivre.js';
import { amazonPaapiSource } from './amazon_paapi.js';
import { amazonCreatorsSource } from './amazon_creators.js';
import { riachueloSource } from './riachuelo.js';
import type { SourceAdapter } from './types.js';

// ML: usa só API pública como fallback. O caminho principal é o cookie
// panel (mercadolivre_panel.ts) chamado direto pelo search-by-category.
// Apify-ML foi removido (dead code — nunca foi usado em prod).
const mercadoLivreAdapter: SourceAdapter = mercadoLivreSource;

/**
 * Amazon: provider switch via settings.marketplaces.amazonProvider
 *   - 'creators' (NOVO, jun/2026) → Creators API (OAuth 2.0, substitui PA-API
 *      que foi retirada em 15/mai/2026). Default pra contas que bateram 10
 *      vendas qualificadas/30d e geraram Client ID em Associates Central.
 *   - 'paapi'    → adapter PA-API legacy (precisa AKIA + Secret antigos)
 *   - 'disabled' (default) → null, cron pula silenciosamente
 */
async function pickAmazonAdapter(): Promise<SourceAdapter | null> {
  try {
    const cfg = await getSettingsSection<{ amazonProvider?: string }>('marketplaces');
    switch (cfg.amazonProvider) {
      case 'creators':
        return amazonCreatorsSource;
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
    case 'RIACHUELO':
      return riachueloSource;
    case 'PROMOBIT':
      // Removido — não usado em prod. Source row pode existir no DB legacy
      // mas adapter retorna null = cron pula silenciosamente.
      return null;
    default:
      return null;
  }
}
