'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clientFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';

type Status = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

type Campaign = { id: string; name: string };

type Dispatch = {
  id: string;
  campaignId: string;
  status: Status;
  scheduledFor: string;
  sentAt: string | null;
  errorMessage: string | null;
  clickCount: number;
  createdAt: string;
  offer?: { title: string; imageUrl: string | null };
  channel?: { name: string };
};

const STATUS_BADGE: Record<Status, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  SENT: 'success',
  FAILED: 'destructive',
  SKIPPED: 'warning',
  PENDING: 'secondary',
};

export default function DispatchesPage(): React.ReactElement {
  const [status, setStatus] = useState<Status | ''>('');

  const campaigns = useQuery<Campaign[]>({
    queryKey: ['campaigns-list'],
    queryFn: () => clientFetch<Campaign[]>('/campaigns'),
  });

  const [campaignId, setCampaignId] = useState<string>('');

  const dispatches = useQuery<Dispatch[]>({
    queryKey: ['dispatches', campaignId, status],
    queryFn: () =>
      clientFetch<Dispatch[]>(
        `/campaigns/${campaignId}/dispatches?${status ? `status=${status}&` : ''}take=100`,
      ),
    enabled: Boolean(campaignId),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Disparos</h1>
        <p className="text-muted-foreground">Histórico filtrado por campanha e status.</p>
      </header>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-center gap-3">
          <select
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            <option value="">— escolha uma campanha —</option>
            {(campaigns.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            {(['', 'SENT', 'FAILED', 'SKIPPED', 'PENDING'] as const).map((s) => (
              <Button
                key={s || 'all'}
                size="sm"
                variant={status === s ? 'default' : 'outline'}
                onClick={() => setStatus(s as Status | '')}
              >
                {s || 'Todos'}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          {!campaignId ? (
            <p className="text-sm text-muted-foreground">Escolha uma campanha acima.</p>
          ) : dispatches.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (dispatches.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem disparos com esses filtros.</p>
          ) : (
            <div className="space-y-2">
              {(dispatches.data ?? []).map((d) => (
                <div key={d.id} className="flex items-center gap-3 border-b pb-2 last:border-0">
                  {d.offer?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.offer.imageUrl} alt="" className="size-10 rounded object-cover" />
                  ) : null}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium line-clamp-1">{d.offer?.title ?? '—'}</div>
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
