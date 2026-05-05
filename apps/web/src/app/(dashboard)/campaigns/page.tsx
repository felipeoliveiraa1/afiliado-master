'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Play, RefreshCw } from 'lucide-react';
import { clientFetch } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Spinner } from '@/components/ui/spinner';
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

const SOURCES = ['SHOPEE', 'AMAZON', 'MERCADOLIVRE', 'PROMOBIT'] as const;

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
      setForm((f) => ({ ...f, name: '' }));
    },
  });

  const runNowMutation = useMutation({
    mutationFn: (id: string) => clientFetch(`/campaigns/${id}/run-now`, { method: 'POST' }),
    onSuccess: () => campaigns.refetch(),
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      clientFetch(`/campaigns/${id}`, { method: 'PATCH', body: { enabled } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      campaigns.refetch();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientFetch(`/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      campaigns.refetch();
    },
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
      <PageHeader
        title="Campanhas"
        description="Configure quais ofertas vão para quais canais, com filtros e intervalos."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,360px)]">
        <Card>
          <CardHeader>
            <CardTitle>Nova campanha</CardTitle>
            <CardDescription>Filtros são aplicados sobre as ofertas já captadas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nome">
                <Input
                  value={form.name}
                  placeholder="Ex: Eletrônicos premium"
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </Field>
              <Field label="Intervalo (min)">
                <Input
                  type="number"
                  min={5}
                  value={form.intervalMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, intervalMinutes: Number(e.target.value) }))}
                />
              </Field>
              <Field label="Score mínimo (0–1)">
                <Input
                  type="number"
                  step="0.05"
                  min={0}
                  max={1}
                  value={form.minScore}
                  onChange={(e) => setForm((f) => ({ ...f, minScore: Number(e.target.value) }))}
                />
              </Field>
              <Field label="Desconto mínimo (%)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.minDiscount}
                  onChange={(e) => setForm((f) => ({ ...f, minDiscount: Number(e.target.value) }))}
                />
              </Field>
              <Field label="Preço máximo (R$)" className="md:col-span-2">
                <Input
                  type="number"
                  min={0}
                  value={form.maxPrice}
                  onChange={(e) => setForm((f) => ({ ...f, maxPrice: Number(e.target.value) }))}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <Label>Sources</Label>
              <div className="flex flex-wrap gap-2">
                {SOURCES.map((s) => {
                  const active = form.sources.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSource(s)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        active
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-border bg-background text-muted-foreground hover:border-accent/50 hover:text-foreground'
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Canais</Label>
              <div className="flex flex-wrap gap-2">
                {(channels.data ?? []).map((c) => {
                  const active = form.channelIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleChannel(c.id)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        active
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-border bg-background text-muted-foreground hover:border-accent/50 hover:text-foreground'
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
                {(channels.data ?? []).length === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    Nenhum canal cadastrado.{' '}
                    <Link href="/channels" className="text-accent hover:underline">
                      Cadastrar
                    </Link>
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-4">
              {createMutation.error ? (
                <p className="text-sm text-destructive">{(createMutation.error as Error).message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  A campanha começa a rodar no próximo ciclo do scheduler.
                </p>
              )}
              <Button
                variant="accent"
                onClick={() => createMutation.mutate()}
                disabled={!form.name || form.channelIds.length === 0}
                loading={createMutation.isPending}
              >
                Criar campanha
              </Button>
            </div>
          </CardContent>
        </Card>

        <MessagePreviewCard title="Preview do template" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Campanhas existentes</CardTitle>
            <CardDescription>Use “Run now” para forçar um ciclo imediato.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => campaigns.refetch()}>
            <RefreshCw className="size-3.5" /> Recarregar
          </Button>
        </CardHeader>
        <CardContent>
          {campaigns.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner label="Carregando campanhas…" />
            </div>
          ) : campaigns.data && campaigns.data.length > 0 ? (
            <div className="divide-y">
              {campaigns.data.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <Link href={`/campaigns/${c.id}`} className="block font-medium hover:text-accent">
                      {c.name}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      criada {formatDate(c.createdAt)} · score≥{c.filters.minScore ?? 0} ·{' '}
                      {c.schedule?.intervalMinutes ?? '?'}min
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.enabled ? (
                      <Badge variant="success" dot>
                        ativa
                      </Badge>
                    ) : (
                      <Badge variant="secondary" dot>
                        pausada
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="accent"
                      onClick={() => runNowMutation.mutate(c.id)}
                      loading={runNowMutation.isPending && runNowMutation.variables === c.id}
                    >
                      <Play className="size-3.5" /> Run now
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleEnabledMutation.mutate({ id: c.id, enabled: !c.enabled })}
                    >
                      {c.enabled ? 'Pausar' : 'Ativar'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (confirm(`Excluir campanha "${c.name}"? Vai deletar todos os dispatches dela.`)) {
                          deleteMutation.mutate(c.id);
                        }
                      }}
                      className="text-destructive hover:text-destructive"
                    >
                      Excluir
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Megaphone}
              title="Nenhuma campanha ainda"
              description="Crie a primeira no formulário acima — ela vai entrar no ciclo de disparo automaticamente."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
