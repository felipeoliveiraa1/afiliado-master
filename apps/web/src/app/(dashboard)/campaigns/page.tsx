'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientFetch } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { MessagePreviewCard } from '@/components/message-preview-card';

type CampaignDTO = {
  id: string;
  name: string;
  enabled: boolean;
  filters: { sources?: string[]; minDiscount?: number; minScore?: number; maxPrice?: number };
  schedule: { intervalMinutes?: number };
  createdAt: string;
};

type ChannelDTO = { id: string; name: string };

export default function CampaignsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    minScore: 0.4,
    minDiscount: 0,
    maxPrice: 0,
    intervalMinutes: 60,
    sources: ['SHOPEE', 'AMAZON', 'MERCADOLIVRE', 'PROMOBIT'] as string[],
    channelIds: [] as string[],
  });

  const campaigns = useQuery<CampaignDTO[]>({
    queryKey: ['campaigns'],
    queryFn: () => clientFetch<CampaignDTO[]>('/campaigns'),
    enabled: false,
  });

  const channels = useQuery<ChannelDTO[]>({
    queryKey: ['channels'],
    queryFn: () => clientFetch<ChannelDTO[]>('/channels'),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      clientFetch('/campaigns', {
        method: 'POST',
        body: {
          name: form.name,
          filters: {
            sources: form.sources,
            minScore: form.minScore || undefined,
            minDiscount: form.minDiscount || undefined,
            maxPrice: form.maxPrice || undefined,
          },
          schedule: { intervalMinutes: form.intervalMinutes },
          channelIds: form.channelIds,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      campaigns.refetch();
    },
  });

  const runNowMutation = useMutation({
    mutationFn: (id: string) => clientFetch(`/campaigns/${id}/run-now`, { method: 'POST' }),
  });

  const toggleSource = (kind: string): void => {
    setForm((f) => ({
      ...f,
      sources: f.sources.includes(kind) ? f.sources.filter((s) => s !== kind) : [...f.sources, kind],
    }));
  };

  const toggleChannel = (id: string): void => {
    setForm((f) => ({
      ...f,
      channelIds: f.channelIds.includes(id) ? f.channelIds.filter((c) => c !== id) : [...f.channelIds, id],
    }));
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Campanhas</h1>
        <p className="text-muted-foreground">
          Configure quais ofertas vão para quais canais, com filtros e intervalos.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova campanha</CardTitle>
          <CardDescription>Filtros são aplicados sobre as ofertas captadas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Nome</Label>
              <Input
                className="mt-1"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Intervalo (minutos)</Label>
              <Input
                className="mt-1"
                type="number"
                min={5}
                value={form.intervalMinutes}
                onChange={(e) => setForm((f) => ({ ...f, intervalMinutes: Number(e.target.value) }))}
              />
            </div>
            <div>
              <Label>Score mínimo (0-1)</Label>
              <Input
                className="mt-1"
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={form.minScore}
                onChange={(e) => setForm((f) => ({ ...f, minScore: Number(e.target.value) }))}
              />
            </div>
            <div>
              <Label>Desconto mínimo (%)</Label>
              <Input
                className="mt-1"
                type="number"
                min={0}
                max={100}
                value={form.minDiscount}
                onChange={(e) => setForm((f) => ({ ...f, minDiscount: Number(e.target.value) }))}
              />
            </div>
            <div>
              <Label>Preço máximo (R$)</Label>
              <Input
                className="mt-1"
                type="number"
                min={0}
                value={form.maxPrice}
                onChange={(e) => setForm((f) => ({ ...f, maxPrice: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div>
            <Label>Sources</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {['SHOPEE', 'AMAZON', 'MERCADOLIVRE', 'PROMOBIT'].map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={form.sources.includes(s) ? 'default' : 'outline'}
                  onClick={() => toggleSource(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label>Canais</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(channels.data ?? []).map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  size="sm"
                  variant={form.channelIds.includes(c.id) ? 'default' : 'outline'}
                  onClick={() => toggleChannel(c.id)}
                >
                  {c.name}
                </Button>
              ))}
              {(channels.data ?? []).length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  Nenhum canal — cadastre primeiro em /channels
                </span>
              ) : null}
            </div>
          </div>

          <Button
            onClick={() => createMutation.mutate()}
            disabled={!form.name || form.channelIds.length === 0 || createMutation.isPending}
          >
            {createMutation.isPending ? 'Criando...' : 'Criar campanha'}
          </Button>
          {createMutation.error ? (
            <p className="text-sm text-destructive">{(createMutation.error as Error).message}</p>
          ) : null}
        </CardContent>
      </Card>

      <MessagePreviewCard title="Preview do template (com a melhor oferta atual)" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campanhas existentes</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={() => campaigns.refetch()}>
            Recarregar
          </Button>
          {campaigns.data && campaigns.data.length > 0 ? (
            <div className="mt-4 space-y-3">
              {campaigns.data.map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(c.createdAt)} · score≥{c.filters.minScore ?? 0} ·{' '}
                      {c.schedule?.intervalMinutes}min
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.enabled ? <Badge variant="success">ativa</Badge> : <Badge>pausada</Badge>}
                    <Button size="sm" onClick={() => runNowMutation.mutate(c.id)}>
                      Run now
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Clique em &quot;Recarregar&quot; para listar.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
