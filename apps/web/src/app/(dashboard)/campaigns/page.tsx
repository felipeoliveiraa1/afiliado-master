'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Megaphone,
  Play,
  Plus,
  Trash2,
  Users,
  Tag as TagIcon,
} from 'lucide-react';
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
import { formatDate } from '@/lib/utils';

type CampaignDTO = {
  id: string;
  name: string;
  enabled: boolean;
  filters: { sources?: string[]; minDiscount?: number; minScore?: number; maxPrice?: number };
  schedule: {
    intervalMinutes?: number;
    windowStartHour?: number;
    windowEndHour?: number;
    dailyLimit?: number;
    postLoop?: boolean;
    burstSizeMin?: number;
    burstSizeMax?: number;
    burstSpreadMinSec?: number;
    burstSpreadMaxSec?: number;
  };
  createdAt: string;
  channels: { id: string; name: string }[];
  niches?: { id: string; name: string; icon: string | null }[];
};

type ChannelDTO = {
  id: string;
  name: string;
  whatsappGroupId: string | null;
  evolutionInstance: string | null;
};
type NicheDTO = { id: string; name: string; icon: string | null; enabled: boolean };

export default function DisparosPage(): React.ReactElement {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const campaigns = useQuery<CampaignDTO[]>({
    queryKey: ['campaigns'],
    queryFn: () =>
      clientFetch<CampaignDTO[]>('/campaigns?include=channels,niches').catch(() =>
        clientFetch<CampaignDTO[]>('/campaigns'),
      ),
  });
  const channels = useQuery<ChannelDTO[]>({
    queryKey: ['channels'],
    queryFn: () => clientFetch<ChannelDTO[]>('/channels'),
  });
  const niches = useQuery<NicheDTO[]>({
    queryKey: ['niches'],
    queryFn: () => clientFetch<NicheDTO[]>('/niches'),
  });

  const [form, setForm] = useState({
    name: '',
    channelId: '',
    nicheIds: [] as string[],
    intervalMinutes: 60,
    windowStartHour: 8,
    windowEndHour: 22,
    dailyLimit: 0,
    postLoop: false,
    burstSizeMin: 5,
    burstSizeMax: 12,
    burstSpreadMinSec: 30,
    burstSpreadMaxSec: 120,
    minScore: 0.4,
    minDiscount: 0,
    maxPrice: 0,
  });

  const create = useMutation({
    mutationFn: () => {
      if (!form.name.trim()) throw new Error('Dá um nome pro disparo');
      if (!form.channelId) throw new Error('Selecione um canal');
      return clientFetch('/campaigns', {
        method: 'POST',
        body: {
          name: form.name,
          filters: {
            minScore: form.minScore || undefined,
            minDiscount: form.minDiscount || undefined,
            maxPrice: form.maxPrice || undefined,
          },
          schedule: {
            intervalMinutes: form.intervalMinutes,
            windowStartHour: form.windowStartHour,
            windowEndHour: form.windowEndHour,
            dailyLimit: form.dailyLimit > 0 ? form.dailyLimit : undefined,
            postLoop: form.postLoop,
            burstSizeMin: form.burstSizeMin,
            burstSizeMax: form.burstSizeMax,
            burstSpreadMinSec: form.burstSpreadMinSec,
            burstSpreadMaxSec: form.burstSpreadMaxSec,
          },
          channelIds: [form.channelId],
          nicheIds: form.nicheIds,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      setShowForm(false);
      setForm({
        name: '',
        channelId: '',
        nicheIds: [],
        intervalMinutes: 60,
        windowStartHour: 8,
        windowEndHour: 22,
        dailyLimit: 0,
        postLoop: false,
        burstSizeMin: 5,
        burstSizeMax: 12,
        burstSpreadMinSec: 30,
        burstSpreadMaxSec: 120,
        minScore: 0.4,
        minDiscount: 0,
        maxPrice: 0,
      });
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const runNow = useMutation({
    mutationFn: (id: string) => clientFetch(`/campaigns/${id}/run-now`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      clientFetch(`/campaigns/${id}`, { method: 'PATCH', body: { enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => clientFetch(`/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  const toggleNiche = (id: string): void =>
    setForm((f) => ({
      ...f,
      nicheIds: f.nicheIds.includes(id) ? f.nicheIds.filter((x) => x !== id) : [...f.nicheIds, id],
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Disparos"
        description="Cada disparo = canal WhatsApp + nicho(s) + cadência. Crie quantos quiser pra atender públicos diferentes."
        actions={
          <Button size="lg" onClick={() => setShowForm((v) => !v)}>
            {showForm ? (
              <>
                <ChevronUp className="mr-2 size-4" />
                Fechar formulário
              </>
            ) : (
              <>
                <Plus className="mr-2 size-4" />
                Novo disparo
              </>
            )}
          </Button>
        }
      />

      {/* Form inline colapsável */}
      {showForm && (
        <Card className="border-accent/40">
          <CardHeader>
            <CardTitle className="text-base">🚀 Configurar novo disparo</CardTitle>
            <CardDescription>Tudo numa página. Salvar = disparo ativo no próximo tick.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {error ? (
              <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {/* 1. Nome */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">1. Nome do disparo *</Label>
              <Input
                placeholder="Ex: Promos Mães diárias"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            {/* 2. Canal */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">2. Canal (grupo WhatsApp) *</Label>
              {channels.data && channels.data.length === 0 ? (
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  Nenhum canal cadastrado.{' '}
                  <Link href="/channels" className="text-accent underline">
                    Criar canal →
                  </Link>
                </div>
              ) : (
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.channelId}
                  onChange={(e) => setForm({ ...form, channelId: e.target.value })}
                >
                  <option value="">Selecione um canal...</option>
                  {(channels.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.evolutionInstance ? `(${c.evolutionInstance})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* 3. Nichos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">3. Nichos (1 ou vários)</Label>
                <Link href="/niches" className="text-xs text-accent hover:underline">
                  + criar nicho
                </Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {(niches.data ?? [])
                  .filter((n) => n.enabled)
                  .map((n) => {
                    const active = form.nicheIds.includes(n.id);
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => toggleNiche(n.id)}
                        className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                          active
                            ? 'border-accent bg-accent text-accent-foreground'
                            : 'border-border bg-background text-muted-foreground hover:border-accent/50'
                        }`}
                      >
                        {n.icon ? `${n.icon} ` : ''}
                        {n.name}
                      </button>
                    );
                  })}
                {(niches.data ?? []).filter((n) => n.enabled).length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Sem nichos ativos. Sem nicho = pega ofertas de qualquer categoria.
                  </span>
                ) : null}
              </div>
            </div>

            {/* 4. Cadência */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">4. Cadência</Label>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Intervalo entre bursts</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={form.intervalMinutes}
                    onChange={(e) =>
                      setForm({ ...form, intervalMinutes: Number(e.target.value) })
                    }
                  >
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="60">60 min</option>
                    <option value="90">90 min (recomendado)</option>
                    <option value="120">2 horas</option>
                    <option value="180">3 horas</option>
                    <option value="240">4 horas</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hora início (BRT)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={form.windowStartHour}
                    onChange={(e) =>
                      setForm({ ...form, windowStartHour: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hora fim (BRT)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={24}
                    value={form.windowEndHour}
                    onChange={(e) => setForm({ ...form, windowEndHour: Number(e.target.value) })}
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm pt-1">
                <input
                  type="checkbox"
                  checked={form.postLoop}
                  onChange={(e) => setForm({ ...form, postLoop: e.target.checked })}
                  className="size-4"
                />
                <span>♻️ Loop — quando esgotar produtos novos, recomeça do top score</span>
              </label>

              {/* Burst variável — imita curador humano postando "5 em 5", "8 em 8" */}
              <div className="mt-3 rounded-lg border border-dashed border-accent/30 bg-accent/5 p-3 space-y-2">
                <Label className="text-xs font-medium">
                  🌊 Burst — quantas msgs por onda + intervalo entre elas
                </Label>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Mín msgs/burst</Label>
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      value={form.burstSizeMin}
                      onChange={(e) => setForm({ ...form, burstSizeMin: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Máx msgs/burst</Label>
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      value={form.burstSizeMax}
                      onChange={(e) => setForm({ ...form, burstSizeMax: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Gap mín (s)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={600}
                      value={form.burstSpreadMinSec}
                      onChange={(e) =>
                        setForm({ ...form, burstSpreadMinSec: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Gap máx (s)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={600}
                      value={form.burstSpreadMaxSec}
                      onChange={(e) =>
                        setForm({ ...form, burstSpreadMaxSec: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Cada onda manda N mensagens (random entre mín/máx) com gap variável entre elas. Ex:
                  5-12 msgs com gap 30-120s = curador humano postando achadinhos em rajada, depois
                  pausa pelo &quot;Intervalo entre msgs&quot; acima até a próxima onda.
                </p>
              </div>
            </div>

            {/* 5. Filtros (opcional, recolhível) */}
            <details className="rounded-lg border border-dashed p-3">
              <summary className="cursor-pointer text-sm font-medium">
                🎚️ Filtros de qualidade (opcional)
              </summary>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Score mínimo (0–1)</Label>
                  <Input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    value={form.minScore}
                    onChange={(e) => setForm({ ...form, minScore: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Desconto mínimo (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.minDiscount}
                    onChange={(e) => setForm({ ...form, minDiscount: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Preço máximo (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.maxPrice}
                    onChange={(e) => setForm({ ...form, maxPrice: Number(e.target.value) })}
                  />
                </div>
              </div>
            </details>

            <div className="flex gap-2 pt-2">
              <Button onClick={() => create.mutate()} disabled={create.isPending} size="lg">
                {create.isPending ? 'Criando...' : '🚀 Criar e ativar disparo'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de disparos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disparos ativos ({campaigns.data?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {campaigns.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : !campaigns.data?.length ? (
            <EmptyState
              icon={Megaphone}
              title="Nenhum disparo ainda"
              description='Clica em "Novo disparo" pra criar o primeiro.'
            />
          ) : (
            campaigns.data.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onRunNow={() => runNow.mutate(c.id)}
                onToggle={() => toggleEnabled.mutate({ id: c.id, enabled: !c.enabled })}
                onDelete={() => {
                  if (confirm(`Excluir disparo "${c.name}"? Vai apagar todos os dispatches dele.`)) {
                    del.mutate(c.id);
                  }
                }}
                runPending={runNow.isPending && runNow.variables === c.id}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CampaignCard({
  campaign,
  onRunNow,
  onToggle,
  onDelete,
  runPending,
}: {
  campaign: CampaignDTO;
  onRunNow: () => void;
  onToggle: () => void;
  onDelete: () => void;
  runPending: boolean;
}): React.ReactElement {
  const interval = campaign.schedule?.intervalMinutes ?? 60;
  const windowStart = campaign.schedule?.windowStartHour ?? 8;
  const windowEnd = campaign.schedule?.windowEndHour ?? 22;
  return (
    <div className="rounded-lg border bg-card/50 p-4 transition-shadow hover:shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/campaigns/${campaign.id}`}
              className="text-base font-semibold hover:text-accent"
            >
              {campaign.name}
            </Link>
            {campaign.enabled ? (
              <Badge variant="success" dot>
                ativo
              </Badge>
            ) : (
              <Badge variant="secondary" dot>
                pausado
              </Badge>
            )}
            {campaign.schedule?.postLoop ? <Badge variant="accent">♻️ loop</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {campaign.channels?.length ? (
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" />
                {campaign.channels.map((c) => c.name).join(', ')}
              </span>
            ) : null}
            {campaign.niches?.length ? (
              <span className="inline-flex items-center gap-1">
                <TagIcon className="size-3" />
                {campaign.niches.map((n) => `${n.icon ?? ''} ${n.name}`).join(' · ')}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {interval}min · {windowStart}h–{windowEnd}h BRT
            </span>
            <span>criado {formatDate(campaign.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="accent" onClick={onRunNow} loading={runPending}>
            <Play className="size-3.5" />
            Run now
          </Button>
          <Button size="sm" variant="outline" onClick={onToggle}>
            {campaign.enabled ? 'Pausar' : 'Ativar'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDelete}
            className="text-destructive hover:bg-destructive/10"
            aria-label="Excluir"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
