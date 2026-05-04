'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, ImageOff, Inbox } from 'lucide-react';
import { clientFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SourceBadge } from '@/components/source-badge';
import { formatBRL, formatDate } from '@/lib/utils';

type PendingOffer = {
  id: string;
  title: string;
  url: string;
  imageUrl: string | null;
  price: string;
  source: { kind: 'SHOPEE' | 'MERCADOLIVRE' };
  fetchedAt: string;
  score: number | null;
};

const FILTERS: { key: '' | 'SHOPEE' | 'MERCADOLIVRE'; label: string }[] = [
  { key: '', label: 'Todos' },
  { key: 'SHOPEE', label: 'Shopee' },
  { key: 'MERCADOLIVRE', label: 'Mercado Livre' },
];

export default function PendingOffersPage(): React.ReactElement {
  const [filter, setFilter] = useState<'' | 'SHOPEE' | 'MERCADOLIVRE'>('');
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<PendingOffer[]>({
    queryKey: ['pending-offers', filter],
    queryFn: () =>
      clientFetch<PendingOffer[]>(
        `/offers/pending-affiliate-link?take=50${filter ? `&source=${filter}` : ''}`,
      ),
  });

  const updateMutation = useMutation({
    mutationFn: (args: { id: string; affiliateUrl: string }) =>
      clientFetch(`/offers/${args.id}`, {
        method: 'PATCH',
        body: { affiliateUrl: args.affiliateUrl },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pending-offers'] }),
  });

  const total = (data ?? []).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pendentes"
        description="Ofertas Shopee/ML sem link de afiliado. Cole o shortlink que você gerou no painel — o dispatcher só envia depois disso."
        badge={
          total > 0 ? (
            <Badge variant="warning" dot>
              {total} {total === 1 ? 'pendência' : 'pendências'}
            </Badge>
          ) : null
        }
      />

      <div className="inline-flex rounded-lg border bg-muted/30 p-1">
        {FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <Card>
          <CardContent className="px-6 py-10 text-sm text-destructive">{(error as Error).message}</CardContent>
        </Card>
      ) : isLoading ? (
        <SkeletonRows count={4} />
      ) : (data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={CheckCircle2}
            title="Tudo limpo"
            description="Nenhuma oferta pendente — todos os SKUs Shopee/ML têm link de afiliado."
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {(data ?? []).map((o) => (
            <PendingCard
              key={o.id}
              offer={o}
              onSave={(affiliateUrl) => updateMutation.mutate({ id: o.id, affiliateUrl })}
              isSaving={updateMutation.isPending && updateMutation.variables?.id === o.id}
            />
          ))}
          {(data ?? []).length === 0 ? (
            <EmptyState icon={Inbox} title="Sem pendências" />
          ) : null}
        </div>
      )}
    </div>
  );
}

function PendingCard({
  offer,
  onSave,
  isSaving,
}: {
  offer: PendingOffer;
  onSave: (affiliateUrl: string) => void;
  isSaving: boolean;
}): React.ReactElement {
  const [value, setValue] = useState('');
  return (
    <Card className="animate-fade-in">
      <CardContent className="flex flex-wrap items-center gap-4 px-4 py-4">
        {offer.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={offer.imageUrl}
            alt=""
            className="size-16 shrink-0 rounded-md object-cover ring-1 ring-border"
          />
        ) : (
          <div className="grid size-16 shrink-0 place-items-center rounded-md bg-muted ring-1 ring-border">
            <ImageOff className="size-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 text-xs">
            <SourceBadge kind={offer.source.kind} size="sm" />
            <span className="text-muted-foreground">{formatDate(offer.fetchedAt)}</span>
          </div>
          <a
            href={offer.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 line-clamp-2 inline-flex items-center gap-1 font-medium hover:text-accent transition-colors"
          >
            {offer.title}
            <ExternalLink className="size-3.5 shrink-0" />
          </a>
          <div className="mt-1 text-sm text-muted-foreground">{formatBRL(Number(offer.price))}</div>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Input
            placeholder="Cole o shortlink (ex: https://s.shopee.com.br/4abcDE)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="md:w-[24rem]"
          />
          <Button
            variant="accent"
            onClick={() => onSave(value)}
            disabled={!value.trim()}
            loading={isSaving}
          >
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
