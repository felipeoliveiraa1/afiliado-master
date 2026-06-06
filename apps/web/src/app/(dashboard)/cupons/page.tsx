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

      {tab === 'shopee' ? <ShopeeParser /> : <AmazonForm />}
    </div>
  );
}

function ShopeeParser(): React.ReactElement {
  const [rawText, setRawText] = useState('');
  const [validUntil, setValidUntil] = useState(todayEndOfDay());
  const [preview, setPreview] = useState<ParseResp | null>(null);
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
    onSuccess: (data) => setPreview(data),
    onError: (err) => toast.error(`❌ ${(err as Error).message}`),
  });

  const createMut = useMutation({
    mutationFn: () =>
      clientFetch<ParseResp>('/sources/SHOPEE/coupons/parse-and-create', {
        method: 'POST',
        body: {
          rawText,
          validUntil: new Date(validUntil + ':00').toISOString(),
          dryRun: false,
        },
      }),
    onSuccess: (data) => {
      const c = data.summary.created ?? 0;
      const s = data.summary.skipped ?? 0;
      toast.success(`✅ ${c} cupom(ns) cadastrado(s) · ${s} pulado(s)`);
      setPreview(null);
      setRawText('');
      queryClient.invalidateQueries({ queryKey: ['shopee-coupons'] });
    },
    onError: (err) => toast.error(`❌ ${(err as Error).message}`),
  });

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
            {preview && preview.summary.toCreate && preview.summary.toCreate > 0 ? (
              <Button
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {createMut.isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
                Cadastrar {preview.summary.toCreate} cupom(ns)
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>
              2. Preview ({preview.summary.toCreate ?? preview.summary.created ?? 0} cadastrar · {preview.summary.toSkip ?? preview.summary.skipped ?? 0} pular)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {preview.parsed.map((p, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 rounded border p-3 text-sm ${
                    p.action === 'create' ? 'border-emerald-200 bg-emerald-50/40' : 'border-zinc-200 bg-zinc-50/40'
                  }`}
                >
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
                    ) : (
                      <div className="text-xs text-emerald-700 mt-1">→ vai cadastrar como auto-cupom</div>
                    )}
                  </div>
                  <Badge variant={p.status === 'Eu quero' ? 'success' : 'secondary'}>{p.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
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
