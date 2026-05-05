import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { env } from '@/config/env.js';
import { prisma } from '@/lib/db.js';
import { logger } from '@/lib/logger.js';

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const SYSTEM = `Você é copywriter de promoções para grupos de WhatsApp brasileiros, no estilo "achadinhos do dia". Recebe um produto e devolve uma "hook line" curta (5-12 palavras, ≤90 chars) para abrir o anúncio.

REGRAS:
- TODA EM CAIXA ALTA (sem exceção)
- 1 emoji no fim, opcional 1 no começo (NUNCA mais que 2 no total)
- Emoji deve combinar com o produto (🚴 ciclismo, 😍 moda/casa, 🔥 oferta forte, 💪 fitness, 🍳 cozinha, 🎮 games, 🐾 pet, 👶 bebê, ✨ beleza)
- Sem ponto final
- Sem o nome do produto literalmente — fala do BENEFÍCIO ou EMOÇÃO
- Tom leve, descontraído, com toque de exagero divertido (não corporativo)

EXEMPLOS BONS (variações de estilo):
- "UM ARRASO DE CONJUNTO😍" (moda)
- "LINDO E ACONCHEGANTE PARA A FAMÍLIA😍" (casa)
- "DECORE SUA CASA COM CHARME E ACONCHEGO NATURAL😍" (decoração)
- "TÃO INVISÍVEL QUE QUANDO VEJO TENHO 1 PAR SÓ E O RESTO SUMIU😅" (humor com produto pequeno)
- "CONFORTO E LIBERDADE PARA PEDALAR SEM PARAR🚴" (esporte)
- "PREÇO QUE NÃO VAI SE REPETIR🔥" (urgência)
- "PRECISA DISSO NA SUA COZINHA AGORA🍳" (utilidade)
- "QUEM AÍ AINDA NÃO TEM?✨" (engajamento)
- "ESSE ENTROU NA NOSSA LISTA DE FAVORITOS💛" (recomendação)

EVITE:
- "OFERTA IMPERDÍVEL" genérico
- "APROVEITE AGORA" sem contexto
- Repetir nome do produto

URGÊNCIA: high se desconto≥40%, med se 20-39%, low caso contrário.

Devolva APENAS JSON válido: {"caption": "...", "hashtags": ["..."], "urgency": "low|med|high"}.`;

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
  const resp = await client.chat.completions.create({
    model: env.OPENAI_MODEL,
    max_tokens: 300,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
  });
  const text = resp.choices[0]?.message?.content ?? '';

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
