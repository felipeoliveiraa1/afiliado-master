import type { Offer } from '@prisma/client';

/**
 * Score 0..1 — peso adaptativo: usa só os componentes disponíveis.
 *
 * Quando a oferta não tem `discountPct` (ex: actor Apify barato pra Amazon),
 * o peso de desconto é redistribuído entre os outros componentes disponíveis,
 * ao invés de zerar 40% do score (o que prejudicaria injustamente).
 *
 * Componentes (peso original):
 *  - desconto%   0.40
 *  - rating      0.20
 *  - vendas (log) 0.20
 *  - comissão%   0.20
 */
export function scoreOffer(offer: Pick<Offer, 'discountPct' | 'rating' | 'ratingCount' | 'salesCount' | 'commissionPct'>): number {
  const components: { value: number; weight: number }[] = [];

  if (offer.discountPct != null) {
    components.push({ value: Math.min(1, offer.discountPct / 70), weight: 0.4 });
  }
  if (offer.rating != null) {
    components.push({ value: offer.rating / 5, weight: 0.2 });
  }
  // Vendas via salesCount OU ratingCount (proxy: muitas reviews = muitas vendas)
  const reviewsAsSales = offer.ratingCount ?? offer.salesCount;
  if (reviewsAsSales != null && reviewsAsSales > 0) {
    components.push({ value: Math.min(1, Math.log10(reviewsAsSales + 1) / 5), weight: 0.2 });
  }
  if (offer.commissionPct != null) {
    components.push({ value: Math.min(1, offer.commissionPct / 20), weight: 0.2 });
  }

  if (components.length === 0) return 0;

  // Renormaliza pesos: soma dos pesos disponíveis = 1
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const score = components.reduce((acc, c) => acc + (c.value * c.weight) / totalWeight, 0);
  return Number(score.toFixed(4));
}
