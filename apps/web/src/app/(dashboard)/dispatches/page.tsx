'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageOff, Send } from 'lucide-react';
import { clientFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/page-header';
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

const STATUS_FILTERS: { key: Status | ''; label: string }[] = [
  { key: '', label: 'Todos' },
  { key: 'SENT', label: 'Enviados' },
  { key: 'PENDING', label: 'Pendentes' },
  { key: 'FAILED', label: 'Falhas' },
  { key: 'SKIPPED', label: 'Skipped' },
];

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
      <PageHeader title="Disparos" description="Histórico filtrado por campanha e status." />

      <Card>
        <CardContent className="px-5 py-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1.5 min-w-[240px] flex-1">
            <Label>Campanha</Label>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">— escolha uma campanha —</option>
              {(campaigns.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="inline-flex rounded-lg border bg-muted/30 p-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.key || 'all'}
                type="button"
                onClick={() => setStatus(s.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  status === s.key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!campaignId ? (
            <EmptyState
              icon={Send}
              title="Escolha uma campanha"
              description="Os disparos aparecem aqui — sentidos por status, com clique e erro inline."
            />
          ) : dispatches.isLoading ? (
            <div className="px-6 py-4">
              <SkeletonRows count={6} />
            </div>
          ) : (dispatches.data ?? []).length === 0 ? (
            <EmptyState title="Sem disparos com esses filtros" />
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
                    <p className="line-clamp-1 font-medium text-sm">{d.offer?.title ?? '—'}</p>
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
