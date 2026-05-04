'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SourceBadge } from '@/components/source-badge';
import { formatBRL, formatDate, formatPct } from '@/lib/utils';

type OfferRow = {
  id: string;
  title: string;
  price: string;
  originalPrice: string | null;
  discountPct: number | null;
  url: string;
  affiliateUrl: string | null;
  imageUrl: string | null;
  score: number | null;
  coupon: string | null;
  installments: number | null;
  fetchedAt: string;
  source: { kind: 'SHOPEE' | 'AMAZON' | 'MERCADOLIVRE' | 'PROMOBIT' };
};

type OfferPatch = {
  affiliateUrl?: string;
  coupon?: string | null;
  installments?: number | null;
};

export default function OffersPage(): React.ReactElement {
  const [filters, setFilters] = useState({ source: '', minScore: '', take: '30' });
  const queryClient = useQueryClient();

  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.minScore) params.set('minScore', filters.minScore);
  if (filters.take) params.set('take', filters.take);

  const { data, isLoading, error } = useQuery<OfferRow[]>({
    queryKey: ['offers', filters],
    queryFn: () => clientFetch<OfferRow[]>(`/offers?${params.toString()}`),
  });

  const updateMutation = useMutation({
    mutationFn: (args: { id: string; patch: OfferPatch }) =>
      clientFetch(`/offers/${args.id}`, {
        method: 'PATCH',
        body: args.patch,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['offers'] }),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ofertas</h1>
          <p className="text-muted-foreground">
            Tudo que entrou nas Sources. Edite o link de afiliado quando faltar.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <Label>Source</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={filters.source}
                onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
              >
                <option value="">Todos</option>
                <option value="SHOPEE">Shopee</option>
                <option value="AMAZON">Amazon</option>
                <option value="MERCADOLIVRE">Mercado Livre</option>
                <option value="PROMOBIT">Promobit</option>
              </select>
            </div>
            <div>
              <Label>Score mínimo</Label>
              <Input
                className="mt-1"
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={filters.minScore}
                onChange={(e) => setFilters((f) => ({ ...f, minScore: e.target.value }))}
              />
            </div>
            <div>
              <Label>Limite</Label>
              <Input
                className="mt-1"
                type="number"
                min="5"
                max="100"
                value={filters.take}
                onChange={(e) => setFilters((f) => ({ ...f, take: e.target.value }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="p-6 text-sm text-destructive">{(error as Error).message}</p>
          ) : isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Carregando...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Produto</th>
                    <th className="px-4 py-3 text-left font-medium">Source</th>
                    <th className="px-4 py-3 text-right font-medium">Preço</th>
                    <th className="px-4 py-3 text-right font-medium">Desc.</th>
                    <th className="px-4 py-3 text-right font-medium">Score</th>
                    <th className="px-4 py-3 text-left font-medium">Afiliado</th>
                    <th className="px-4 py-3 text-left font-medium">Cupom / Parc.</th>
                    <th className="px-4 py-3 text-left font-medium">Captado</th>
                  </tr>
                </thead>
                <tbody>
                  {(data ?? []).map((o) => (
                    <OfferEditableRow
                      key={o.id}
                      offer={o}
                      onSave={(patch) => updateMutation.mutate({ id: o.id, patch })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OfferEditableRow({
  offer,
  onSave,
}: {
  offer: OfferRow;
  onSave: (patch: OfferPatch) => void;
}): React.ReactElement {
  const [editingLink, setEditingLink] = useState(false);
  const [editingPromo, setEditingPromo] = useState(false);
  const [linkValue, setLinkValue] = useState(offer.affiliateUrl ?? '');
  const [couponValue, setCouponValue] = useState(offer.coupon ?? '');
  const [installmentsValue, setInstallmentsValue] = useState(
    offer.installments ? String(offer.installments) : '',
  );
  const savePromo = (): void => {
    const parsedInstallments = installmentsValue.trim() ? Number(installmentsValue) : null;
    onSave({
      coupon: couponValue.trim() ? couponValue.trim().toUpperCase() : null,
      installments: parsedInstallments,
    });
    setEditingPromo(false);
  };
  return (
    <tr className="border-t">
      <td className="px-4 py-3 max-w-[320px]">
        <div className="flex items-center gap-2">
          {offer.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={offer.imageUrl} alt="" className="size-10 rounded object-cover" />
          ) : null}
          <a href={offer.url} target="_blank" rel="noreferrer" className="line-clamp-2 hover:underline">
            {offer.title}
          </a>
        </div>
      </td>
      <td className="px-4 py-3">
        <SourceBadge kind={offer.source.kind} />
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {formatBRL(Number(offer.price))}
        {offer.originalPrice ? (
          <div className="text-xs text-muted-foreground line-through">{formatBRL(Number(offer.originalPrice))}</div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {offer.discountPct ? (
          <Badge variant="success">-{formatPct(offer.discountPct)}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">{offer.score?.toFixed(2) ?? '—'}</td>
      <td className="px-4 py-3 max-w-[280px]">
        {editingLink ? (
          <div className="flex items-center gap-2">
            <Input value={linkValue} onChange={(e) => setLinkValue(e.target.value)} className="h-8" />
            <Button
              size="sm"
              onClick={() => {
                onSave({ affiliateUrl: linkValue });
                setEditingLink(false);
              }}
            >
              Salvar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingLink(false)}>
              X
            </Button>
          </div>
        ) : offer.affiliateUrl ? (
          <div className="flex items-center gap-2">
            <a
              href={offer.affiliateUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline truncate max-w-[220px]"
            >
              {offer.affiliateUrl}
            </a>
            <Button size="sm" variant="ghost" onClick={() => setEditingLink(true)}>
              Editar
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditingLink(true)}>
            Adicionar link
          </Button>
        )}
      </td>
      <td className="px-4 py-3 max-w-[220px]">
        {editingPromo ? (
          <div className="space-y-1">
            <Input
              placeholder="Cupom (ex.: CONFORTOMELI)"
              value={couponValue}
              onChange={(e) => setCouponValue(e.target.value)}
              className="h-8"
            />
            <Input
              placeholder="Parcelas (ex.: 10)"
              type="number"
              min="1"
              max="24"
              value={installmentsValue}
              onChange={(e) => setInstallmentsValue(e.target.value)}
              className="h-8"
            />
            <div className="flex gap-1">
              <Button size="sm" onClick={savePromo}>
                Salvar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingPromo(false)}>
                X
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="text-xs">
              {offer.coupon ? (
                <Badge variant="success">🎟️ {offer.coupon}</Badge>
              ) : (
                <span className="text-muted-foreground">sem cupom</span>
              )}
              <div className="text-muted-foreground">
                {offer.installments ? `${offer.installments}x sem juros` : 'sem parcelamento'}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditingPromo(true)}>
              Editar
            </Button>
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(offer.fetchedAt)}</td>
    </tr>
  );
}
