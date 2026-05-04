'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientFetch } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

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
  instance: { instanceName?: string };
};

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
    onSuccess: (data, id) => {
      setTestFeedback((f) => ({ ...f, [id]: 'Mensagem de teste enviada!' }));
      setTimeout(() => setTestFeedback((f) => ({ ...f, [id]: '' })), 4000);
    },
    onError: (err: Error, id) => {
      setTestFeedback((f) => ({ ...f, [id]: `Erro: ${err.message}` }));
    },
  });

  const instanceOptions = (instances.data ?? [])
    .map((i) => i.instance?.instanceName)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Canais (WhatsApp)</h1>
        <p className="text-muted-foreground">
          Cadastre os grupos onde as ofertas serão disparadas. Os grupos aparecem da sua Evolution API.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cadastrar canal</CardTitle>
            <CardDescription>
              Selecione a instância (chip), depois escolha um grupo e dê um apelido.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Instância (chip)</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={instanceFilter}
                onChange={(e) => setInstanceFilter(e.target.value)}
              >
                <option value="">— default —</option>
                {instanceOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {instances.error ? (
                <p className="text-xs text-destructive mt-1">
                  Sem acesso à Evolution: {(instances.error as Error).message}
                </p>
              ) : null}
            </div>

            <div>
              <Label>Grupo WhatsApp</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.whatsappGroupId}
                onChange={(e) => setForm((f) => ({ ...f, whatsappGroupId: e.target.value }))}
              >
                <option value="">
                  {evolutionGroups.isLoading ? 'Carregando grupos...' : '— selecione —'}
                </option>
                {(evolutionGroups.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.subject} {g.size ? `(${g.size} membros)` : ''}
                  </option>
                ))}
              </select>
              {evolutionGroups.error ? (
                <p className="text-xs text-destructive mt-1">
                  Não foi possível listar grupos: {(evolutionGroups.error as Error).message}
                </p>
              ) : null}
            </div>

            <div>
              <Label>Apelido</Label>
              <Input
                className="mt-1"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ex: Achadinhos Família 1"
              />
            </div>

            <Button
              onClick={() => createMutation.mutate()}
              disabled={!form.name || !form.whatsappGroupId || createMutation.isPending}
            >
              {createMutation.isPending ? 'Criando...' : 'Criar canal'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Canais ativos</CardTitle>
            <CardDescription>Use “Enviar teste” pra confirmar que o chip publica no grupo.</CardDescription>
          </CardHeader>
          <CardContent>
            {channels.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : (channels.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum canal cadastrado.</p>
            ) : (
              <div className="space-y-3">
                {(channels.data ?? []).map((c) => (
                  <div key={c.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.evolutionInstance ?? 'default'} · {c.whatsappGroupId}
                      </div>
                      {testFeedback[c.id] ? (
                        <div className="text-xs text-emerald-600 mt-1">{testFeedback[c.id]}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary">{c.dailySent} hoje</Badge>
                      {c.enabled ? <Badge variant="success">ativo</Badge> : <Badge>pausado</Badge>}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => testMutation.mutate(c.id)}
                        disabled={testMutation.isPending}
                      >
                        {testMutation.isPending && testMutation.variables === c.id
                          ? 'Enviando...'
                          : 'Enviar teste'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
