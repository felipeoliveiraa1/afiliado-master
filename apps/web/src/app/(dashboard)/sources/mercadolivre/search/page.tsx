'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { clientFetch } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ML_CATEGORIES } from '@/lib/ml-categories';
import { formatBRL } from '@/lib/utils';
import type { MlPanelProduct } from '@afiliado-master/types';

type SearchResponse =
  | { found: number; products: MlPanelProduct[] }
  | { found: number; imported: number; offerIds: string[] };

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
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Buscar Mercado Livre por categoria</h1>
        <p className="text-muted-foreground">
          Paridade com Divulga Links: o painel filtra apenas produtos elegíveis para afiliação e (opcional) os mais
          vendidos. Os links já vêm convertidos.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
          <CardDescription>Selecione categoria principal e (opcionalmente) uma subcategoria.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Categoria</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
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
              </select>
            </div>
            <div>
              <Label>Subcategoria</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm disabled:opacity-50"
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
              </select>
            </div>
            <div className="flex flex-col gap-2 md:pt-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={bestSellersOnly}
                  onChange={(e) => setBestSellersOnly(e.target.checked)}
                />
                Apenas mais vendidos
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoImport}
                  onChange={(e) => setAutoImport(e.target.checked)}
                />
                Importar automaticamente para Ofertas
              </label>
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={() => searchMutation.mutate()} disabled={searchMutation.isPending}>
              {searchMutation.isPending ? 'Buscando...' : 'Buscar produtos'}
            </Button>
          </div>
          {searchMutation.error ? (
            <p className="mt-3 text-sm text-destructive">{(searchMutation.error as Error).message}</p>
          ) : null}
          {searchMutation.data && 'imported' in searchMutation.data ? (
            <Badge variant="success" className="mt-3">
              {searchMutation.data.imported} de {searchMutation.data.found} produtos importados
            </Badge>
          ) : null}
        </CardContent>
      </Card>

      {products.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultados ({products.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {products.map((p) => (
                <div key={p.externalId} className="flex items-center gap-3 border rounded-md p-3">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="size-16 rounded object-cover" />
                  ) : null}
                  <div className="flex-1 min-w-0">
                    <a
                      href={p.affiliateUrl ?? p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:underline line-clamp-2"
                    >
                      {p.title}
                    </a>
                    <div className="text-sm text-muted-foreground">
                      {formatBRL(p.price)}
                      {p.discountPct ? <span className="ml-2 text-emerald-600">-{p.discountPct.toFixed(0)}%</span> : null}
                    </div>
                    <div className="mt-1 flex items-center gap-1 flex-wrap">
                      {p.isBestSeller ? <Badge variant="warning">mais vendido</Badge> : null}
                      {p.affiliateUrl ? <Badge variant="success">afiliado</Badge> : <Badge variant="outline">sem link</Badge>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
