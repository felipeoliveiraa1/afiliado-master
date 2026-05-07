/**
 * Formatação de mensagem de oferta no padrão dos grupos brasileiros
 * (referência: @achadinhoo_do_bebe / DivulgaLinks):
 *
 *   {HOOK EM CAPS} 😍
 *
 *   🛍️ {title}
 *
 *   De: R$ {originalPrice} ❌
 *   💸 Por: R$ {priceWithCoupon} com cupom
 *
 *   🎟️ Use o cupom {couponCode} onde tem cupom Shopee
 *
 *   🔗 Link para comprar:
 *
 *   {link}
 *
 *   Siga nosso perfil:
 *   @{instagramHandle}
 *
 * Linhas opcionais omitidas quando dados ausentes.
 */

const CURRENCY_LOCALE = 'pt-BR';
const CURRENCY_OPTIONS: Intl.NumberFormatOptions = {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

export type CouponConfig = {
  code: string | null;
  type: 'PERCENT' | 'FIXED';
  value: number;
  minPurchase?: number | null;
  maxDiscount?: number | null;
};

export type CouponApplied = {
  applies: boolean;
  discountValue: number;
  finalPrice: number;
};

/**
 * Aplica cupom num preço (lógica do DivulgaLinks):
 * - PERCENT: multiplica % e limita ao maxDiscount (se setado)
 * - FIXED: subtrai valor direto
 * - Verifica minPurchase: se preço < mínimo, retorna applies=false
 */
export function applyCoupon(price: number, coupon: CouponConfig): CouponApplied {
  if (coupon.minPurchase != null && price < coupon.minPurchase) {
    return { applies: false, discountValue: 0, finalPrice: price };
  }
  let discount: number;
  if (coupon.type === 'PERCENT') {
    discount = price * (coupon.value / 100);
    if (coupon.maxDiscount != null) {
      discount = Math.min(discount, coupon.maxDiscount);
    }
  } else {
    discount = coupon.value;
  }
  // Não permite desconto maior que o preço
  discount = Math.min(discount, price);
  return {
    applies: true,
    discountValue: Math.round(discount * 100) / 100,
    finalPrice: Math.max(0, Math.round((price - discount) * 100) / 100),
  };
}

export type FormatOfferInput = {
  readonly title: string;
  readonly price: number;
  readonly originalPrice?: number | null;
  /** Preço final com cupom aplicado (já calculado). Se null/igual, mostra só price. */
  readonly priceWithCoupon?: number | null;
  /** Code do cupom (digitável). null se cupom é automático ou ausente. */
  readonly couponCode?: string | null;
  /** Shortlink do cupom (cupons AUTOMÁTICOS — cliente resgata antes do checkout, sem digitar). */
  readonly couponRedeemLink?: string | null;
  /** Label do desconto pro post (ex: "R$90 OFF" ou "15% OFF"). Só exibido junto com redeemLink. */
  readonly couponDiscountLabel?: string | null;
  /** Preço PIX calculado (preço atual × (1 - pixDiscountPct/100)). Renderiza "OU R$ X no PIX". */
  readonly pricePix?: number | null;
  readonly installments?: number | null;
  readonly hookLine?: string | null;
  readonly link: string;
  readonly instagramHandle?: string | null;
};

export function formatOfferMessage(input: FormatOfferInput): string {
  const sections: string[] = [];

  // 1. Hook (caps lock)
  if (input.hookLine?.trim()) {
    sections.push(input.hookLine.trim().replace(/[\r\n]+/g, ' ').slice(0, 120).toUpperCase());
  }

  // 2. Título
  sections.push(`🛍️ ${input.title.trim()}`);

  // 3. Bloco de preços (com riscado quando há original ou cupom)
  const priceLines: string[] = [];
  const showOriginal =
    typeof input.originalPrice === 'number' && input.originalPrice > input.price;
  const hasCouponPrice =
    typeof input.priceWithCoupon === 'number' && input.priceWithCoupon < input.price;
  if (showOriginal) {
    priceLines.push(`De: ${formatBRL(input.originalPrice as number)} ❌`);
  } else if (hasCouponPrice) {
    // Sem original mas tem cupom → mostra preço normal como riscado
    priceLines.push(`De: ${formatBRL(input.price)} ❌`);
  }
  if (hasCouponPrice) {
    priceLines.push(`💸 Por: ${formatBRL(input.priceWithCoupon as number)} com cupom`);
  } else {
    priceLines.push(`💸 Por: ${formatBRL(input.price)}`);
  }
  // Linha PIX — só renderiza se for menor que o preço final (com cupom ou normal)
  // Ex: "OU R$ 179,55 no PIX" abaixo da linha "Por: R$ 189,00"
  const finalPrice = hasCouponPrice ? (input.priceWithCoupon as number) : input.price;
  if (typeof input.pricePix === 'number' && input.pricePix > 0 && input.pricePix < finalPrice) {
    priceLines.push(`💚 OU ${formatBRL(input.pricePix)} no PIX`);
  }
  const installmentLine = buildInstallmentLine(
    hasCouponPrice ? (input.priceWithCoupon as number) : input.price,
    input.installments,
  );
  if (installmentLine) priceLines.push(installmentLine);
  sections.push(priceLines.join('\n'));

  // 4. Cupom — 2 modos baseado no tipo:
  //   - Digitável (com code): "🎟️ Use o cupom XXX onde tem cupom Shopee"
  //   - Automático (sem code, com redeemLink): padrão @achadinhoo_do_bebe
  //     "🎟️ USE O CUPOM R$X OFF| 𝐫𝐞𝐬𝐠𝐚𝐭𝐞 𝐨 𝐜𝐮𝐩𝐨𝐦 𝐚𝐪𝐮𝐢 ⤵️ <shortlink>"
  if (input.couponCode?.trim()) {
    sections.push(`🎟️ Use o cupom ${input.couponCode.trim().toUpperCase()} onde tem cupom Shopee`);
  } else if (input.couponRedeemLink?.trim() && typeof input.couponDiscountLabel === 'string') {
    // Unicode bold "resgate o cupom aqui"
    const redeem = '𝐫𝐞𝐬𝐠𝐚𝐭𝐞 𝐨 𝐜𝐮𝐩𝐨𝐦 𝐚𝐪𝐮𝐢';
    sections.push(
      `🎟️ USE O CUPOM ${input.couponDiscountLabel}| ${redeem} ⤵️\n${input.couponRedeemLink.trim()}`,
    );
  }

  // 5. Link com label
  sections.push(`🔗 Link para comprar:\n\n${input.link}`);

  // 6. Footer Instagram
  if (input.instagramHandle?.trim()) {
    const handle = input.instagramHandle.trim().replace(/^@/, '');
    sections.push(`Siga nosso perfil:\n@${handle}`);
  }

  return sections.join('\n\n');
}

function buildInstallmentLine(
  price: number,
  installments: number | null | undefined,
): string | null {
  if (!installments || installments < 2) return null;
  const value = price / installments;
  return `💳 ou ${installments}x de ${formatBRL(value)} sem juros`;
}

/**
 * Template de "alerta de cupom" — post DEDICADO a cupom (não a produto).
 * Estilo: "SAIU CUPOM CORREEE 🚨".
 */
export function formatCouponAlert(input: {
  code: string;
  discountText?: string | null;
  description?: string | null;
  validUntil?: Date | null;
  shortLink?: string | null;
  instagramHandle?: string | null;
}): string {
  const sections: string[] = ['SAIU CUPOM CORREEE 🚨'];
  if (input.discountText) sections.push(`💸 ${input.discountText.toUpperCase()}`);
  if (input.description) sections.push(`🎯 ${input.description}`);
  sections.push(`🎟️ Código: ${input.code.toUpperCase()}`);
  if (input.shortLink) sections.push(`Copie e cole aqui:\n${input.shortLink}`);
  if (input.validUntil) {
    const formatted = input.validUntil.toLocaleDateString('pt-BR');
    sections.push(`⏰ Válido até ${formatted}`);
  }
  if (input.instagramHandle?.trim()) {
    const handle = input.instagramHandle.trim().replace(/^@/, '');
    sections.push(`Siga nosso perfil:\n@${handle}`);
  }
  return sections.join('\n\n');
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat(CURRENCY_LOCALE, CURRENCY_OPTIONS).format(value);
}
