'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Tag, Plus, Trash2, AlertCircle } from 'lucide-react';
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
import { SkeletonRows } from '@/components/ui/skeleton';

type ShopeeCoupon = {
  id: string;
  code: string;
  description: string | null;
  seller: string | null;
  discountText: string | null;
  validUntil: string | null;
  enabled: boolean;
  createdAt: string;
};

export default function ShopeeCouponsPage(): React.ReactElement {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    code: '',
    description: '',
    seller: '',
    discountText: '',
    validUntil: '',
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: coupons, isLoading } = useQuery<ShopeeCoupon[]>({
    queryKey: ['shopee-coupons'],
    queryFn: () => clientFetch<ShopeeCoupon[]>('/sources/SHOPEE/coupons'),
  });

  const create = useMutation<ShopeeCoupon>({
    mutationFn: () =>
      clientFetch<ShopeeCoupon>('/sources/SHOPEE/coupons', {
        method: 'POST',
        body: {
          code: form.code,
          description: form.description || undefined,
          seller: form.seller || undefined,
          discountText: form.discountText || undefined,
          validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopee-coupons'] });
      setForm({ code: '', description: '', seller: '', discountText: '', validUntil: '' });
      setErrorMsg(null);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const toggle = useMutation<ShopeeCoupon, Error, { id: string; enabled: boolean }>({
    mutationFn: ({ id, enabled }) =>
      clientFetch<ShopeeCoupon>(`/sources/SHOPEE/coupons/${id}`, {
        method: 'PATCH',
        body: { enabled },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shopee-coupons'] }),
  });

  const del = useMutation<unknown, Error, string>({
    mutationFn: (id) => clientFetch(`/sources/SHOPEE/coupons/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shopee-coupons'] }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cupons Shopee"
        description='Open API Shopee NÃO expõe cupons. Cole aqui códigos que recebe via App/Email/Portal afiliado. Quando seller bater com produto Shopee, código vai automático no caption do WhatsApp. Sem seller = "cupom de plataforma" (aplica em qualquer produto Shopee sem cupom específico).'
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4 text-primary" />
            Cadastrar cupom
          </CardTitle>
          <CardDescription>
            Code é obrigatório. Seller deixa vazio se for cupom de plataforma (todas as lojas).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Code *</Label>
              <Input
                placeholder="M0D4555HP"
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s/g, '') })
                }
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label>Seller (deixa vazio = plataforma)</Label>
              <Input
                placeholder="Loja oficial X"
                value={form.seller}
                onChange={(e) => setForm({ ...form, seller: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Desconto (texto)</Label>
              <Input
                placeholder="20% off / R$30 off / Frete grátis"
                value={form.discountText}
                onChange={(e) => setForm({ ...form, discountText: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Validade</Label>
              <Input
                type="datetime-local"
                value={form.validUntil}
                onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Descrição (opcional)</Label>
              <Input
                placeholder="Ex: 20% off + frete grátis em moda feminina"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || form.code.length < 3}
          >
            {create.isPending ? 'Salvando...' : 'Salvar cupom'}
          </Button>
        </CardContent>
      </Card>

      {errorMsg && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {errorMsg}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Tag className="h-4 w-4" />
            Cupons cadastrados
            <span className="text-xs text-muted-foreground">({coupons?.length ?? 0})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <SkeletonRows count={3} />
          ) : !coupons?.length ? (
            <EmptyState
              icon={Tag}
              title="Nenhum cupom"
              description="Cadastre o primeiro acima. Códigos vêm do App Shopee → Cupons, ou do email de campanhas do programa."
            />
          ) : (
            coupons.map((c) => {
              const expired = c.validUntil ? new Date(c.validUntil) < new Date() : false;
              return (
                <div key={c.id} className="rounded-lg border bg-card/50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="default" className="font-mono">
                          {c.code}
                        </Badge>
                        {c.discountText ? <Badge variant="accent">{c.discountText}</Badge> : null}
                        {expired ? (
                          <Badge variant="destructive">Expirado</Badge>
                        ) : c.enabled ? (
                          <Badge variant="secondary">Ativo</Badge>
                        ) : (
                          <Badge variant="secondary">Pausado</Badge>
                        )}
                        {!c.seller ? <Badge variant="secondary">Plataforma</Badge> : null}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {c.seller ? <>Seller: <span className="font-medium text-foreground">{c.seller}</span> · </> : null}
                        {c.description ? <>{c.description} · </> : null}
                        {c.validUntil ? `Vence ${new Date(c.validUntil).toLocaleDateString('pt-BR')}` : 'Sem validade'}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggle.mutate({ id: c.id, enabled: !c.enabled })}
                      >
                        {c.enabled ? 'Pausar' : 'Ativar'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm(`Excluir cupom ${c.code}?`)) del.mutate(c.id);
                        }}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
