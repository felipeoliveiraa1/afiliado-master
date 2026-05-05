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
  imageUrl: string | null;
  validUntil: string | null;
  enabled: boolean;
  createdAt: string;
};

type ChannelDTO = { id: string; name: string };

export default function ShopeeCouponsPage(): React.ReactElement {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    code: '',
    description: '',
    type: 'PERCENT' as 'PERCENT' | 'FIXED',
    value: 0,
    minPurchase: 0,
    maxDiscount: 0,
    seller: '',
    discountText: '',
    imageUrl: '',
    validUntil: '',
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: coupons, isLoading } = useQuery<ShopeeCoupon[]>({
    queryKey: ['shopee-coupons'],
    queryFn: () => clientFetch<ShopeeCoupon[]>('/sources/SHOPEE/coupons'),
  });

  const { data: channels } = useQuery<ChannelDTO[]>({
    queryKey: ['channels'],
    queryFn: () => clientFetch<ChannelDTO[]>('/channels'),
  });

  const [selectedChannelByCoupon, setSelectedChannelByCoupon] = useState<Record<string, string>>({});

  const dispatchAlert = useMutation<unknown, Error, { id: string; channelId: string }>({
    mutationFn: ({ id, channelId }) =>
      clientFetch(`/sources/SHOPEE/coupons/${id}/dispatch`, {
        method: 'POST',
        body: { channelId },
      }),
    onSuccess: () => setErrorMsg('✅ Alerta de cupom enviado pro grupo'),
    onError: (err) => setErrorMsg(err.message),
  });

  const create = useMutation<ShopeeCoupon>({
    mutationFn: () =>
      clientFetch<ShopeeCoupon>('/sources/SHOPEE/coupons', {
        method: 'POST',
        body: {
          code: form.code || undefined,
          description: form.description || undefined,
          type: form.type,
          value: form.value,
          minPurchase: form.minPurchase > 0 ? form.minPurchase : undefined,
          maxDiscount: form.maxDiscount > 0 ? form.maxDiscount : undefined,
          seller: form.seller || undefined,
          discountText: form.discountText || undefined,
          imageUrl: form.imageUrl || undefined,
          validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopee-coupons'] });
      setForm({ code: '', description: '', type: 'PERCENT', value: 0, minPurchase: 0, maxDiscount: 0, seller: '', discountText: '', imageUrl: '', validUntil: '' });
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

  const couponPageLink = useMutation<{ shortLink: string }>({
    mutationFn: () =>
      clientFetch<{ shortLink: string }>('/sources/SHOPEE/coupon-page-shortlink', {
        method: 'POST',
        body: { subIds: [] },
      }),
    onSuccess: (data) => {
      navigator.clipboard.writeText(data.shortLink);
      setErrorMsg(`✅ Copiado: ${data.shortLink} — divulgue no grupo. Qualquer cupom usado = comissão pra você.`);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  // Gerador genérico de shortlink — pega qualquer URL Shopee
  const [shortLinkInput, setShortLinkInput] = useState('');
  const genericShortLink = useMutation<{ shortLink: string }, Error, string>({
    mutationFn: (originUrl) =>
      clientFetch<{ shortLink: string }>('/sources/SHOPEE/short-link', {
        method: 'POST',
        body: { originUrl },
      }),
    onSuccess: (data) => {
      navigator.clipboard.writeText(data.shortLink);
      setErrorMsg(`✅ Copiado: ${data.shortLink}`);
      setShortLinkInput('');
    },
    onError: (err) => setErrorMsg(err.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cupons Shopee"
        description='Open API Shopee NÃO expõe cupons. Cole aqui códigos que recebe via App/Email/Portal afiliado. Quando seller bater com produto Shopee, código vai automático no caption do WhatsApp. Sem seller = "cupom de plataforma" (aplica em qualquer produto Shopee sem cupom específico).'
        actions={
          <Button
            onClick={() => couponPageLink.mutate()}
            disabled={couponPageLink.isPending}
            variant="outline"
          >
            {couponPageLink.isPending ? 'Gerando...' : '🎁 Copiar link da página de cupons'}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">🔗 Gerador de shortlink Shopee</CardTitle>
          <CardDescription>
            Cola qualquer URL Shopee (página de cupom, promo, produto, coleção) e gera shortlink já tageado com seu affiliate ID. Equivale ao "criador de links" do painel oficial.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="https://shopee.com.br/m/promocao-magica"
              value={shortLinkInput}
              onChange={(e) => setShortLinkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && shortLinkInput.trim()) {
                  genericShortLink.mutate(shortLinkInput.trim());
                }
              }}
            />
            <Button
              onClick={() => genericShortLink.mutate(shortLinkInput.trim())}
              disabled={genericShortLink.isPending || !shortLinkInput.trim()}
            >
              {genericShortLink.isPending ? 'Gerando...' : 'Gerar e copiar'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4 text-primary" />
            Cadastrar cupom
          </CardTitle>
          <CardDescription>
            Sistema calcula preço final aplicando o cupom (igual DivulgaLinks).
            Code vazio = cupom automático no checkout (sem código pra digitar).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Code (vazio = automático)</Label>
              <Input
                placeholder="OLH4CUP0M5AFF"
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s/g, '') })
                }
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label>Tipo</Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as 'PERCENT' | 'FIXED' })
                }
              >
                <option value="PERCENT">Percentual (%)</option>
                <option value="FIXED">Valor fixo (R$)</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>
                Valor {form.type === 'PERCENT' ? '(%)' : '(R$)'}
              </Label>
              <Input
                type="number"
                min={0}
                step={form.type === 'PERCENT' ? '1' : '0.01'}
                placeholder={form.type === 'PERCENT' ? '25' : '35.00'}
                value={form.value}
                onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
              />
              <p className="text-[10px] text-muted-foreground">
                {form.type === 'PERCENT' ? 'Ex: 25 = 25% off' : 'Ex: 35 = R$35 off'}
              </p>
            </div>
            <div className="space-y-1">
              <Label>Compra mínima (R$)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="0 = sem mínimo"
                value={form.minPurchase}
                onChange={(e) => setForm({ ...form, minPurchase: Number(e.target.value) })}
              />
              <p className="text-[10px] text-muted-foreground">Cupom só vale se preço {`>=`} mínimo.</p>
            </div>
            <div className="space-y-1">
              <Label>Desconto máx (R$)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="0 = sem teto"
                value={form.maxDiscount}
                onChange={(e) => setForm({ ...form, maxDiscount: Number(e.target.value) })}
              />
              <p className="text-[10px] text-muted-foreground">
                Cap só pra cupom %. Ex: 25% mas máx R$10.
              </p>
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
                placeholder="Ex: 25% off em moda feminina"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>📷 URL da imagem (opcional — banner/arte do cupom)</Label>
              <Input
                type="url"
                placeholder="https://..."
                value={form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              />
              {form.imageUrl ? (
                <div className="mt-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.imageUrl}
                    alt="Preview"
                    className="h-32 rounded-md border object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || form.value <= 0}
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
                    {c.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.imageUrl}
                        alt=""
                        className="size-16 rounded-md border object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : null}
                    <div className="space-y-1 flex-1 min-w-0">
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
                    <div className="flex flex-wrap gap-2 items-center">
                      <select
                        className="rounded-md border bg-background px-2 py-1 text-xs"
                        value={selectedChannelByCoupon[c.id] ?? ''}
                        onChange={(e) =>
                          setSelectedChannelByCoupon((s) => ({ ...s, [c.id]: e.target.value }))
                        }
                      >
                        <option value="">Canal pra disparar...</option>
                        {(channels ?? []).map((ch) => (
                          <option key={ch.id} value={ch.id}>
                            {ch.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        onClick={() => {
                          const channelId = selectedChannelByCoupon[c.id];
                          if (!channelId) {
                            setErrorMsg('Selecione um canal antes');
                            return;
                          }
                          if (confirm(`Disparar alerta de cupom ${c.code} no canal?`)) {
                            dispatchAlert.mutate({ id: c.id, channelId });
                          }
                        }}
                        disabled={dispatchAlert.isPending}
                      >
                        🚨 Mandar
                      </Button>
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
