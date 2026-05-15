import { prisma } from '@/lib/db.js';
import { logger } from '@/lib/logger.js';
import type { SourceKind } from '@prisma/client';

export type DedupResult = {
  sourceKind: SourceKind;
  totalSource: number;
  candidates: number;
  deleted: number;
  aborted: boolean;
  reason?: string;
  fuzzySamples: string[];
};

/**
 * Dedup global por source — image match + fuzzy title (Jaccard ≥ 0.75).
 * Cap de segurança configurável (default 15% da source).
 *
 * Lógica idêntica ao auto-dedup pós-fetch em workers.ts, extraída pra ser
 * disparada sob demanda via endpoint admin.
 */
export async function runOfferDedupe(
  sourceKind: SourceKind,
  opts: { maxDeleteRatio?: number; dryRun?: boolean } = {},
): Promise<DedupResult> {
  const maxRatio = opts.maxDeleteRatio ?? 0.15;
  const source = await prisma.source.findUnique({ where: { kind: sourceKind } });
  if (!source) {
    return { sourceKind, totalSource: 0, candidates: 0, deleted: 0, aborted: true, reason: 'source not found', fuzzySamples: [] };
  }

  const offers = await prisma.offer.findMany({
    where: { sourceId: source.id },
    select: { id: true, imageUrl: true, price: true, fetchedAt: true, title: true },
  });
  const totalSource = offers.length;

  // PASSO 1: dedup por imageUrl
  const imgGroups = new Map<string, typeof offers>();
  for (const o of offers) {
    const img = o.imageUrl || '';
    if (img.length < 20) continue;
    if (!imgGroups.has(img)) imgGroups.set(img, []);
    imgGroups.get(img)!.push(o);
  }
  const toDelete = new Set<string>();
  const pickCheapestFirst = (arr: typeof offers) =>
    [...arr].sort((a, b) => {
      const pa = Number(a.price ?? 999999);
      const pb = Number(b.price ?? 999999);
      if (pa !== pb) return pa - pb;
      return new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime();
    });
  for (const [, arr] of imgGroups) {
    if (arr.length < 2) continue;
    const sorted = pickCheapestFirst(arr);
    for (const o of sorted.slice(1)) toDelete.add(o.id);
  }

  // PASSO 2: fuzzy dedup por título
  const STOPWORDS = new Set([
    'de','do','da','dos','das','para','com','sem','em','no','na','nos','nas',
    'um','uma','uns','umas','por','pra','que','seu','sua','seus','suas',
    'bebe','bebê','infantil','kids','baby','crianca','criança','menino','menina',
    'unissex','novo','nova','original','oficial','luxo','premium','melhor',
    'ate','tam','tamanho','und','unid','unidade','unidades','pcs','peca','pecas',
  ]);
  const norm = (s: string) =>
    s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  const getTokens = (title: string): Set<string> =>
    new Set(norm(title).split(' ').filter((t) => t.length >= 2 && !STOPWORDS.has(t)));

  const candidates = offers
    .filter((o) => !toDelete.has(o.id) && o.title)
    .map((o) => ({ ...o, tokens: getTokens(o.title) }))
    .filter((o) => o.tokens.size >= 5);

  const buckets = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const sorted = [...c.tokens].sort();
    for (const key of sorted.slice(0, 2)) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(c);
    }
  }

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const seenPairs = new Set<string>();
  for (const [, bucket] of buckets) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i], b = bucket[j];
        const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        let inter = 0;
        for (const t of a.tokens) if (b.tokens.has(t)) inter++;
        const uni = a.tokens.size + b.tokens.size - inter;
        const jaccard = uni === 0 ? 0 : inter / uni;
        if (jaccard >= 0.75) union(a.id, b.id);
      }
    }
  }

  const fuzzyGroups = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const root = find(c.id);
    if (!fuzzyGroups.has(root)) fuzzyGroups.set(root, []);
    fuzzyGroups.get(root)!.push(c);
  }
  const fuzzySamples: string[] = [];
  for (const [, arr] of fuzzyGroups) {
    if (arr.length < 2) continue;
    const sorted = pickCheapestFirst(arr);
    if (fuzzySamples.length < 3) {
      fuzzySamples.push(sorted.map((o) => `R$${o.price}: ${o.title?.slice(0, 50)}`).join(' | '));
    }
    for (const o of sorted.slice(1)) toDelete.add(o.id);
  }

  const toDeleteArr = [...toDelete];
  const maxDelete = Math.floor(totalSource * maxRatio);

  if (toDeleteArr.length > maxDelete) {
    logger.warn(
      { source: sourceKind, wouldDelete: toDeleteArr.length, maxDelete, totalSource, fuzzySamples },
      'manual dedupe ABORTED — would delete > maxDeleteRatio',
    );
    return {
      sourceKind, totalSource, candidates: toDeleteArr.length, deleted: 0, aborted: true,
      reason: `would delete ${toDeleteArr.length} > cap ${maxDelete} (${(maxRatio * 100).toFixed(0)}%)`,
      fuzzySamples,
    };
  }

  if (opts.dryRun) {
    return { sourceKind, totalSource, candidates: toDeleteArr.length, deleted: 0, aborted: false, fuzzySamples };
  }

  if (toDeleteArr.length === 0) {
    return { sourceKind, totalSource, candidates: 0, deleted: 0, aborted: false, fuzzySamples: [] };
  }

  await prisma.dispatch.deleteMany({ where: { offerId: { in: toDeleteArr } } });
  const result = await prisma.offer.deleteMany({ where: { id: { in: toDeleteArr } } });
  logger.info(
    { source: sourceKind, deleted: result.count, totalSource, fuzzySamples },
    'manual dedupe done',
  );
  return { sourceKind, totalSource, candidates: toDeleteArr.length, deleted: result.count, aborted: false, fuzzySamples };
}
