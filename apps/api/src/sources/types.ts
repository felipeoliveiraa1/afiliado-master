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

export type FetchOpts = {
  limit?: number;
  keyword?: string;
  categoryId?: string;
  /** % desconto mínimo (filtro adapter-side quando suportado) */
  minDiscount?: number;
  /** Shopee: filtra shopType ∋ [1] = Mall */
  onlyMall?: boolean;
  /** Shopee: filtra isKeySeller=true */
  onlyKeySellers?: boolean;
};

export interface SourceAdapter {
  kind: SourceKind;
  fetch(opts?: FetchOpts): Promise<RawOffer[]>;
}

/**
 * Config persistida em Source.config (Json). Define o que o cron vai puxar
 * automaticamente — categorias, keywords, filtros de qualidade.
 *
 * Quando categoryIds + keywords vazios, adapter retorna lista trending geral
 * (comportamento legado). Cron itera cada item e agrega.
 */
export type SourceConfig = {
  /** IDs de categoria. Formato varia por marketplace:
   *  - ML: MLB1276 (cookie panel) ou MLB sem prefixo
   *  - Shopee: número Int32 (productCatId)
   *  - Amazon PA-API: BrowseNodeId (Int64)
   *  - Promobit: slug de categoria
   */
  categoryIds?: string[];
  /** Termos de busca livre */
  keywords?: string[];
  /** % desconto mínimo */
  minDiscount?: number;
  /** Quantos produtos puxar por categoria/keyword (default 10) */
  limitPerCategory?: number;
  /** Shopee only — só lojas oficiais (Shopee Mall) */
  onlyMall?: boolean;
  /** Shopee only — só "key sellers" */
  onlyKeySellers?: boolean;
};
