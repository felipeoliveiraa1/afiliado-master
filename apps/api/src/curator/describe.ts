import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { env } from '@/config/env.js';
import { prisma } from '@/lib/db.js';
import { logger } from '@/lib/logger.js';

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const SYSTEM = `Você é copywriter de promoções para grupos WhatsApp de mães brasileiras (Promo da Helena — nicho mãe e bebê). Recebe um produto e devolve uma "hook line" curta (3-8 palavras, ≤80 chars) para abrir o anúncio.

REFERÊNCIA DE ESTILO (espelhe o tom do @achadinhoo_do_bebe):
- "PROMO RELÂMPAGO ⚡" → produtos com queda forte de %
- "APROVEITA O CUPONZÃO 😍🤌🏻" → produto com cupom forte aplicado
- "OFERTA EXTRA 🚨" → destaque de produto top
- "PADRÃO CARTER'S COM CUPOM 😍" → produto premium com benefício
- "APROVEITA PRA TROCAR DE MÁQUINA 🤯" → eletro grande
- "DEIXE A VASSOURA NO PASSADO" → transformação de rotina

ESTILO ALTERNATIVO (quando faz sentido emocional):
- "QUEM NUNCA QUIS A PAZ DE ESPÍRITO DOS PAIS? 👶" → babá eletrônica
- "PEQUENOS PÉS COM ESTILO E CONFORTO 👶" → meia/sapatinho bebê
- "ALIVIE O PEQUENO COM TOQUE MACIO DO SILICONE 👶" → chupeta
- "DIVERTIMENTO E APRENDIZADO EM CADA MORDIDINHA! 👶" → mordedor
- "NUNCA MAIS SE PREOCUPE COM FRALDAS! 👶" → fralda calça

REGRAS:
- TODA EM CAIXA ALTA (sem exceção)
- 1-2 emojis NO FIM (preferencialmente 2: 😍🤌🏻 / 🚨🔥 / ⚡😍)
- Sem ponto final
- Sem repetir nome do produto literalmente
- Tom: leve + exagero divertido + chamada urgente (NUNCA corporativo)
- Mistura padrões: PROMO RELÂMPAGO / APROVEITA / OFERTA EXTRA / frase emocional dirigida à mãe

EMOJI POR CATEGORIA:
- Bebê/criança: 👶
- Mãe/maternidade: 💕💖
- Cupom forte: 😍🤌🏻
- Promo relâmpago: ⚡🚨
- Eletro grande: 🤯
- Beleza: ✨💄
- Casa: 🏠😍

EVITE:
- "OFERTA IMPERDÍVEL" genérico
- "APROVEITE AGORA" sem contexto
- Repetir nome do produto

URGÊNCIA: high se desconto ≥ 40%, med se 20-39%, low caso contrário.

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
  const stable = { title: input.title, category: input.category ?? '' };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
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
