'use client';

import { use } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { clientFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { MessagePreviewCard } from '@/components/message-preview-card';

type CampaignDetail = {
  id: string;
  name: string;
  enabled: boolean;
  filters: { minScore?: number; minDiscount?: number; sources?: string[]; maxPrice?: number };
  schedule: { intervalMinutes?: number };
  channels: { id: string; name: string }[];
  createdAt: string;
};

type Dispatch = {
  id: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  scheduledFor: string;
  sentAt: string | null;
  errorMessage: string | null;
  clickCount: number;
  createdAt: string;
  offer?: { title: string; imageUrl: string | null };
  channel?: { name: string };
};

const STATUS_BADGE: Record<Dispatch['status'], 'success' | 'destructive' | 'warning' | 'secondary'> = {
  SENT: 'success',
  FAILED: 'destructive',
  SKIPPED: 'warning',
  PENDING: 'secondary',
};

export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.ReactElement {
  const { id } = use(params);

  const campaign = useQuery<CampaignDetail>({
    queryKey: ['campaign', id],
    queryFn: () => clientFetch<CampaignDetail>(`/campaigns/${id}`),
  });

  const dispatches = useQuery<Dispatch[]>({
    queryKey: ['campaign-dispatches', id],
    queryFn: () => clientFetch<Dispatch[]>(`/campaigns/${id}/dispatches?take=50`),
  });

  const runNow = useMutation({
    mutationFn: () => clientFetch(`/campaigns/${id}/run-now`, { method: 'POST' }),
    onSuccess: () => dispatches.refetch(),
  });

  if (campaign.isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (campaign.error) return <p className="text-sm text-destructive">{(campaign.error as Error).message}</p>;
  if (!campaign.data) return <p>Campanha não encontrada.</p>;

  const c = campaign.data;
  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{c.name}</h1>
          <p className="text-muted-foreground">
            Criada em {formatDate(c.createdAt)}
            {c.schedule?.intervalMinutes ? ` · roda a cada ${c.schedule.intervalMinutes}min` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {c.filters.sources?.map((s) => (
              <Badge key={s} variant="secondary">
                {s}
              </Badge>
            ))}
            {c.filters.minScore ? <Badge variant="outline">score ≥ {c.filters.minScore}</Badge> : null}
            {c.filters.minDiscount ? <Badge variant="outline">desconto ≥ {c.filters.minDiscount}%</Badge> : null}
            {c.filters.maxPrice ? <Badge variant="outline">≤ R$ {c.filters.maxPrice}</Badge> : null}
          </div>
        </div>
        <Button onClick={() => runNow.mutate()} disabled={runNow.isPending}>
          {runNow.isPending ? 'Enfileirando...' : 'Run now'}
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Canais</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {c.channels.map((ch) => (
              <Badge key={ch.id} variant="secondary">
                {ch.name}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <MessagePreviewCard channelId={c.channels[0]?.id} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disparos recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {dispatches.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (dispatches.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum disparo ainda.</p>
          ) : (
            <div className="space-y-2">
              {(dispatches.data ?? []).map((d) => (
                <div key={d.id} className="flex items-center gap-3 border-b pb-2 last:border-0">
                  {d.offer?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.offer.imageUrl} alt="" className="size-10 rounded object-cover" />
                  ) : null}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium line-clamp-1">{d.offer?.title ?? '(oferta removida)'}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.channel?.name} · {formatDate(d.sentAt ?? d.createdAt)}
                      {d.errorMessage ? ` · ${d.errorMessage}` : ''}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">{d.clickCount} cliques</div>
                  <Badge variant={STATUS_BADGE[d.status]}>{d.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
