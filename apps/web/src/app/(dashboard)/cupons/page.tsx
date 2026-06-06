'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, ClipboardPaste, ShoppingBag, Sparkles, Save, Trash2 } from 'lucide-react';
import { clientFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';

type Tab = 'shopee' | 'amazon';

type ParsedItem = {
  action: 'create' | 'skip';
  reason?: string;
  title: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  minPurchase: number | null;
  maxDiscount: number | null;
  officialOnly: boolean;
  discountText: string;
  status: string;
};

type ParseResp = {
  parsed: ParsedItem[];
  summary: { total: number; toCreate?: number; toSkip?: number; created?: number; skipped?: number };
  created?: Array<{ id: string; discountText: string }>;
  skipped?: Array<{ title: string; reason: string }>;
};

type AmazonCouponSettings = {
  amazonCouponCode?: string;
  amazonCouponType?: 'PERCENT' | 'FIXED';
  amazonCouponValue?: number;
  amazonCouponMinPurchase?: number;
  amazonCouponMaxDiscount?: number;
  amazonCouponInstructionText?: string;
};

function todayEndOfDay(): string {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm pra <input datetime-local>
}

export default function CuponsPage(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('shopee');

  return (
    <div className="space-y-6">
      <PageHeader
        title="🎟️ Gerenciar cupons"
        description="Cole a página da Shopee pra cadastrar em massa, ou ajuste o cupom Amazon manual"
      />

      <div className="flex gap-2 border rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('shopee')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
            tab === 'shopee' ? 'bg-orange-500 text-white' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShoppingBag className="size-4" />
          🟠 Shopee (paste)
        </button>
        <button
          onClick={() => setTab('amazon')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
            tab === 'amazon' ? 'bg-amber-700 text-white' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Sparkles className="size-4" />
          🔵 Amazon (manual)
        </button>
      </div>

      {tab === 'shopee' ? (
        <>
          <ActiveCouponsList />
          <ShopeeParser />
        </>
      ) : (
        <AmazonForm />
      )}
    </div>
  );
}

function ShopeeParser(): React.ReactElement {
  const [rawText, setRawText] = useState('');
  const [validUntil, setValidUntil] = useState(todayEndOfDay());
  const [preview, setPreview] = useState<ParseResp | null>(null);
  // Set de índices selecionados (em preview.parsed). Default = todos com action='create'.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();

  const parseMut = useMutation({
    mutationFn: () =>
      clientFetch<ParseResp>('/sources/SHOPEE/coupons/parse-and-create', {
        method: 'POST',
        body: {
          rawText,
          validUntil: new Date(validUntil + ':00').toISOString(),
          dryRun: true,
        },
      }),
    onSuccess: (data) => {
      setPreview(data);
      // Default: pré-seleciona todos os ✅ (action=create)
      const defaultSel = new Set<number>();
      data.parsed.forEach((p, i) => { if (p.action === 'create') defaultSel.add(i); });
      setSelected(defaultSel);
    },
    onError: (err) => toast.error(`❌ ${(err as Error).message}`),
  });

  const createMut = useMutation({
    mutationFn: () => {
      const items = (preview?.parsed ?? [])
        .map((p, i) => ({ p, i }))
        .filter(({ i }) => selected.has(i))
        .map(({ p }) => ({
          title: p.title,
          type: p.type,
          value: p.value,
          minPurchase: p.minPurchase,
          maxDiscount: p.maxDiscount,
          discountText: p.discountText,
          officialOnly: p.officialOnly,
        }));
      return clientFetch<{ created: number; failed: number }>('/sources/SHOPEE/coupons/bulk-create', {
        method: 'POST',
        body: {
          validUntil: new Date(validUntil + ':00').toISOString(),
          items,
        },
      });
    },
    onSuccess: (data) => {
      toast.success(`✅ ${data.created} cupom(ns) cadastrado(s)${data.failed ? ` · ${data.failed} falharam` : ''}`);
      setPreview(null);
      setRawText('');
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['shopee-coupons-active'] });
    },
    onError: (err) => toast.error(`❌ ${(err as Error).message}`),
  });

  const toggle = (i: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardPaste className="size-5 text-orange-500" />
            1. Cole a página da Shopee aqui
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={10}
            className="font-mono text-xs"
            placeholder={`Cole o texto da página de cupons Shopee. Ex:

Lojas Oficiais

LOJAS OFICIAIS
20% DE CASHBACK
Limitado a R$20
Oficial
Condições
Eu quero

TODAS AS LOJAS
R$30 OFF
Nas compras acima de R$299
Condições
Eu quero
...`}
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Validade dos cupons</Label>
              <Input
                type="datetime-local"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-[220px]"
              />
            </div>
            <Button
              onClick={() => parseMut.mutate()}
              disabled={rawText.trim().length < 20 || parseMut.isPending}
              variant="outline"
            >
              {parseMut.isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
              Analisar
            </Button>
            {preview && selected.size > 0 ? (
              <Button
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {createMut.isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
                Cadastrar {selected.size} selecionado(s)
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>
              2. Preview — {selected.size} de {preview.parsed.length} selecionados
            </CardTitle>
            <div className="text-xs text-muted-foreground mt-1">
              Marca/desmarca pra escolher quais cadastrar. Padrão: todos os ✅ marcados, ⚠️ desmarcados (mas pode forçar marcando)
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {preview.parsed.map((p, i) => {
                const isSel = selected.has(i);
                return (
                  <label
                    key={i}
                    className={`flex items-start gap-3 rounded border p-3 text-sm cursor-pointer transition ${
                      isSel
                        ? 'border-emerald-300 bg-emerald-50/60'
                        : p.action === 'skip'
                          ? 'border-zinc-200 bg-zinc-50/40 opacity-60'
                          : 'border-zinc-200 bg-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(i)}
                      className="mt-1 size-4 accent-emerald-600 shrink-0"
                    />
                    <span className="text-lg shrink-0">{p.action === 'create' ? '✅' : '⚠️'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{p.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.type === 'PERCENT' ? `${p.value}% OFF` : `R$ ${p.value} OFF`}
                        {p.minPurchase ? ` · min R$ ${p.minPurchase}` : ''}
                        {p.maxDiscount ? ` · max R$ ${p.maxDiscount}` : ''}
                        {p.officialOnly ? ' · só Mall' : ''}
                      </div>
                      {p.action === 'skip' ? (
                        <div className="text-xs text-amber-700 mt-1">⚠️ {p.reason}</div>
                      ) : null}
                    </div>
                    <Badge variant={p.status === 'Eu quero' ? 'success' : 'secondary'}>{p.status}</Badge>
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

type ActiveCoupon = {
  id: string;
  code: string | null;
  type: 'PERCENT' | 'FIXED';
  value: number;
  minPurchase: number | null;
  maxDiscount: number | null;
  discountText: string | null;
  officialOnly: boolean;
  enabled: boolean;
  validUntil: string | null;
};

function ActiveCouponsList(): React.ReactElement {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<ActiveCoupon[]>({
    queryKey: ['shopee-coupons-active'],
    queryFn: () => clientFetch<ActiveCoupon[]>('/sources/SHOPEE/coupons'),
  });

  const disableMut = useMutation({
    mutationFn: (id: string) =>
      clientFetch(`/sources/SHOPEE/coupons/${id}`, {
        method: 'PATCH',
        body: { enabled: false },
      }),
    onSuccess: () => {
      toast.success('✅ Cupom desativado');
      queryClient.invalidateQueries({ queryKey: ['shopee-coupons-active'] });
    },
    onError: (err) => toast.error(`❌ ${(err as Error).message}`),
  });

  const now = new Date();
  const ativos = (data ?? []).filter(
    (c) => c.enabled && (!c.validUntil || new Date(c.validUntil) > now),
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  if (ativos.length === 0) return <></>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">🎟️ Cupons Shopee ativos agora ({ativos.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {ativos
            .sort((a, b) => (a.value || 0) - (b.value || 0))
            .map((c) => {
              const expSoon = c.validUntil
                ? new Date(c.validUntil).getTime() - now.getTime() < 3 * 3600 * 1000
                : false;
              const expStr = c.validUntil
                ? new Date(c.validUntil).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                : 'sem validade';
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded border bg-white px-3 py-2 text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-xs bg-zinc-100 px-1.5 py-0.5 rounded mr-2">
                      {c.code ?? '(auto)'}
                    </span>
                    <span className="font-semibold">
                      {c.type === 'PERCENT' ? `${c.value}% OFF` : `R$ ${c.value} OFF`}
                    </span>
                    {c.maxDiscount ? <span className="text-xs text-muted-foreground"> (max R$ {c.maxDiscount})</span> : null}
                    {c.minPurchase ? <span className="text-xs text-muted-foreground"> · min R$ {c.minPurchase}</span> : null}
                    {c.officialOnly ? <span className="ml-2 text-[10px] uppercase font-bold text-amber-700">Mall</span> : null}
                  </div>
                  <span className={`text-xs ${expSoon ? 'text-rose-600 font-semibold' : 'text-muted-foreground'}`}>
                    exp {expStr}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => disableMut.mutate(c.id)}
                    disabled={disableMut.isPending}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              );
            })}
        </div>
      </CardContent>
    </Card>
  );
}

function AmazonForm(): React.ReactElement {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery<{ marketplaces: AmazonCouponSettings }>({
    queryKey: ['settings-mkt'],
    queryFn: () => clientFetch<{ marketplaces: AmazonCouponSettings }>('/settings'),
  });

  const mkt = settings?.marketplaces;

  const [code, setCode] = useState('');
  const [type, setType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [value, setValue] = useState('');
  const [minPurchase, setMinPurchase] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [instructionText, setInstructionText] = useState('');

  // Sync form com settings (uma vez quando carrega)
  useState(() => {
    if (mkt && !code) {
      setCode(mkt.amazonCouponCode ?? '');
      setType(mkt.amazonCouponType ?? 'PERCENT');
      setValue(String(mkt.amazonCouponValue ?? ''));
      setMinPurchase(String(mkt.amazonCouponMinPurchase ?? ''));
      setMaxDiscount(String(mkt.amazonCouponMaxDiscount ?? ''));
      setInstructionText(mkt.amazonCouponInstructionText ?? '');
    }
  });

  const saveMut = useMutation({
    mutationFn: () =>
      clientFetch<AmazonCouponSettings>('/settings/marketplaces', {
        method: 'PATCH',
        body: {
          amazonCouponCode: code.trim().toUpperCase() || '',
          amazonCouponType: type,
          amazonCouponValue: Number(value) || 0,
          amazonCouponMinPurchase: Number(minPurchase) || 0,
          amazonCouponMaxDiscount: Number(maxDiscount) || 0,
          amazonCouponInstructionText: instructionText.trim(),
        },
      }),
    onSuccess: () => {
      toast.success('✅ Cupom Amazon atualizado');
      queryClient.invalidateQueries({ queryKey: ['settings-mkt'] });
    },
    onError: (err) => toast.error(`❌ ${(err as Error).message}`),
  });

  const clearMut = useMutation({
    mutationFn: () =>
      clientFetch<AmazonCouponSettings>('/settings/marketplaces', {
        method: 'PATCH',
        body: {
          amazonCouponCode: '',
          amazonCouponValue: 0,
          amazonCouponMinPurchase: 0,
          amazonCouponMaxDiscount: 0,
          amazonCouponInstructionText: '',
        },
      }),
    onSuccess: () => {
      toast.success('✅ Cupom Amazon removido');
      setCode(''); setValue(''); setMinPurchase(''); setMaxDiscount(''); setInstructionText('');
      queryClient.invalidateQueries({ queryKey: ['settings-mkt'] });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  const hasActiveCoupon = mkt?.amazonCouponCode && (mkt?.amazonCouponValue ?? 0) > 0;

  return (
    <div className="space-y-4">
      {hasActiveCoupon ? (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <div className="grid size-10 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                🎟️
              </div>
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wide text-emerald-700 font-bold">Cupom ativo</div>
                <div className="text-lg font-semibold">
                  {mkt!.amazonCouponCode} · {mkt!.amazonCouponType === 'PERCENT' ? `${mkt!.amazonCouponValue}% OFF` : `R$ ${mkt!.amazonCouponValue} OFF`}
                  {mkt!.amazonCouponMaxDiscount ? ` (max R$ ${mkt!.amazonCouponMaxDiscount})` : ''}
                </div>
                <div className="text-sm text-muted-foreground">
                  Min compra: R$ {mkt!.amazonCouponMinPurchase ?? 0}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {hasActiveCoupon ? 'Editar cupom Amazon' : 'Cadastrar cupom Amazon'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Código <span className="text-destructive">*</span></Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="MUNDIAL"
                className="font-mono uppercase"
              />
              <div className="text-xs text-muted-foreground">Vai aparecer em todas mensagens Amazon que atingirem o mínimo</div>
            </div>

            <div className="space-y-1">
              <Label>Tipo de desconto</Label>
              <Select value={type} onChange={(e) => setType(e.target.value as 'PERCENT' | 'FIXED')}>
                <option value="PERCENT">% Porcentagem</option>
                <option value="FIXED">R$ Fixo</option>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Valor do desconto <span className="text-destructive">*</span></Label>
              <Input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={type === 'PERCENT' ? '10' : '20'}
                min="0"
                step="0.01"
              />
              <div className="text-xs text-muted-foreground">{type === 'PERCENT' ? 'Ex: 10 = 10% OFF' : 'Ex: 20 = R$ 20 OFF'}</div>
            </div>

            <div className="space-y-1">
              <Label>Compra mínima (R$)</Label>
              <Input
                type="number"
                value={minPurchase}
                onChange={(e) => setMinPurchase(e.target.value)}
                placeholder="200"
                min="0"
              />
              <div className="text-xs text-muted-foreground">Produto abaixo disso não recebe o cupom na mensagem</div>
            </div>

            {type === 'PERCENT' ? (
              <div className="space-y-1">
                <Label>Até qual valor de desconto (R$)</Label>
                <Input
                  type="number"
                  value={maxDiscount}
                  onChange={(e) => setMaxDiscount(e.target.value)}
                  placeholder="50"
                  min="0"
                />
                <div className="text-xs text-muted-foreground">Ex: cap de R$ 50 em 10% — produto de R$ 1000 desconta só R$ 50</div>
              </div>
            ) : null}

            <div className="space-y-1 md:col-span-2">
              <Label>Texto da chamada (opcional)</Label>
              <Input
                value={instructionText}
                onChange={(e) => setInstructionText(e.target.value)}
                placeholder="| Para 10% OFF!"
              />
              <div className="text-xs text-muted-foreground">
                Aparece depois do código. Ex: "Use o cupom <strong>MUNDIAL</strong> | Para 10% OFF!"
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t">
            <Button
              onClick={() => saveMut.mutate()}
              disabled={!code.trim() || !value || saveMut.isPending}
              className="bg-amber-700 hover:bg-amber-800"
            >
              {saveMut.isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : <Save className="size-4 mr-1" />}
              Salvar cupom
            </Button>
            {hasActiveCoupon ? (
              <Button
                onClick={() => clearMut.mutate()}
                variant="outline"
                className="text-destructive"
                disabled={clearMut.isPending}
              >
                <Trash2 className="size-4 mr-1" />
                Remover cupom atual
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
