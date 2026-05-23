import { env } from '@/config/env.js';
import { prisma } from '@/lib/db.js';
import { logger } from '@/lib/logger.js';
import { evolution } from '@/lib/evolution.js';
import { applyCoupon, formatOfferMessage } from '@/dispatcher/format.js';
import { getSettingsSection } from '@/lib/settings.js';
import type { Channel, Dispatch, Offer } from '@prisma/client';

type AntibanCfg = {
  windowStartHour?: number;
  windowEndHour?: number;
  dailyLimitPerInstance?: number;
  minIntervalSec?: number;
  maxIntervalSec?: number;
  /** Tempo do efeito "digitando..." no WhatsApp antes de aparecer a mensagem.
   * Default 3-8s (humano digitando uma frase curta). Não confundir com
   * intervalo entre mensagens (esse é controlado pelo cron via intervalMinutes
   * da campanha — gap REAL entre 2 envios). */
  typingMinSec?: number;
  typingMaxSec?: number;
};

type CampaignSchedule = {
  windowStartHour?: number;
  windowEndHour?: number;
  dailyLimit?: number;
};

/**
 * Hierarchy: campaign.schedule (override) > settings.antiban > env.
 * Permite por exemplo "Grupo 24h" rodar 0-23 enquanto resto fica 8-22.
 */
async function getAntibanCfg(
  campaignSchedule?: CampaignSchedule,
): Promise<Required<AntibanCfg>> {
  const global = await getSettingsSection<AntibanCfg>('antiban').catch(
    () => ({}) as AntibanCfg,
  );
  return {
    windowStartHour:
      campaignSchedule?.windowStartHour ?? global.windowStartHour ?? env.DISPATCH_WINDOW_START,
    windowEndHour:
      campaignSchedule?.windowEndHour ?? global.windowEndHour ?? env.DISPATCH_WINDOW_END,
    dailyLimitPerInstance:
      campaignSchedule?.dailyLimit ??
      global.dailyLimitPerInstance ??
      env.DISPATCH_DAILY_LIMIT_PER_INSTANCE,
    minIntervalSec: global.minIntervalSec ?? env.DISPATCH_MIN_INTERVAL,
    maxIntervalSec: global.maxIntervalSec ?? env.DISPATCH_MAX_INTERVAL,
    typingMinSec: global.typingMinSec ?? 3,
    typingMaxSec: global.typingMaxSec ?? 8,
  };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const jitter = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1) + min) * 1000;

export type DispatchExecutionResult =
  | { kind: 'SENT'; dispatchId: string; externalMsgId?: string }
  | { kind: 'SKIPPED'; dispatchId: string; reason: string }
  | { kind: 'RESCHEDULED'; dispatchId: string; runAt: Date };

import type { Campaign } from '@prisma/client';
type LoadedDispatch = Dispatch & { offer: Offer; channel: Channel; campaign?: Campaign | null };

/**
 * Executa um dispatch para canal WhatsApp respeitando janela horária, limite
 * diário, presença de affiliateUrl e formatação via Variant da IA.
 *
 * Devolve o resultado para que o worker possa decidir se reagenda ou não.
 * Mantém efeitos colaterais (Prisma writes) atômicos por dispatch.
 */
export async function executeWhatsappDispatch(
  dispatchId: string,
  opts: { bypassWindow?: boolean; bypassDailyLimit?: boolean } = {},
): Promise<DispatchExecutionResult> {
  const dispatch = await prisma.dispatch.findUnique({
    where: { id: dispatchId },
    include: { offer: true, channel: true, campaign: true },
  });
  if (!dispatch) {
    return { kind: 'SKIPPED', dispatchId, reason: 'dispatch not found' };
  }
  if (dispatch.status !== 'PENDING') {
    return { kind: 'SKIPPED', dispatchId, reason: `status=${dispatch.status}` };
  }

  const campaignSchedule = (dispatch.campaign?.schedule as CampaignSchedule) ?? undefined;
  const antiban = await getAntibanCfg(campaignSchedule);
  if (!opts.bypassWindow) {
    const window = checkDispatchWindow(new Date(), antiban.windowStartHour, antiban.windowEndHour);
    if (!window.open) {
      logger.info(
        {
          dispatchId,
          nowHour: new Date().getHours(),
          windowStart: antiban.windowStartHour,
          windowEnd: antiban.windowEndHour,
          nextOpenAt: window.nextOpenAt,
        },
        'dispatch RESCHEDULED — fora da janela',
      );
      return { kind: 'RESCHEDULED', dispatchId, runAt: window.nextOpenAt };
    }
  }

  // Daily limit é defesa anti-ban pro cron automático. Quando o usuário clica
  // "Enviar Agora" (bypassDailyLimit:true), é intenção explícita — passa direto.
  if (!opts.bypassDailyLimit) {
    const dailyLimitHit = await applyDailyLimit(dispatch, antiban.dailyLimitPerInstance);
    if (dailyLimitHit) {
      return { kind: 'SKIPPED', dispatchId, reason: 'daily limit' };
    }
  }

  const missingAffiliate = await rejectIfMissingAffiliateUrl(dispatch);
  if (missingAffiliate) {
    return { kind: 'SKIPPED', dispatchId, reason: missingAffiliate };
  }

  const fullText = await buildMessageText(dispatch);

  return await sendAndPersist(dispatch, fullText, antiban, {
    bypassDailyLimit: opts.bypassDailyLimit,
  });
}

export function checkDispatchWindow(
  now: Date = new Date(),
  windowStart: number = env.DISPATCH_WINDOW_START,
  windowEnd: number = env.DISPATCH_WINDOW_END,
): { open: true } | { open: false; nextOpenAt: Date } {
  // BUGFIX: server roda em UTC mas windowStart/End é configurado em BRT (UTC-3).
  // Converte hora atual pra BRT antes de comparar com a janela.
  const brtHour = (now.getUTCHours() - 3 + 24) % 24;
  if (brtHour >= windowStart && brtHour < windowEnd) {
    return { open: true };
  }
  // Próxima abertura: hoje BRT às windowStart+jitter, ou amanhã se já passou
  const next = new Date(now);
  // Seta UTC pra "windowStart BRT" = (windowStart + 3) UTC
  next.setUTCHours((windowStart + 3) % 24, Math.floor(Math.random() * 30), 0, 0);
  if (next.getTime() < now.getTime()) next.setTime(next.getTime() + ONE_DAY_MS);
  return { open: false, nextOpenAt: next };
}

async function applyDailyLimit(dispatch: LoadedDispatch, dailyLimit: number): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dispatch.channel.lastResetAt < today) {
    await prisma.channel.update({
      where: { id: dispatch.channel.id },
      data: { dailySent: 0, lastResetAt: today },
    });
    dispatch.channel.dailySent = 0;
    dispatch.channel.lastResetAt = today;
  }
  if (dispatch.channel.dailySent >= dailyLimit) {
    await prisma.dispatch.update({
      where: { id: dispatch.id },
      data: { status: 'SKIPPED', errorMessage: 'daily limit' },
    });
    return true;
  }
  return false;
}

async function rejectIfMissingAffiliateUrl(dispatch: LoadedDispatch): Promise<string | null> {
  const source = await prisma.source.findUnique({ where: { id: dispatch.offer.sourceId } });
  const requiresManualLink = source?.kind === 'SHOPEE' || source?.kind === 'MERCADOLIVRE';
  if (requiresManualLink && !dispatch.offer.affiliateUrl) {
    const reason = 'missing affiliateUrl (PATCH /offers/:id)';
    await prisma.dispatch.update({
      where: { id: dispatch.id },
      data: { status: 'SKIPPED', errorMessage: reason },
    });
    return reason;
  }
  return null;
}

const SOURCE_LABELS: Record<string, string> = {
  MERCADOLIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
  SHOPEE: 'Shopee',
};

async function buildMessageText(dispatch: LoadedDispatch): Promise<string> {
  const variant = await prisma.variant.findFirst({
    where: { offerId: dispatch.offerId, channelKind: dispatch.channel.kind },
    orderBy: { createdAt: 'desc' },
  });
  const source = await prisma.source.findUnique({ where: { id: dispatch.offer.sourceId } });
  const price = Number(dispatch.offer.price);

  // Pra Amazon: reconstrói affiliateUrl com tag ATUAL do settings (em vez de
  // usar a gravada no DB). Garante que troca de tag (ex: reaprovação Amazon)
  // se aplica imediatamente em TODOS os dispatches (manual + cron) sem
  // precisar migrar o DB. Shopee/ML mantêm o affiliateUrl gravado (já tem
  // shortlink complexo que não dá pra reconstruir trivialmente).
  let trackingLink = dispatch.offer.affiliateUrl ?? dispatch.offer.url;
  if (source?.kind === 'AMAZON') {
    const mkt = await getSettingsSection<{ amazonAffiliateTag?: string }>('marketplaces');
    const currentTag = mkt.amazonAffiliateTag?.trim();
    if (currentTag) {
      trackingLink = `https://www.amazon.com.br/dp/${dispatch.offer.externalId}?tag=${encodeURIComponent(currentTag)}`;
    }
  }

  // Aplica cupom Shopee — pega o que dá MAIOR desconto e é elegível (price >= minPurchase).
  // Sistema testa todos cupons ativos e escolhe o melhor pra esse produto específico.
  let couponCode: string | null = null;
  let priceWithCoupon: number | null = null;
  let couponRedeemLink: string | null = null;
  let couponDiscountLabel: string | null = null;
  if (source?.kind === 'SHOPEE') {
    const activeCoupons = await prisma.shopeeCoupon.findMany({
      where: {
        enabled: true,
        OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
      },
    });
    // Filtra cupons officialOnly se a oferta não é de Loja Oficial Shopee Mall.
    const isOfficialMall = Boolean(
      (dispatch.offer.raw as { isOfficialMall?: boolean } | null)?.isOfficialMall,
    );
    const eligibleCoupons = activeCoupons.filter(
      (c) => !c.officialOnly || isOfficialMall,
    );
    let bestCoupon: typeof activeCoupons[number] | null = null;
    let best: { finalPrice: number; discount: number } | null = null;
    for (const c of eligibleCoupons) {
      const result = applyCoupon(price, {
        code: c.code,
        type: (c.type === 'FIXED' ? 'FIXED' : 'PERCENT') as 'PERCENT' | 'FIXED',
        value: c.value,
        minPurchase: c.minPurchase,
        maxDiscount: c.maxDiscount,
      });
      if (result.applies && result.discountValue > 0) {
        if (!best || result.discountValue > best.discount) {
          best = { finalPrice: result.finalPrice, discount: result.discountValue };
          bestCoupon = c;
        }
      }
    }
    if (best && bestCoupon) {
      priceWithCoupon = best.finalPrice;
      if (bestCoupon.code) {
        // Cupom DIGITÁVEL — mantém comportamento antigo
        couponCode = bestCoupon.code;
      } else {
        // Cupom AUTOMÁTICO — mostra link de resgate em vez de "use o cupom XYZ"
        // Usa o shortlink master da settings (gerado 1x via /sources/SHOPEE/coupon-page-shortlink)
        const shopeeSettings = await getSettingsSection<{
          shopeeCouponRedeemShortlink?: string;
        }>('marketplaces');
        const masterLink = shopeeSettings.shopeeCouponRedeemShortlink?.trim();
        if (masterLink) {
          couponRedeemLink = masterLink;
          couponDiscountLabel =
            bestCoupon.type === 'PERCENT'
              ? `${bestCoupon.value}% OFF`
              : `R$${Math.round(bestCoupon.value)} OFF`;
        }
      }
    }
  } else if (source?.kind === 'AMAZON') {
    // Cupom Amazon — setting global de cupom default (ex: MUNDIAL 10% min R$200 max R$50)
    // Aplicado automaticamente quando o produto atinge minPurchase.
    const mktAmz = await getSettingsSection<{
      amazonCouponCode?: string;
      amazonCouponType?: 'PERCENT' | 'FIXED';
      amazonCouponValue?: number;
      amazonCouponMinPurchase?: number;
      amazonCouponMaxDiscount?: number;
    }>('marketplaces');
    if (mktAmz.amazonCouponCode?.trim() && mktAmz.amazonCouponValue) {
      const r = applyCoupon(price, {
        code: mktAmz.amazonCouponCode,
        type: (mktAmz.amazonCouponType ?? 'PERCENT') as 'PERCENT' | 'FIXED',
        value: Number(mktAmz.amazonCouponValue),
        minPurchase: mktAmz.amazonCouponMinPurchase
          ? Number(mktAmz.amazonCouponMinPurchase)
          : null,
        maxDiscount: mktAmz.amazonCouponMaxDiscount
          ? Number(mktAmz.amazonCouponMaxDiscount)
          : null,
      });
      if (r.applies && r.discountValue > 0) {
        couponCode = mktAmz.amazonCouponCode.trim().toUpperCase();
        priceWithCoupon = r.finalPrice;
      }
    }
  } else if (dispatch.offer.coupon) {
    // ML / outros: cupom já vem como texto no offer.coupon (ex: alias ML)
    couponCode = dispatch.offer.coupon;
  }

  // PIX — se admin configurou desconto > 0 no /settings pra essa source,
  // calcula e mostra "OU R$ X no PIX". Default 0 = desligado (Open API
  // Shopee não expõe campo PIX, então é só estimativa).
  const mkt = (await getSettingsSection<{
    shopeePixDiscountPct?: number;
    mercadoLivrePixDiscountPct?: number;
    amazonPixDiscountPct?: number;
  }>('marketplaces')) ?? {};
  const pixPctByKind: Record<string, number> = {
    SHOPEE: Number(mkt.shopeePixDiscountPct) || 0,
    MERCADOLIVRE: Number(mkt.mercadoLivrePixDiscountPct) || 0,
    AMAZON: Number(mkt.amazonPixDiscountPct) || 0,
  };
  const pixPct = source?.kind ? pixPctByKind[source.kind] ?? 0 : 0;
  let pricePix: number | null = null;
  if (pixPct > 0) {
    const base = priceWithCoupon ?? price;
    pricePix = Math.round(base * (1 - pixPct / 100) * 100) / 100;
  }

  const instagramHandle = process.env.INSTAGRAM_HANDLE || 'promodahelena.oficial';
  // Banner + footer POR PLATAFORMA — Shopee tem ESQUENTA 6.6, Amazon pode ter
  // "CUPOM NOVO MUNDIAL", ML outro. Fallback no messageBanner legacy (global)
  // pra retrocompatibilidade.
  const mktExt = mkt as {
    messageBanner?: string;
    messageBannerShopee?: string;
    messageBannerAmazon?: string;
    messageBannerMercadolivre?: string;
    messageFooterShopee?: string;
    messageFooterAmazon?: string;
    messageFooterMercadolivre?: string;
  };
  const bannerByKind: Record<string, string | undefined> = {
    SHOPEE: mktExt.messageBannerShopee,
    AMAZON: mktExt.messageBannerAmazon,
    MERCADOLIVRE: mktExt.messageBannerMercadolivre,
  };
  const footerByKind: Record<string, string | undefined> = {
    SHOPEE: mktExt.messageFooterShopee,
    AMAZON: mktExt.messageFooterAmazon,
    MERCADOLIVRE: mktExt.messageFooterMercadolivre,
  };
  const banner =
    (source?.kind ? bannerByKind[source.kind]?.trim() : '') || mktExt.messageBanner?.trim();
  const footer = source?.kind ? footerByKind[source.kind]?.trim() : '';

  // Variety: cache antigo tem "OFERTA IMPERDÍVEL🔥" engessado (fallback quando
  // OpenAI 429ou). Substitui em runtime por pick aleatório de pool variado pra
  // dar variedade nas mensagens sem precisar regerar DB.
  let resolvedCaption = variant?.caption ?? null;
  if (resolvedCaption === 'OFERTA IMPERDÍVEL🔥') {
    const { pickRandomFallbackCaption } = await import('@/curator/describe.js');
    resolvedCaption = pickRandomFallbackCaption({
      discountPct: dispatch.offer.discountPct ? Number(dispatch.offer.discountPct) : null,
    });
  }
  // Link de resgate dos cupons DIGITÁVEIS (com code). Só Shopee tem essa página.
  const codeRedeemLink = (mkt as { shopeeCouponCodeRedeemShortlink?: string })
    .shopeeCouponCodeRedeemShortlink?.trim();

  // Texto da linha do cupom — varia por plataforma pra não misturar marcas.
  // Shopee: "onde tem cupom Shopee" (campo cupom no checkout Shopee)
  // Amazon: lê amazonCouponInstructionText do settings (ex: "| Para 10% OFF!")
  let couponInstructionText: string | null = null;
  if (couponCode) {
    if (source?.kind === 'SHOPEE') {
      couponInstructionText = 'onde tem cupom Shopee';
    } else if (source?.kind === 'AMAZON') {
      const amzInstr = (mkt as { amazonCouponInstructionText?: string })
        .amazonCouponInstructionText?.trim();
      couponInstructionText = amzInstr || 'no checkout';
    }
  }

  return formatOfferMessage({
    title: dispatch.offer.title,
    price,
    originalPrice: dispatch.offer.originalPrice ? Number(dispatch.offer.originalPrice) : null,
    installments: dispatch.offer.installments,
    unitPrice: dispatch.offer.unitPrice,
    couponCode,
    couponRedeemLink,
    couponCodeRedeemLink: couponCode && source?.kind === 'SHOPEE' ? codeRedeemLink : null,
    couponInstructionText,
    couponDiscountLabel,
    priceWithCoupon,
    pricePix,
    // Banner multi-linha (preserva formatação) sobrepõe o hook AI. Se vazio,
    // hook AI ainda aparece (variant.caption uppercased).
    bannerBlock: banner || null,
    hookLine: banner ? null : resolvedCaption,
    footerLine: footer,
    link: trackingLink,
    instagramHandle,
  });
}

async function sendAndPersist(
  dispatch: LoadedDispatch,
  fullText: string,
  antiban: { typingMinSec: number; typingMaxSec: number },
  opts: { bypassDailyLimit?: boolean } = {},
): Promise<DispatchExecutionResult> {
  if (!dispatch.channel.whatsappGroupId) {
    await prisma.dispatch.update({
      where: { id: dispatch.id },
      data: { status: 'FAILED', errorMessage: 'channel missing whatsappGroupId' },
    });
    throw new Error('channel missing whatsappGroupId');
  }
  try {
    const result = dispatch.offer.imageUrl
      ? await evolution.sendMedia({
          instance: dispatch.channel.evolutionInstance ?? undefined,
          to: dispatch.channel.whatsappGroupId,
          mediaUrl: dispatch.offer.imageUrl,
          mediaType: 'image',
          caption: fullText,
          delayMs: jitter(antiban.typingMinSec, antiban.typingMaxSec),
        })
      : await evolution.sendText({
          instance: dispatch.channel.evolutionInstance ?? undefined,
          to: dispatch.channel.whatsappGroupId,
          text: fullText,
          delayMs: jitter(antiban.typingMinSec, antiban.typingMaxSec),
        });
    const externalMsgId = (result as { key?: { id?: string } } | undefined)?.key?.id;
    await prisma.dispatch.update({
      where: { id: dispatch.id },
      data: { status: 'SENT', sentAt: new Date(), externalMsgId },
    });
    // Dispatch manual (bypassDailyLimit:true) NÃO conta no cap diário —
    // intenção do usuário não deve estourar a defesa anti-ban automática.
    if (!opts.bypassDailyLimit) {
      await prisma.channel.update({
        where: { id: dispatch.channel.id },
        data: { dailySent: { increment: 1 } },
      });
    }
    return { kind: 'SENT', dispatchId: dispatch.id, externalMsgId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, dispatchId: dispatch.id }, 'dispatch failed');
    await prisma.dispatch.update({
      where: { id: dispatch.id },
      data: { status: 'FAILED', errorMessage },
    });
    throw err;
  }
}
