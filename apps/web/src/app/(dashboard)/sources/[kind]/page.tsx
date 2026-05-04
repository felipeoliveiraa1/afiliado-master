'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SourceBadge } from '@/components/source-badge';
import { formatDate } from '@/lib/utils';

type SourceKind = 'SHOPEE' | 'AMAZON' | 'MERCADOLIVRE' | 'PROMOBIT';

type RecentOffer = {
  id: string;
  title: string;
  affiliateUrl: string | null;
  url: string;
  fetchedAt: string;
  imageUrl: string | null;
};

const COPY: Record<SourceKind, { title: string; subtitle: string; hasCookie: boolean }> = {
  SHOPEE: {
    title: 'Shopee',
    subtitle: 'Open API quando aprovada, fallback via cookie do painel.',
    hasCookie: true,
  },
  AMAZON: {
    title: 'Amazon',
    subtitle: 'Captação via Apify. Link de afiliado montado com ?tag=.',
    hasCookie: false,
  },
  MERCADOLIVRE: {
    title: 'Mercado Livre',
    subtitle: 'API pública para descoberta + cookie do painel para conversão automática.',
    hasCookie: true,
  },
  PROMOBIT: {
    title: 'Promobit',
    subtitle: 'Agregador comunitário. Resolve para Amazon/Shopee/ML por trás.',
    hasCookie: false,
  },
};

export default function SourcePage({ params }: { params: Promise<{ kind: string }> }): React.ReactElement {
  const { kind: rawKind } = use(params);
  const kind = rawKind.toUpperCase() as SourceKind;
  const copy = COPY[kind];
  const [limit, setLimit] = useState('30');
  const queryClient = useQueryClient();

  const offers = useQuery<RecentOffer[]>({
    queryKey: ['source-offers', kind],
    queryFn: () => clientFetch<RecentOffer[]>(`/offers?source=${kind}&take=10`),
  });

  const fetchMutation = useMutation({
    mutationFn: () =>
      clientFetch(`/sources/${kind}/fetch`, {
        method: 'POST',
        body: { limit: Number(limit) },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['source-offers', kind] }),
  });

  if (!copy) {
    return <div>Source desconhecida: {kind}</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <SourceBadge kind={kind} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{copy.title}</h1>
          <p className="text-muted-foreground">{copy.subtitle}</p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Captura manual</CardTitle>
          <CardDescription>
            Dispara um job de fetch agora. O cron já roda a cada 30min, isso é só pra forçar.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="w-32">
            <Label>Limite</Label>
            <Input
              type="number"
              min="1"
              max="200"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button onClick={() => fetchMutation.mutate()} disabled={fetchMutation.isPending}>
            {fetchMutation.isPending ? 'Enfileirando...' : 'Capturar agora'}
          </Button>
          {fetchMutation.data ? (
            <Badge variant="success">enfileirado</Badge>
          ) : fetchMutation.error ? (
            <Badge variant="destructive">{(fetchMutation.error as Error).message}</Badge>
          ) : null}
        </CardContent>
      </Card>

      {copy.hasCookie ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cookie do painel</CardTitle>
            <CardDescription>
              Necessário para conversão automática URL → link de afiliado quando a API oficial não está disponível.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <a href={`/sources/${kind === 'SHOPEE' ? 'shopee' : 'mercadolivre'}/cookie`}>
                Configurar cookie {copy.title}
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimas ofertas captadas</CardTitle>
        </CardHeader>
        <CardContent>
          {offers.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (offers.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma ainda.</p>
          ) : (
            <div className="grid gap-3">
              {(offers.data ?? []).map((o) => (
                <div key={o.id} className="flex items-center gap-3 border-b pb-2 last:border-0">
                  {o.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.imageUrl} alt="" className="size-12 rounded object-cover" />
                  ) : null}
                  <div className="flex-1 min-w-0">
                    <a
                      href={o.affiliateUrl ?? o.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:underline line-clamp-2"
                    >
                      {o.title}
                    </a>
                    <p className="text-xs text-muted-foreground">{formatDate(o.fetchedAt)}</p>
                  </div>
                  {o.affiliateUrl ? (
                    <Badge variant="success">afiliado</Badge>
                  ) : (
                    <Badge variant="warning">sem link</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
