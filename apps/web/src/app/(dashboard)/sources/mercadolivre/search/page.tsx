'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Filter, ImageOff, Search, Sparkles } from 'lucide-react';
import { clientFetch } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ML_CATEGORIES } from '@/lib/ml-categories';
import { formatBRL } from '@/lib/utils';
import type { MlPanelProduct } from '@afiliado-master/types';

type SearchResponse =
  | { found: number; products: MlPanelProduct[] }
  | { found: number; imported: number; offerIds: string[]; products: MlPanelProduct[] };

export default function MlSearchPage(): React.ReactElement {
  const [categoryId, setCategoryId] = useState(ML_CATEGORIES[0]?.id ?? '');
  const [subCategoryId, setSubCategoryId] = useState('');
  const [bestSellersOnly, setBestSellersOnly] = useState(false);
  const [autoImport, setAutoImport] = useState(false);

  const subcategories = useMemo(
    () => ML_CATEGORIES.find((c) => c.id === categoryId)?.children ?? [],
    [categoryId],
  );

  const searchMutation = useMutation<SearchResponse>({
    mutationFn: () =>
      clientFetch<SearchResponse>('/sources/MERCADOLIVRE/search-by-category', {
        method: 'POST',
        body: {
          categoryId,
          subCategoryId: subCategoryId || undefined,
          bestSellersOnly,
          autoImport,
          limit: 50,
        },
      }),
  });

  const products =
    searchMutation.data && 'products' in searchMutation.data ? searchMutation.data.products : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Buscar Mercado Livre por categoria"
        description="Paridade com Divulga Links: o painel filtra apenas produtos elegíveis e (opcional) os mais vendidos. Auto-import gera shortlink afiliado para cada um."
        badge={
          <Badge variant="accent" dot>
            <Sparkles className="size-3" /> via cookie do painel
          </Badge>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Filter className="size-4" /> Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setSubCategoryId('');
                }}
              >
                {ML_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Subcategoria</Label>
              <Select
                value={subCategoryId}
                onChange={(e) => setSubCategoryId(e.target.value)}
                disabled={subcategories.length === 0}
              >
                <option value="">{subcategories.length === 0 ? '— sem subcategorias —' : 'Todas'}</option>
                {subcategories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col justify-center gap-2">
              <Toggle checked={bestSellersOnly} onChange={setBestSellersOnly} label="Apenas mais vendidos" />
              <Toggle checked={autoImport} onChange={setAutoImport} label="Importar com link afiliado" />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="accent" onClick={() => searchMutation.mutate()} loading={searchMutation.isPending}>
              <Search className="size-4" /> Buscar produtos
            </Button>
            {searchMutation.error ? (
              <p className="text-sm text-destructive">{(searchMutation.error as Error).message}</p>
            ) : null}
            {searchMutation.data && 'imported' in searchMutation.data ? (
              <Badge variant="success" dot>
                <CheckCircle2 className="size-3" /> {searchMutation.data.imported} de{' '}
                {searchMutation.data.found} importados
              </Badge>
            ) : null}
          </div>
          {autoImport ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Cada produto exige uma chamada ao painel ML — pode levar 30–90s pra 50 SKUs (throttle anti-detecção).
            </p>
          ) : null}
        </CardContent>
      </Card>

      {searchMutation.isPending ? (
        <Card>
          <CardContent className="px-6 py-10">
            <SearchProgress />
          </CardContent>
        </Card>
      ) : products.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Resultados ({products.length})</CardTitle>
            <CardDescription>
              {autoImport
                ? 'Produtos importados como Offer com link de afiliado.'
                : 'Preview — marque "Importar com link afiliado" para gerar shortlinks.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {products.map((p) => (
                <div
                  key={p.externalId}
                  className="group flex items-start gap-3 rounded-lg border bg-card p-3 transition-shadow hover:shadow-pop animate-fade-in-up"
                >
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt=""
                      className="size-16 shrink-0 rounded object-cover ring-1 ring-border"
                    />
                  ) : (
                    <div className="grid size-16 shrink-0 place-items-center rounded bg-muted">
                      <ImageOff className="size-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <a
                      href={p.affiliateUrl ?? p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-start gap-1 font-medium text-sm leading-tight hover:text-accent line-clamp-2"
                    >
                      {p.title}
                      <ExternalLink className="size-3 shrink-0 mt-0.5 opacity-60" />
                    </a>
                    <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                      {formatBRL(p.price)}
                      {p.discountPct ? (
                        <span className="ml-2 font-semibold text-success-soft-foreground">
                          -{p.discountPct.toFixed(0)}%
                        </span>
                      ) : null}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {p.isBestSeller ? <Badge variant="warning">mais vendido</Badge> : null}
                      {p.affiliateUrl ? (
                        <Badge variant="success" dot>
                          afiliado
                        </Badge>
                      ) : (
                        <Badge variant="outline">sem link</Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : searchMutation.isSuccess ? (
        <Card>
          <EmptyState
            icon={Search}
            title="Nenhum produto encontrado"
            description="Tente trocar a categoria/subcategoria ou desligar “apenas mais vendidos”."
          />
        </Card>
      ) : null}
    </div>
  );
}

function SearchProgress(): React.ReactElement {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const estTotal = 75; // 30-90s típico
  const pct = Math.min(95, Math.round((seconds / estTotal) * 100));
  const phase =
    seconds < 5
      ? 'Buscando produtos no painel ML…'
      : seconds < 15
        ? 'Filtrando produtos elegíveis para afiliação…'
        : seconds < 60
          ? 'Gerando shortlinks meli.la (com throttle anti-detecção)…'
          : 'Quase lá — finalizando shortlinks…';
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent">
            <Sparkles className="size-5 animate-pulse" />
          </div>
          <div>
            <p className="text-sm font-medium">{phase}</p>
            <p className="text-xs text-muted-foreground">
              decorrido: {seconds}s · ETA ~{estTotal}s · throttle 0.8-2.4s/produto
            </p>
          </div>
        </div>
        <span className="text-xl font-semibold tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-accent transition-all duration-1000 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg border bg-card/50 p-3">
            <div className="size-16 shrink-0 rounded bg-muted animate-pulse" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-3 w-full bg-muted rounded animate-pulse" />
              <div className="h-3 w-2/3 bg-muted rounded animate-pulse" />
              <div className="h-4 w-1/3 bg-muted rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  label: string;
}): React.ReactElement {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm">
      <span
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-muted'
        }`}
      >
        <span
          className={`inline-block size-4 transform rounded-full bg-background shadow-sm transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      {label}
    </label>
  );
}
