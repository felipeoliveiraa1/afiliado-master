'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Filter, ImageOff, Pencil, Search, X } from 'lucide-react';
import { clientFetch } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
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
  const [filters, setFilters] = useState({ source: '', minScore: '', take: '100' });
  const [view, setView] = useState<'table' | 'grid'>('grid');
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
      <PageHeader
        title="Ofertas"
        description="Tudo que entrou nas Sources. Edite o link de afiliado quando faltar."
        actions={
          <div className="inline-flex rounded-lg border bg-muted/30 p-1">
            <button
              type="button"
              onClick={() => setView('grid')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                view === 'grid' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Grade
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                view === 'table' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Tabela
            </button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Filter className="size-4" /> Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select
                value={filters.source}
                onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
              >
                <option value="">Todas</option>
                <option value="SHOPEE">Shopee</option>
                <option value="AMAZON">Amazon</option>
                <option value="MERCADOLIVRE">Mercado Livre</option>
                <option value="PROMOBIT">Promobit</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Score mínimo</Label>
              <Input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={filters.minScore}
                onChange={(e) => setFilters((f) => ({ ...f, minScore: e.target.value }))}
                placeholder="0.0 – 1.0"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Limite</Label>
              <Input
                type="number"
                min="5"
                max="100"
                value={filters.take}
                onChange={(e) => setFilters((f) => ({ ...f, take: e.target.value }))}
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="ghost"
                onClick={() => setFilters({ source: '', minScore: '', take: '30' })}
                disabled={!filters.source && !filters.minScore && filters.take === '30'}
              >
                Limpar filtros
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="px-6 py-10 text-sm text-destructive">{(error as Error).message}</CardContent>
        </Card>
      ) : isLoading ? (
        view === 'grid' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonOfferCard key={i} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="px-6 py-6">
              <SkeletonRows count={6} />
            </CardContent>
          </Card>
        )
      ) : (data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="Nenhuma oferta encontrada"
            description="Ajuste os filtros ou rode uma captação manual em Sources."
          />
        </Card>
      ) : view === 'grid' ? (
        <>
          <div className="text-xs text-muted-foreground">
            Mostrando {(data ?? []).length} oferta{(data ?? []).length !== 1 ? 's' : ''} (ordenadas por score)
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(data ?? []).map((o) => (
              <OfferGridCard
                key={o.id}
                offer={o}
                onSave={(patch) => updateMutation.mutate({ id: o.id, patch })}
              />
            ))}
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Produto</th>
                    <th className="px-4 py-3 text-left font-medium">Source</th>
                    <th className="px-4 py-3 text-right font-medium">Preço</th>
                    <th className="px-4 py-3 text-right font-medium">Desconto</th>
                    <th className="px-4 py-3 text-right font-medium">Score</th>
                    <th className="px-4 py-3 text-left font-medium">Afiliado</th>
                    <th className="px-4 py-3 text-left font-medium">Cupom / Parc.</th>
                    <th className="px-4 py-3 text-left font-medium">Captado</th>
                  </tr>
                </thead>
                <tbody>
                  {(data ?? []).map((o, i) => (
                    <OfferEditableRow
                      key={o.id}
                      offer={o}
                      odd={i % 2 === 1}
                      onSave={(patch) => updateMutation.mutate({ id: o.id, patch })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OfferEditableRow({
  offer,
  odd,
  onSave,
}: {
  offer: OfferRow;
  odd: boolean;
  onSave: (patch: OfferPatch) => void;
}): React.ReactElement {
  const [editingLink, setEditingLink] = useState(false);
  const [editingPromo, setEditingPromo] = useState(false);
  const [linkValue, setLinkValue] = useState(offer.affiliateUrl ?? '');
  const [couponValue, setCouponValue] = useState(offer.coupon ?? '');
  const [installmentsValue, setInstallmentsValue] = useState(
    offer.installments ? String(offer.installments) : '',
  );
  const [copied, setCopied] = useState(false);

  const savePromo = (): void => {
    const parsedInstallments = installmentsValue.trim() ? Number(installmentsValue) : null;
    onSave({
      coupon: couponValue.trim() ? couponValue.trim().toUpperCase() : null,
      installments: parsedInstallments,
    });
    setEditingPromo(false);
  };

  const copyLink = (): void => {
    if (!offer.affiliateUrl) return;
    navigator.clipboard.writeText(offer.affiliateUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <tr className={`border-b last:border-b-0 row-hover ${odd ? 'bg-muted/15' : ''}`}>
      <td className="px-4 py-3 max-w-[340px]">
        <div className="flex items-center gap-3">
          {offer.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={offer.imageUrl}
              alt=""
              className="size-12 shrink-0 rounded-md object-cover ring-1 ring-border"
            />
          ) : (
            <div className="grid size-12 shrink-0 place-items-center rounded-md bg-muted ring-1 ring-border">
              <ImageOff className="size-4 text-muted-foreground" />
            </div>
          )}
          <a
            href={offer.url}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-2 font-medium text-foreground hover:text-accent transition-colors"
          >
            {offer.title}
          </a>
        </div>
      </td>
      <td className="px-4 py-3">
        <SourceBadge kind={offer.source.kind} size="sm" />
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <div className="font-semibold">{formatBRL(Number(offer.price))}</div>
        {offer.originalPrice ? (
          <div className="text-xs text-muted-foreground line-through">
            {formatBRL(Number(offer.originalPrice))}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right">
        {offer.discountPct ? (
          <Badge variant="success">-{formatPct(offer.discountPct)}</Badge>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <ScorePill value={offer.score} />
      </td>
      <td className="px-4 py-3 max-w-[280px]">
        {editingLink ? (
          <div className="flex items-center gap-1.5">
            <Input
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              className="h-8 text-xs"
              autoFocus
            />
            <Button
              size="icon-sm"
              variant="accent"
              aria-label="Salvar"
              onClick={() => {
                onSave({ affiliateUrl: linkValue });
                setEditingLink(false);
              }}
            >
              <Check className="size-3.5" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => setEditingLink(false)}>
              <X className="size-3.5" />
            </Button>
          </div>
        ) : offer.affiliateUrl ? (
          <div className="flex items-center gap-1.5">
            <a
              href={offer.affiliateUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate max-w-[180px] text-xs text-accent hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="size-3" />
              <span className="truncate">{offer.affiliateUrl.replace(/^https?:\/\//, '')}</span>
            </a>
            <Button size="icon-sm" variant="ghost" aria-label="Copiar" onClick={copyLink}>
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setEditingLink(true)}>
              <Pencil className="size-3.5" />
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
          <div className="space-y-1.5">
            <Input
              placeholder="Cupom (CONFORTOMELI)"
              value={couponValue}
              onChange={(e) => setCouponValue(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              placeholder="Parcelas (10)"
              type="number"
              min="1"
              max="24"
              value={installmentsValue}
              onChange={(e) => setInstallmentsValue(e.target.value)}
              className="h-8 text-xs"
            />
            <div className="flex gap-1">
              <Button size="icon-sm" variant="accent" aria-label="Salvar" onClick={savePromo}>
                <Check className="size-3.5" />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => setEditingPromo(false)}>
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <div className="space-y-0.5 text-xs">
              {offer.coupon ? (
                <Badge variant="accent">🎟 {offer.coupon}</Badge>
              ) : (
                <span className="text-muted-foreground/70">sem cupom</span>
              )}
              <div className="text-muted-foreground/80">
                {offer.installments ? `${offer.installments}x sem juros` : 'sem parcelamento'}
              </div>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Editar promoção"
              onClick={() => setEditingPromo(true)}
            >
              <Pencil className="size-3.5" />
            </Button>
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {formatDate(offer.fetchedAt)}
      </td>
    </tr>
  );
}

function SkeletonOfferCard(): React.ReactElement {
  return (
    <div className="rounded-xl border bg-card p-3 space-y-3">
      <div className="aspect-square w-full rounded-md bg-muted animate-pulse" />
      <div className="h-4 w-full bg-muted rounded animate-pulse" />
      <div className="h-4 w-2/3 bg-muted rounded animate-pulse" />
      <div className="flex items-center gap-2">
        <div className="h-6 w-16 bg-muted rounded animate-pulse" />
        <div className="h-6 w-12 bg-muted rounded animate-pulse" />
      </div>
    </div>
  );
}

function OfferGridCard({
  offer,
  onSave,
}: {
  offer: OfferRow;
  onSave: (patch: OfferPatch) => void;
}): React.ReactElement {
  const [editingLink, setEditingLink] = useState(false);
  const [linkValue, setLinkValue] = useState(offer.affiliateUrl ?? '');
  const [copied, setCopied] = useState(false);
  const copyLink = (): void => {
    if (!offer.affiliateUrl) return;
    navigator.clipboard.writeText(offer.affiliateUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="group flex flex-col rounded-xl border bg-card overflow-hidden transition-shadow hover:shadow-pop animate-fade-in-up">
      <a href={offer.url} target="_blank" rel="noreferrer" className="relative block aspect-square overflow-hidden bg-muted">
        {offer.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={offer.imageUrl}
            alt={offer.title}
            className="size-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="grid size-full place-items-center">
            <ImageOff className="size-8 text-muted-foreground" />
          </div>
        )}
        {offer.discountPct ? (
          <span className="absolute top-2 left-2 rounded-md bg-success px-2 py-0.5 text-xs font-bold text-success-foreground">
            -{formatPct(offer.discountPct)}
          </span>
        ) : null}
        <span className="absolute top-2 right-2">
          <SourceBadge kind={offer.source.kind} size="sm" />
        </span>
      </a>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <a
          href={offer.url}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-2 text-sm font-medium leading-tight hover:text-accent"
          title={offer.title}
        >
          {offer.title}
        </a>
        <div className="flex items-baseline gap-2">
          <span className="font-semibold tabular-nums">{formatBRL(Number(offer.price))}</span>
          {offer.originalPrice ? (
            <span className="text-xs text-muted-foreground line-through tabular-nums">
              {formatBRL(Number(offer.originalPrice))}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 mt-auto">
          <ScorePill value={offer.score} />
          {offer.coupon ? <Badge variant="accent">🎟 {offer.coupon}</Badge> : null}
        </div>
        {editingLink ? (
          <div className="flex items-center gap-1.5">
            <Input value={linkValue} onChange={(e) => setLinkValue(e.target.value)} className="h-8 text-xs" autoFocus />
            <Button
              size="icon-sm"
              variant="accent"
              aria-label="Salvar"
              onClick={() => {
                onSave({ affiliateUrl: linkValue });
                setEditingLink(false);
              }}
            >
              <Check className="size-3.5" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => setEditingLink(false)}>
              <X className="size-3.5" />
            </Button>
          </div>
        ) : offer.affiliateUrl ? (
          <div className="flex items-center justify-between gap-2 border-t pt-2">
            <a
              href={offer.affiliateUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate text-xs text-accent hover:underline inline-flex items-center gap-1 min-w-0"
            >
              <ExternalLink className="size-3 shrink-0" />
              <span className="truncate">{offer.affiliateUrl.replace(/^https?:\/\//, '')}</span>
            </a>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="icon-sm" variant="ghost" aria-label="Copiar" onClick={copyLink}>
                {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setEditingLink(true)}>
                <Pencil className="size-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="w-full" onClick={() => setEditingLink(true)}>
            Adicionar link de afiliado
          </Button>
        )}
      </div>
    </div>
  );
}

function ScorePill({ value }: { value: number | null }): React.ReactElement {
  if (value == null) return <span className="text-muted-foreground/60">—</span>;
  const v = Math.max(0, Math.min(1, value));
  const tone = v >= 0.7 ? 'success' : v >= 0.4 ? 'accent' : 'secondary';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative inline-block h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${
            tone === 'success' ? 'bg-success' : tone === 'accent' ? 'bg-accent' : 'bg-muted-foreground/40'
          }`}
          style={{ width: `${v * 100}%` }}
        />
      </span>
      <span className="font-mono text-xs tabular-nums">{v.toFixed(2)}</span>
    </span>
  );
}
