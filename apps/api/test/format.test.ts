import { describe, expect, it } from 'vitest';
import { formatOfferMessage } from '@/dispatcher/format.js';

describe('formatOfferMessage', () => {
  it('renders the full template with hook, coupon, installments and discount', () => {
    const actual = formatOfferMessage({
      title: 'Sofá De Canto Canto Leona Plus Bom Pastor',
      price: 1410,
      originalPrice: 1599,
      installments: 10,
      coupon: 'CONFORTOMELI',
      hookLine: 'Lindo e aconchegante para a família😍',
      link: 'https://meli.la/1GcFMJ5',
    });

    expect(actual).toBe(
      [
        'LINDO E ACONCHEGANTE PARA A FAMÍLIA😍',
        '🛍️ Sofá De Canto Canto Leona Plus Bom Pastor',
        'de R$\u00a01.599,00\n💥 por R$\u00a01.410,00\n💳 ou 10x de R$\u00a0141,00 sem juros',
        '🎟️ Use o cupom: CONFORTOMELI',
        '📦 https://meli.la/1GcFMJ5',
        '⚠️ Promoção sujeita a alteração a qualquer momento.',
      ].join('\n\n'),
    );
  });

  it('omits coupon line when coupon is missing', () => {
    const actual = formatOfferMessage({
      title: 'Fone Bluetooth XYZ',
      price: 99.9,
      originalPrice: 199.9,
      installments: 3,
      hookLine: 'corre que voa🚀',
      link: 'https://amzn.to/abc',
    });

    expect(actual).not.toContain('🎟️');
    expect(actual).toContain('💥 por R$\u00a099,90');
    expect(actual).toContain('💳 ou 3x de R$\u00a033,30 sem juros');
  });

  it('omits installments line when installments is null or below 2', () => {
    const noInstallments = formatOfferMessage({
      title: 'Produto X',
      price: 50,
      originalPrice: 80,
      installments: null,
      link: 'https://shp.ee/x',
    });
    const single = formatOfferMessage({
      title: 'Produto X',
      price: 50,
      originalPrice: 80,
      installments: 1,
      link: 'https://shp.ee/x',
    });

    expect(noInstallments).not.toContain('💳');
    expect(single).not.toContain('💳');
  });

  it('omits "de R$" line when there is no original price or it is not greater than the current price', () => {
    const noOriginal = formatOfferMessage({
      title: 'Produto Y',
      price: 100,
      link: 'https://link',
    });
    const equalPrices = formatOfferMessage({
      title: 'Produto Y',
      price: 100,
      originalPrice: 100,
      link: 'https://link',
    });

    expect(noOriginal).not.toMatch(/^de R\$/m);
    expect(equalPrices).not.toMatch(/^de R\$/m);
  });

  it('omits hook line when not provided but keeps the rest of the template', () => {
    const actual = formatOfferMessage({
      title: 'Produto Sem Hook',
      price: 10,
      link: 'https://link',
    });

    expect(actual.startsWith('🛍️')).toBe(true);
    expect(actual).toContain('⚠️ Promoção sujeita a alteração a qualquer momento.');
  });

  it('uppercases the hook line and the coupon code', () => {
    const actual = formatOfferMessage({
      title: 'Produto Z',
      price: 10,
      hookLine: 'oferta relâmpago⚡',
      coupon: 'desconto10',
      link: 'https://link',
    });

    expect(actual).toContain('OFERTA RELÂMPAGO⚡');
    expect(actual).toContain('🎟️ Use o cupom: DESCONTO10');
  });

  it('always ends with the disclaimer', () => {
    const actual = formatOfferMessage({
      title: 'Qualquer',
      price: 1,
      link: 'https://x',
    });

    expect(actual.endsWith('⚠️ Promoção sujeita a alteração a qualquer momento.')).toBe(true);
  });
});
