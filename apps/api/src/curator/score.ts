import type { Offer } from '@prisma/client';

/**
 * Score 0..1 para priorizar quais ofertas vão para fila de disparo.
 * Componentes:
 *  - desconto% (peso 0.40)
 *  - rating (peso 0.20)
 *  - vendas log-norm (peso 0.20)
 *  - comissão% (peso 0.20)
 */
export function scoreOffer(offer: Pick<Offer, 'discountPct' | 'rating' | 'salesCount' | 'commissionPct'>): number {
  const disc = Math.min(1, (offer.discountPct ?? 0) / 70);
  const rating = (offer.rating ?? 0) / 5;
  const sales = offer.salesCount ? Math.min(1, Math.log10(offer.salesCount + 1) / 5) : 0;
  const comm = Math.min(1, (offer.commissionPct ?? 0) / 20);
  return Number((disc * 0.4 + rating * 0.2 + sales * 0.2 + comm * 0.2).toFixed(4));
}
