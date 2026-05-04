import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { env } from '@/config/env.js';
import { prisma } from '@/lib/db.js';
import { logger } from '@/lib/logger.js';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const SYSTEM = `Você é um copywriter de afiliado brasileiro. Recebe um produto e devolve uma "hook line": chamada curta (3-6 palavras, ≤60 chars) para abrir um anúncio em grupo de WhatsApp. Regras: TODA EM CAIXA ALTA, 1 emoji no começo OU no fim (nunca os dois), sem ponto final, sem o nome do produto. Foque em benefício/desejo (ex.: "LINDO E ACONCHEGANTE PARA A FAMÍLIA😍", "PREÇO QUE NÃO VAI SE REPETIR🔥", "OPORTUNIDADE IMPERDÍVEL⚡"). Marque urgency=high se desconto≥40%, med se 20-39%, low caso contrário. Devolva APENAS um JSON válido: {"caption": "...", "hashtags": ["..."], "urgency": "low|med|high"}.`;

type Input = {
  title: string;
  price: number;
  originalPrice?: number;
  discountPct?: number;
  category?: string;
};

type Output = { caption: string; hashtags: string[]; urgency: 'low' | 'med' | 'high' };

function hashInput(input: Input): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}

export async function describeOffer(offerId: string, input: Input, channelKind: 'WHATSAPP_GROUP' | 'TELEGRAM_CHANNEL'): Promise<Output> {
  const promptHash = hashInput(input);
  const cached = await prisma.variant.findFirst({
    where: { offerId, channelKind, promptHash },
    orderBy: { createdAt: 'desc' },
  });
  if (cached) {
    return { caption: cached.caption, hashtags: cached.hashtags, urgency: (cached.urgency as Output['urgency']) ?? 'low' };
  }

  const userMsg = JSON.stringify(input);
  const resp = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 300,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let parsed: Output;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? text);
  } catch (err) {
    logger.error({ err, text }, 'failed to parse curator response');
    parsed = { caption: 'OFERTA IMPERDÍVEL🔥', hashtags: [], urgency: 'low' };
  }

  await prisma.variant.create({
    data: {
      offerId,
      channelKind,
      caption: parsed.caption,
      hashtags: parsed.hashtags ?? [],
      urgency: parsed.urgency,
      promptHash,
    },
  });

  return parsed;
}
