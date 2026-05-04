'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Pendentes (link manual)</h1>
        <p className="text-muted-foreground">
          Ofertas Shopee/ML que ainda não têm link de afiliado. Cole o shortlink que você gerar no painel.
        </p>
      </header>

      <div className="flex items-center gap-2">
        <Button variant={filter === '' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('')}>
          Todos
        </Button>
        <Button variant={filter === 'SHOPEE' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('SHOPEE')}>
          Shopee
        </Button>
        <Button
          variant={filter === 'MERCADOLIVRE' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('MERCADOLIVRE')}
        >
          Mercado Livre
        </Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{(error as Error).message}</CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Carregando...</CardContent>
        </Card>
      ) : (data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Sem pendências. Tudo com link de afiliado.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {(data ?? []).map((o) => (
            <PendingCard
              key={o.id}
              offer={o}
              onSave={(affiliateUrl) => updateMutation.mutate({ id: o.id, affiliateUrl })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PendingCard({
  offer,
  onSave,
}: {
  offer: PendingOffer;
  onSave: (affiliateUrl: string) => void;
}): React.ReactElement {
  const [value, setValue] = useState('');
  return (
    <Card>
      <CardContent className="p-4 flex flex-wrap items-center gap-4">
        {offer.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={offer.imageUrl} alt="" className="size-16 rounded object-cover" />
        ) : null}
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 text-sm">
            <SourceBadge kind={offer.source.kind} />
            <span className="text-muted-foreground">{formatDate(offer.fetchedAt)}</span>
          </div>
          <a
            href={offer.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium hover:underline line-clamp-2"
          >
            {offer.title}
          </a>
          <div className="text-sm text-muted-foreground mt-1">{formatBRL(Number(offer.price))}</div>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Input
            placeholder="Cole o link de afiliado gerado no painel"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="md:w-96"
          />
          <Button onClick={() => onSave(value)} disabled={!value.trim()}>
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
