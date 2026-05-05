/**
 * Formatação da mensagem de oferta no padrão usado nos grupos de WhatsApp:
 *
 *   {HOOK LINE EM CAPS COM 1 EMOJI}
 *
 *   🛍️ {title}
 *
 *   de R$ {originalPrice}
 *   💥 por R$ {price}
 *   💳 ou {installments}x de R$ {installmentValue} sem juros
 *
 *   🎟️ Use o cupom: {coupon}
 *
 *   📦 {link}
 *
 *   ⚠️ Promoção sujeita a alteração a qualquer momento.
 *
 * Linhas opcionais (originalPrice, installments, coupon) são omitidas quando
 * o dado não estiver presente — sem deixar linhas em branco sobrando.
 */

const CURRENCY_LOCALE = 'pt-BR';
const CURRENCY_OPTIONS: Intl.NumberFormatOptions = {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const DISCLAIMER = '⚠️ Promoção sujeita a alteração a qualquer momento.';

export type FormatOfferInput = {
  readonly title: string;
  readonly price: number;
  readonly originalPrice?: number | null;
  readonly installments?: number | null;
  readonly coupon?: string | null;
  readonly hookLine?: string | null;
  readonly link: string;
  /** Nome do vendedor (ex: "Decco Moda Íntima"). Quando presente, gera a linha
   * "Achado em Mercado Livre na loja oficial X" antes do link — aumenta
   * credibilidade no padrão dos grupos brasileiros. */
  readonly sellerName?: string | null;
  /** Nome da source (ex: "Mercado Livre", "Amazon"). Usado junto do sellerName. */
  readonly sourceName?: string | null;
};

export function formatOfferMessage(input: FormatOfferInput): string {
  const sections: string[] = [];
  const hook = pickHookLine(input);
  if (hook) sections.push(hook);
  sections.push(`🛍️ ${input.title.trim()}`);
  sections.push(buildPriceBlock(input));
  const couponLine = buildCouponLine(input.coupon);
  if (couponLine) sections.push(couponLine);
  const sellerLine = buildSellerLine(input.sellerName, input.sourceName);
  if (sellerLine) sections.push(sellerLine);
  sections.push(`📦 ${input.link}`);
  sections.push(DISCLAIMER);
  return sections.join('\n\n');
}

function buildSellerLine(
  sellerName: string | null | undefined,
  sourceName: string | null | undefined,
): string | null {
  const seller = sellerName?.trim();
  if (!seller) return null;
  const source = sourceName?.trim() || 'Mercado Livre';
  return `Achado em ${source} na loja oficial ${seller}`;
}

function pickHookLine(input: FormatOfferInput): string | null {
  const raw = input.hookLine?.trim();
  if (!raw) return null;
  const stripped = raw.replace(/[\r\n]+/g, ' ').slice(0, 120);
  return stripped.toUpperCase();
}

function buildPriceBlock(input: FormatOfferInput): string {
  const lines: string[] = [];
  if (isValidOriginalPrice(input.originalPrice, input.price)) {
    lines.push(`de ${formatBRL(input.originalPrice as number)}`);
  }
  lines.push(`💥 por ${formatBRL(input.price)}`);
  const installmentLine = buildInstallmentLine(input.price, input.installments);
  if (installmentLine) lines.push(installmentLine);
  return lines.join('\n');
}

function buildInstallmentLine(price: number, installments: number | null | undefined): string | null {
  if (!installments || installments < 2) return null;
  const value = price / installments;
  return `💳 ou ${installments}x de ${formatBRL(value)} sem juros`;
}

function buildCouponLine(coupon: string | null | undefined): string | null {
  const cleaned = coupon?.trim();
  if (!cleaned) return null;
  return `🎟️ Use o cupom: ${cleaned.toUpperCase()}`;
}

function isValidOriginalPrice(original: number | null | undefined, price: number): boolean {
  return typeof original === 'number' && original > price;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat(CURRENCY_LOCALE, CURRENCY_OPTIONS).format(value);
}
