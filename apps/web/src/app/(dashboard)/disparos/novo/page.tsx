'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Plus } from 'lucide-react';
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
import { PageHeader } from '@/components/ui/page-header';

type Channel = { id: string; name: string; whatsappGroupId: string | null; evolutionInstance: string | null };
type Niche = { id: string; name: string; icon: string | null; enabled: boolean };
type EvolutionInstance = { name: string; status?: string };
type EvolutionGroup = { id: string; name?: string; subject?: string; size?: number };

const NICHE_TEMPLATES = [
  { name: 'Bebê & Maternidade', icon: '🍼', filters: { categoryIds: { MERCADOLIVRE: ['MLB1384'], SHOPEE: [] }, keywords: ['carrinho bebê', 'fralda', 'mamadeira'], minDiscount: 15 } },
  { name: 'Beleza & Cuidado Pessoal', icon: '💄', filters: { categoryIds: { MERCADOLIVRE: ['MLB1246'], SHOPEE: [] }, keywords: ['perfume', 'maquiagem'], minDiscount: 10 } },
  { name: 'Casa & Decoração', icon: '🏠', filters: { categoryIds: { MERCADOLIVRE: ['MLB1574'], SHOPEE: [] }, keywords: ['decoração casa', 'organizador'], minDiscount: 15 } },
  { name: 'Eletrônicos', icon: '📱', filters: { categoryIds: { MERCADOLIVRE: ['MLB1051', 'MLB1000'], SHOPEE: [] }, keywords: ['smartwatch', 'fone bluetooth'], minDiscount: 10 } },
  { name: 'Fitness & Suplementos', icon: '🏋️', filters: { categoryIds: { MERCADOLIVRE: ['MLB1276', 'MLB1540'], SHOPEE: [] }, keywords: ['whey', 'creatina'], minDiscount: 10 } },
  { name: 'Pet', icon: '🐾', filters: { categoryIds: { MERCADOLIVRE: ['MLB1071'], SHOPEE: [] }, keywords: ['ração cachorro', 'gato'], minDiscount: 10 } },
];

export default function NovoDisparoWizard(): React.ReactElement {
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: canal
  const channels = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => clientFetch<Channel[]>('/channels'),
  });
  const instances = useQuery<EvolutionInstance[]>({
    queryKey: ['evolution-instances'],
    queryFn: () => clientFetch<EvolutionInstance[]>('/evolution/instances'),
  });
  const [channelMode, setChannelMode] = useState<'existing' | 'new'>('existing');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [newChannel, setNewChannel] = useState({ name: '', instance: '', groupId: '' });
  const groups = useQuery<EvolutionGroup[]>({
    queryKey: ['evolution-groups', newChannel.instance],
    queryFn: () =>
      clientFetch<EvolutionGroup[]>(
        `/evolution/groups?instance=${encodeURIComponent(newChannel.instance)}`,
      ),
    enabled: Boolean(newChannel.instance),
  });

  // Step 2: nichos
  const niches = useQuery<Niche[]>({
    queryKey: ['niches'],
    queryFn: () => clientFetch<Niche[]>('/niches'),
  });
  const [selectedNicheIds, setSelectedNicheIds] = useState<string[]>([]);
  const [pendingNewNicheTemplates, setPendingNewNicheTemplates] = useState<typeof NICHE_TEMPLATES>([]);

  const toggleExistingNiche = (id: string): void =>
    setSelectedNicheIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleTemplate = (t: (typeof NICHE_TEMPLATES)[number]): void =>
    setPendingNewNicheTemplates((prev) =>
      prev.find((x) => x.name === t.name) ? prev.filter((x) => x.name !== t.name) : [...prev, t],
    );

  // Step 3: cadência
  const [schedule, setSchedule] = useState({
    name: '',
    intervalMinutes: 60,
    windowStartHour: 8,
    windowEndHour: 22,
    postLoop: false,
  });

  // Submit final cria tudo numa cadeia
  const submit = useMutation({
    mutationFn: async () => {
      setSubmitting(true);
      setError(null);
      // 1. Cria canal se for novo
      let channelId = selectedChannelId;
      if (channelMode === 'new') {
        if (!newChannel.name || !newChannel.instance || !newChannel.groupId) {
          throw new Error('Preencha nome, instância e grupo do canal');
        }
        const created = await clientFetch<Channel>('/channels', {
          method: 'POST',
          body: {
            name: newChannel.name,
            kind: 'WHATSAPP_GROUP',
            evolutionInstance: newChannel.instance,
            whatsappGroupId: newChannel.groupId,
          },
        });
        channelId = created.id;
      }
      if (!channelId) throw new Error('Selecione um canal');

      // 2. Cria nichos novos a partir de templates
      const newNicheIds: string[] = [];
      for (const t of pendingNewNicheTemplates) {
        const exists = niches.data?.find((n) => n.name === t.name);
        if (exists) {
          newNicheIds.push(exists.id);
          continue;
        }
        const created = await clientFetch<Niche>('/niches', {
          method: 'POST',
          body: { name: t.name, icon: t.icon, filters: t.filters },
        });
        newNicheIds.push(created.id);
      }
      const nicheIds = [...selectedNicheIds, ...newNicheIds];

      // 3. Cria campanha
      if (!schedule.name.trim()) throw new Error('Dá um nome pro disparo');
      const campaign = await clientFetch<{ id: string }>('/campaigns', {
        method: 'POST',
        body: {
          name: schedule.name,
          channelIds: [channelId],
          nicheIds,
          schedule: {
            intervalMinutes: schedule.intervalMinutes,
            windowStartHour: schedule.windowStartHour,
            windowEndHour: schedule.windowEndHour,
            postLoop: schedule.postLoop,
          },
        },
      });
      return campaign;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      router.push(`/campaigns/${data.id}`);
    },
    onError: (err: Error) => {
      setError(err.message);
      setSubmitting(false);
    },
  });

  const canAdvance = useMemo(() => {
    if (step === 1) {
      if (channelMode === 'existing') return Boolean(selectedChannelId);
      return Boolean(newChannel.name && newChannel.instance && newChannel.groupId);
    }
    if (step === 2) return selectedNicheIds.length + pendingNewNicheTemplates.length > 0;
    if (step === 3) return schedule.name.trim().length > 0;
    return true;
  }, [step, channelMode, selectedChannelId, newChannel, selectedNicheIds, pendingNewNicheTemplates, schedule.name]);

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Novo disparo"
        description="Wizard simples — escolhe o grupo, define o nicho, ajusta a cadência. Tudo numa página."
      />

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {[
          { n: 1, label: 'Grupo' },
          { n: 2, label: 'Nicho' },
          { n: 3, label: 'Cadência' },
          { n: 4, label: 'Confirmar' },
        ].map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            <div
              className={`flex size-8 items-center justify-center rounded-full text-xs font-bold ${
                step >= s.n
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {step > s.n ? <Check className="size-4" /> : s.n}
            </div>
            <span className={`text-sm ${step === s.n ? 'font-semibold' : 'text-muted-foreground'}`}>
              {s.label}
            </span>
            {i < 3 ? <ChevronRight className="size-4 text-muted-foreground" /> : null}
          </div>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Step 1 — Canal */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>1. Em qual grupo WhatsApp?</CardTitle>
            <CardDescription>Use um canal existente ou cria um novo agora</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={channelMode === 'existing' ? 'default' : 'outline'}
                onClick={() => setChannelMode('existing')}
              >
                Usar existente
              </Button>
              <Button
                size="sm"
                variant={channelMode === 'new' ? 'default' : 'outline'}
                onClick={() => setChannelMode('new')}
              >
                <Plus className="mr-1 size-3.5" />
                Criar novo
              </Button>
            </div>

            {channelMode === 'existing' ? (
              <div className="space-y-2">
                {(channels.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum canal cadastrado. Clica em "Criar novo".</p>
                ) : (
                  (channels.data ?? []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedChannelId(c.id)}
                      className={`block w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                        selectedChannelId === c.id
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-accent/50'
                      }`}
                    >
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.evolutionInstance} · {c.whatsappGroupId?.slice(0, 30)}…
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1 md:col-span-2">
                  <Label>Nome do canal</Label>
                  <Input
                    value={newChannel.name}
                    onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
                    placeholder="Ex: Promos Mães"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Instância Evolution</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={newChannel.instance}
                    onChange={(e) =>
                      setNewChannel({ ...newChannel, instance: e.target.value, groupId: '' })
                    }
                  >
                    <option value="">Selecione...</option>
                    {(instances.data ?? []).map((i) => (
                      <option key={i.name} value={i.name}>
                        {i.name} {i.status ? `(${i.status})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Grupo</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={newChannel.groupId}
                    onChange={(e) => setNewChannel({ ...newChannel, groupId: e.target.value })}
                    disabled={!newChannel.instance}
                  >
                    <option value="">Selecione um grupo...</option>
                    {(groups.data ?? []).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.subject ?? g.name ?? g.id} {g.size ? `(${g.size})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2 — Nichos */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>2. Que tipo de produto? (1 ou vários nichos)</CardTitle>
            <CardDescription>
              Pode misturar nichos existentes + criar novos com 1 click. Marque tudo que faz sentido pro grupo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(niches.data ?? []).filter((n) => n.enabled).length > 0 ? (
              <div>
                <Label className="mb-2 block">Nichos existentes</Label>
                <div className="flex flex-wrap gap-2">
                  {(niches.data ?? [])
                    .filter((n) => n.enabled)
                    .map((n) => {
                      const active = selectedNicheIds.includes(n.id);
                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => toggleExistingNiche(n.id)}
                          className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
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
                </div>
              </div>
            ) : null}
            <div>
              <Label className="mb-2 block">⚡ Templates rápidos (cria + adiciona)</Label>
              <div className="flex flex-wrap gap-2">
                {NICHE_TEMPLATES.map((t) => {
                  const alreadyExists = niches.data?.some((n) => n.name === t.name);
                  if (alreadyExists) return null;
                  const active = pendingNewNicheTemplates.find((x) => x.name === t.name);
                  return (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => toggleTemplate(t)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                        active
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-dashed border-border bg-background text-muted-foreground hover:border-accent/50'
                      }`}
                    >
                      {t.icon} {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Selecionados:{' '}
              {selectedNicheIds.length + pendingNewNicheTemplates.length === 0 ? (
                <span className="text-destructive">nenhum (escolha pelo menos 1)</span>
              ) : (
                <Badge>{selectedNicheIds.length + pendingNewNicheTemplates.length}</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 — Cadência */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>3. Quando despachar?</CardTitle>
            <CardDescription>Define ritmo e janela de horário</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Nome do disparo *</Label>
              <Input
                value={schedule.name}
                onChange={(e) => setSchedule({ ...schedule, name: e.target.value })}
                placeholder="Ex: Promos Mães diárias"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label>Intervalo entre msgs</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={schedule.intervalMinutes}
                  onChange={(e) =>
                    setSchedule({ ...schedule, intervalMinutes: Number(e.target.value) })
                  }
                >
                  <option value="5">5 min (alta freq)</option>
                  <option value="15">15 min</option>
                  <option value="30">30 min</option>
                  <option value="60">60 min (1h, recomendado)</option>
                  <option value="120">2 horas</option>
                  <option value="240">4 horas</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Hora início (BRT)</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={schedule.windowStartHour}
                  onChange={(e) =>
                    setSchedule({ ...schedule, windowStartHour: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Hora fim (BRT)</Label>
                <Input
                  type="number"
                  min={0}
                  max={24}
                  value={schedule.windowEndHour}
                  onChange={(e) =>
                    setSchedule({ ...schedule, windowEndHour: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={schedule.postLoop}
                onChange={(e) => setSchedule({ ...schedule, postLoop: e.target.checked })}
                className="size-4"
              />
              <span>Loop — quando esgotar produtos novos, recomeça do top score</span>
            </label>
          </CardContent>
        </Card>
      )}

      {/* Step 4 — Confirmar */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>4. Confirmar e ativar</CardTitle>
            <CardDescription>Revise antes de criar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="font-medium">Disparo:</span> {schedule.name}
            </div>
            <div>
              <span className="font-medium">Grupo:</span>{' '}
              {channelMode === 'existing'
                ? channels.data?.find((c) => c.id === selectedChannelId)?.name
                : `${newChannel.name} (NOVO)`}
            </div>
            <div>
              <span className="font-medium">Nichos:</span>{' '}
              {[
                ...(niches.data ?? [])
                  .filter((n) => selectedNicheIds.includes(n.id))
                  .map((n) => `${n.icon ?? ''} ${n.name}`),
                ...pendingNewNicheTemplates.map((t) => `${t.icon} ${t.name} (NOVO)`),
              ].join(', ')}
            </div>
            <div>
              <span className="font-medium">Cadência:</span> 1 produto a cada{' '}
              {schedule.intervalMinutes} min · janela {schedule.windowStartHour}h-
              {schedule.windowEndHour}h BRT
              {schedule.postLoop ? ' · loop ON' : ''}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Nav */}
      <div className="flex justify-between">
        <Button variant="outline" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
          Voltar
        </Button>
        {step < 4 ? (
          <Button disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
            Próximo
          </Button>
        ) : (
          <Button
            onClick={() => submit.mutate()}
            disabled={submitting || submit.isPending}
            size="lg"
          >
            {submit.isPending ? 'Criando...' : '🚀 Criar e ativar disparo'}
          </Button>
        )}
      </div>
    </div>
  );
}
