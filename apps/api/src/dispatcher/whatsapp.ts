import { env } from '@/config/env.js';
import { prisma } from '@/lib/db.js';
import { logger } from '@/lib/logger.js';
import { evolution } from '@/lib/evolution.js';
import { formatOfferMessage } from '@/dispatcher/format.js';
import type { Channel, Dispatch, Offer } from '@prisma/client';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const jitter = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1) + min) * 1000;

export type DispatchExecutionResult =
  | { kind: 'SENT'; dispatchId: string; externalMsgId?: string }
  | { kind: 'SKIPPED'; dispatchId: string; reason: string }
  | { kind: 'RESCHEDULED'; dispatchId: string; runAt: Date };

type LoadedDispatch = Dispatch & { offer: Offer; channel: Channel };

/**
 * Executa um dispatch para canal WhatsApp respeitando janela horária, limite
 * diário, presença de affiliateUrl e formatação via Variant da IA.
 *
 * Devolve o resultado para que o worker possa decidir se reagenda ou não.
 * Mantém efeitos colaterais (Prisma writes) atômicos por dispatch.
 */
export async function executeWhatsappDispatch(dispatchId: string): Promise<DispatchExecutionResult> {
  const dispatch = await prisma.dispatch.findUnique({
    where: { id: dispatchId },
    include: { offer: true, channel: true },
  });
  if (!dispatch) {
    return { kind: 'SKIPPED', dispatchId, reason: 'dispatch not found' };
  }
  if (dispatch.status !== 'PENDING') {
    return { kind: 'SKIPPED', dispatchId, reason: `status=${dispatch.status}` };
  }

  const window = checkDispatchWindow();
  if (!window.open) {
    return { kind: 'RESCHEDULED', dispatchId, runAt: window.nextOpenAt };
  }

  const dailyLimitHit = await applyDailyLimit(dispatch);
  if (dailyLimitHit) {
    return { kind: 'SKIPPED', dispatchId, reason: 'daily limit' };
  }

  const missingAffiliate = await rejectIfMissingAffiliateUrl(dispatch);
  if (missingAffiliate) {
    return { kind: 'SKIPPED', dispatchId, reason: missingAffiliate };
  }

  const fullText = await buildMessageText(dispatch);

  return await sendAndPersist(dispatch, fullText);
}

export function checkDispatchWindow(
  now: Date = new Date(),
  windowStart: number = env.DISPATCH_WINDOW_START,
  windowEnd: number = env.DISPATCH_WINDOW_END,
): { open: true } | { open: false; nextOpenAt: Date } {
  const hour = now.getHours();
  if (hour >= windowStart && hour < windowEnd) {
    return { open: true };
  }
  const next = new Date(now);
  next.setHours(windowStart, Math.floor(Math.random() * 30), 0, 0);
  if (next.getTime() < now.getTime()) next.setTime(next.getTime() + ONE_DAY_MS);
  return { open: false, nextOpenAt: next };
}

async function applyDailyLimit(dispatch: LoadedDispatch): Promise<boolean> {
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
  if (dispatch.channel.dailySent >= env.DISPATCH_DAILY_LIMIT_PER_INSTANCE) {
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

async function buildMessageText(dispatch: LoadedDispatch): Promise<string> {
  const variant = await prisma.variant.findFirst({
    where: { offerId: dispatch.offerId, channelKind: dispatch.channel.kind },
    orderBy: { createdAt: 'desc' },
  });
  const trackingLink = env.CLICK_TRACKING_ENABLED
    ? `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/r/${dispatch.id}`
    : (dispatch.offer.affiliateUrl ?? dispatch.offer.url);
  return formatOfferMessage({
    title: dispatch.offer.title,
    price: Number(dispatch.offer.price),
    originalPrice: dispatch.offer.originalPrice ? Number(dispatch.offer.originalPrice) : null,
    installments: dispatch.offer.installments,
    coupon: dispatch.offer.coupon,
    hookLine: variant?.caption ?? null,
    link: trackingLink,
  });
}

async function sendAndPersist(
  dispatch: LoadedDispatch,
  fullText: string,
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
          delayMs: jitter(env.DISPATCH_MIN_INTERVAL, env.DISPATCH_MAX_INTERVAL),
        })
      : await evolution.sendText({
          instance: dispatch.channel.evolutionInstance ?? undefined,
          to: dispatch.channel.whatsappGroupId,
          text: fullText,
          delayMs: jitter(env.DISPATCH_MIN_INTERVAL, env.DISPATCH_MAX_INTERVAL),
        });
    const externalMsgId = (result as { key?: { id?: string } } | undefined)?.key?.id;
    await prisma.dispatch.update({
      where: { id: dispatch.id },
      data: { status: 'SENT', sentAt: new Date(), externalMsgId },
    });
    await prisma.channel.update({
      where: { id: dispatch.channel.id },
      data: { dailySent: { increment: 1 } },
    });
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
