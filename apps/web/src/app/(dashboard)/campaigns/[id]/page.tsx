'use client';

import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ImageOff, Play } from 'lucide-react';
import { clientFetch } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { PageHeader } from '@/components/ui/page-header';
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

  if (campaign.isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner label="Carregando campanha…" />
      </div>
    );
  }
  if (campaign.error) {
    return <p className="text-sm text-destructive">{(campaign.error as Error).message}</p>;
  }
  if (!campaign.data) return <p>Campanha não encontrada.</p>;

  const c = campaign.data;
  return (
    <div className="space-y-6">
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Voltar
      </Link>

      <PageHeader
        title={c.name}
        description={
          <>
            criada em {formatDate(c.createdAt)}
            {c.schedule?.intervalMinutes ? ` · roda a cada ${c.schedule.intervalMinutes}min` : ''}
          </>
        }
        badge={
          c.enabled ? (
            <Badge variant="success" dot>
              ativa
            </Badge>
          ) : (
            <Badge variant="secondary" dot>
              pausada
            </Badge>
          )
        }
        actions={
          <Button variant="accent" onClick={() => runNow.mutate()} loading={runNow.isPending}>
            <Play className="size-4" /> Run now
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {c.filters.sources?.map((s) => (
          <Badge key={s} variant="accent">
            {s}
          </Badge>
        ))}
        {c.filters.minScore ? <Badge variant="outline">score ≥ {c.filters.minScore}</Badge> : null}
        {c.filters.minDiscount ? <Badge variant="outline">desconto ≥ {c.filters.minDiscount}%</Badge> : null}
        {c.filters.maxPrice ? <Badge variant="outline">≤ R$ {c.filters.maxPrice}</Badge> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,360px)]">
        <Card>
          <CardHeader>
            <CardTitle>Canais</CardTitle>
            <CardDescription>Cada canal recebe a oferta filtrada.</CardDescription>
          </CardHeader>
          <CardContent>
            {c.channels.length === 0 ? (
              <EmptyState title="Nenhum canal anexado" description="Edite a campanha pra adicionar canais." />
            ) : (
              <div className="flex flex-wrap gap-2">
                {c.channels.map((ch) => (
                  <Badge key={ch.id} variant="secondary">
                    {ch.name}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <MessagePreviewCard channelId={c.channels[0]?.id} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Disparos recentes</CardTitle>
          <CardDescription>Últimos 50 — atualizados ao vivo após cada Run now.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {dispatches.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner label="Carregando…" />
            </div>
          ) : (dispatches.data ?? []).length === 0 ? (
            <EmptyState title="Sem disparos ainda" description="Use Run now ou aguarde o ciclo do scheduler." />
          ) : (
            <ul className="divide-y">
              {(dispatches.data ?? []).map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3 row-hover">
                  {d.offer?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.offer.imageUrl}
                      alt=""
                      className="size-10 shrink-0 rounded object-cover ring-1 ring-border"
                    />
                  ) : (
                    <div className="grid size-10 shrink-0 place-items-center rounded bg-muted">
                      <ImageOff className="size-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="line-clamp-1 font-medium text-sm">
                      {d.offer?.title ?? '(oferta removida)'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.channel?.name} · {formatDate(d.sentAt ?? d.createdAt)}
                      {d.errorMessage ? ` · ${d.errorMessage}` : ''}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {d.clickCount} cliques
                  </span>
                  <Badge variant={STATUS_BADGE[d.status]} dot>
                    {d.status.toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
