'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Send, Smartphone, Users } from 'lucide-react';
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
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { PageHeader } from '@/components/ui/page-header';

type ChannelDTO = {
  id: string;
  name: string;
  kind: 'WHATSAPP_GROUP' | 'TELEGRAM_CHANNEL';
  evolutionInstance: string | null;
  whatsappGroupId: string | null;
  enabled: boolean;
  dailySent: number;
};

type EvolutionGroup = {
  id: string;
  subject: string;
  size: number;
};

type EvolutionInstance = {
  // Evolution v1 wrapped em `instance.*`; v2 retorna na raiz.
  // Ler ambos pra ser compat.
  id?: string;
  name?: string;
  profileName?: string | null;
  profilePicUrl?: string | null;
  number?: string | null;
  connectionStatus?: 'open' | 'close' | 'connecting' | string;
  instance?: {
    instanceName?: string;
    profileName?: string | null;
    profilePictureUrl?: string | null;
    state?: string;
  };
};

type NormalizedInstance = {
  name: string;
  profileName: string | null;
  profilePicUrl: string | null;
  number: string | null;
  status: 'open' | 'close' | 'connecting' | 'unknown';
};

function normalizeInstance(raw: EvolutionInstance): NormalizedInstance | null {
  const name = raw.name ?? raw.instance?.instanceName;
  if (!name) return null;
  return {
    name,
    profileName: raw.profileName ?? raw.instance?.profileName ?? null,
    profilePicUrl: raw.profilePicUrl ?? raw.instance?.profilePictureUrl ?? null,
    number: raw.number ?? null,
    status:
      (raw.connectionStatus as NormalizedInstance['status']) ??
      (raw.instance?.state as NormalizedInstance['status']) ??
      'unknown',
  };
}

export default function ChannelsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [instanceFilter, setInstanceFilter] = useState('');
  const [form, setForm] = useState({ name: '', whatsappGroupId: '', evolutionInstance: '' });
  const [testFeedback, setTestFeedback] = useState<Record<string, string>>({});

  const channels = useQuery<ChannelDTO[]>({
    queryKey: ['channels'],
    queryFn: () => clientFetch<ChannelDTO[]>('/channels'),
  });

  const instances = useQuery<EvolutionInstance[]>({
    queryKey: ['evolution-instances'],
    queryFn: () => clientFetch<EvolutionInstance[]>('/evolution/instances'),
  });

  const evolutionGroups = useQuery<EvolutionGroup[]>({
    queryKey: ['evolution-groups', instanceFilter],
    queryFn: () =>
      clientFetch<EvolutionGroup[]>(
        instanceFilter ? `/evolution/groups?instance=${encodeURIComponent(instanceFilter)}` : '/evolution/groups',
      ),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      clientFetch('/channels', {
        method: 'POST',
        body: {
          name: form.name,
          kind: 'WHATSAPP_GROUP',
          whatsappGroupId: form.whatsappGroupId,
          evolutionInstance: form.evolutionInstance || instanceFilter || undefined,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      setForm({ name: '', whatsappGroupId: '', evolutionInstance: '' });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) =>
      clientFetch<{ sent: boolean; text: string }>(`/channels/${id}/test-message`, { method: 'POST' }),
    onSuccess: (_data, id) => {
      setTestFeedback((f) => ({ ...f, [id]: 'Mensagem de teste enviada!' }));
      setTimeout(() => setTestFeedback((f) => ({ ...f, [id]: '' })), 4000);
    },
    onError: (err: Error, id) => {
      setTestFeedback((f) => ({ ...f, [id]: `Erro: ${err.message}` }));
    },
  });

  const instanceOptions = (instances.data ?? [])
    .map(normalizeInstance)
    .filter((i): i is NormalizedInstance => i !== null)
    .sort((a, b) => {
      // conectados primeiro
      const order: Record<string, number> = { open: 0, connecting: 1, close: 2, unknown: 3 };
      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Canais (WhatsApp)"
        description="Cadastre os grupos onde as ofertas serão disparadas. Os grupos vêm da sua Evolution API."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cadastrar canal</CardTitle>
            <CardDescription>Selecione a instância (chip) e depois o grupo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Instância (chip)</Label>
              <Select value={instanceFilter} onChange={(e) => setInstanceFilter(e.target.value)}>
                <option value="">— default —</option>
                {instanceOptions.map((i) => {
                  const dot = i.status === 'open' ? '🟢' : i.status === 'connecting' ? '🟡' : '🔴';
                  const label = i.profileName ? `${i.name} · ${i.profileName}` : i.name;
                  return (
                    <option key={i.name} value={i.name}>
                      {dot} {label}
                    </option>
                  );
                })}
              </Select>
              {instances.isLoading ? (
                <p className="text-xs text-muted-foreground">Carregando instâncias…</p>
              ) : instances.error ? (
                <p className="text-xs text-destructive">
                  Sem acesso à Evolution: {(instances.error as Error).message}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {instanceOptions.length} {instanceOptions.length === 1 ? 'instância' : 'instâncias'} ·{' '}
                  {instanceOptions.filter((i) => i.status === 'open').length} conectada(s)
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Grupo WhatsApp</Label>
              <Select
                value={form.whatsappGroupId}
                onChange={(e) => setForm((f) => ({ ...f, whatsappGroupId: e.target.value }))}
                disabled={evolutionGroups.isLoading}
              >
                <option value="">
                  {evolutionGroups.isLoading ? 'Carregando grupos…' : '— selecione —'}
                </option>
                {(evolutionGroups.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.subject} {g.size ? `· ${g.size} membros` : ''}
                  </option>
                ))}
              </Select>
              {evolutionGroups.error ? (
                <p className="text-xs text-destructive">
                  Não foi possível listar grupos: {(evolutionGroups.error as Error).message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label>Apelido</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ex: Achadinhos Família 1"
              />
            </div>

            <Button
              variant="accent"
              onClick={() => createMutation.mutate()}
              disabled={!form.name || !form.whatsappGroupId}
              loading={createMutation.isPending}
            >
              Criar canal
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Canais ativos</CardTitle>
            <CardDescription>“Enviar teste” confirma que o chip publica no grupo.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {channels.isLoading ? (
              <div className="flex justify-center py-6">
                <Spinner label="Carregando…" />
              </div>
            ) : (channels.data ?? []).length === 0 ? (
              <EmptyState
                icon={Users}
                title="Nenhum canal cadastrado"
                description="Use o formulário ao lado para anexar um grupo da Evolution."
              />
            ) : (
              <ul className="divide-y">
                {(channels.data ?? []).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-3 row-hover">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                      <Smartphone className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm">{c.name}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {c.evolutionInstance ?? 'default'} · {c.whatsappGroupId}
                      </p>
                      {testFeedback[c.id] ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-success-soft-foreground">
                          <CheckCircle2 className="size-3" />
                          {testFeedback[c.id]}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary">{c.dailySent} hoje</Badge>
                      {c.enabled ? (
                        <Badge variant="success" dot>
                          ativo
                        </Badge>
                      ) : (
                        <Badge variant="secondary" dot>
                          pausado
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => testMutation.mutate(c.id)}
                        loading={testMutation.isPending && testMutation.variables === c.id}
                      >
                        <Send className="size-3.5" /> Teste
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
