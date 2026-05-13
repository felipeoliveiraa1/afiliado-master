'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Send, ExternalLink, Store, Package } from 'lucide-react';
import { clientFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

type PreviewProduct = {
  externalId: string;
  shopId?: string;
  title: string;
  imageUrl?: string;
  price: number;
  originalPrice?: number;
  discountPct?: number;
  rating?: number;
  salesCount?: number;
  url: string;
  affiliateUrl?: string;
  source?: 'graphql' | 'apify';
};

type PreviewResp = {
  ok: boolean;
  error?: string;
  product?: PreviewProduct;
  bestCoupon?: { code: string; discount: number; finalPrice: number };
  allCoupons?: Array<{ code: string; description: string }>;
};

type ShopPreviewResp = {
  ok: boolean;
  error?: string;
  count?: number;
  products?: PreviewProduct[];
  estimatedCostUsd?: number;
  cached?: boolean;
  allCoupons?: Array<{ code: string; description: string }>;
};

type DispatchResp = {
  ok: boolean;
  error?: string;
  offer?: { id: string; title: string; price: number; couponApplied: string | null };
  campaignName?: string;
};

type ShopDispatchResp = {
  ok: boolean;
  error?: string;
  scheduled?: number;
  failed?: number;
  intervalSec?: number;
  totalSpanSec?: number;
  campaignName?: string;
};

type Mode = 'product' | 'shop';

export default function ImportLinkPage(): React.ReactElement {
  const [mode, setMode] = useState<Mode>('product');
  const [url, setUrl] = useState('');

  // Produto único
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [couponOverride, setCouponOverride] = useState<string | undefined>(undefined);

  // Loja
  const [shopPreview, setShopPreview] = useState<ShopPreviewResp | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [intervalSec, setIntervalSec] = useState(180);
  const [shopCoupon, setShopCoupon] = useState<string | undefined>(undefined);

  const [resultMsg, setResultMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const previewMut = useMutation({
    mutationFn: (u: string) =>
      clientFetch<PreviewResp>('/import-link/preview', { method: 'POST', body: { url: u } }),
    onSuccess: (data) => {
      setPreview(data);
      setCouponOverride(undefined);
      setResultMsg(null);
    },
    onError: (err) => {
      setPreview(null);
      setResultMsg({ kind: 'err', text: `❌ ${(err as Error).message}` });
    },
  });

  const dispatchMut = useMutation({
    mutationFn: () =>
      clientFetch<DispatchResp>('/import-link/dispatch', {
        method: 'POST',
        body: { url, couponOverride },
      }),
    onSuccess: (data) => {
      if (data.ok) {
        const cupom = data.offer?.couponApplied ? ` (cupom ${data.offer.couponApplied})` : '';
        setResultMsg({ kind: 'ok', text: `✅ Enviado em "${data.campaignName}"${cupom}!` });
        setUrl(''); setPreview(null); setCouponOverride(undefined);
        setTimeout(() => setResultMsg(null), 10000);
      } else {
        setResultMsg({ kind: 'err', text: `❌ ${data.error}` });
      }
    },
    onError: (err) => setResultMsg({ kind: 'err', text: `❌ ${(err as Error).message}` }),
  });

  const [shopMaxItems, setShopMaxItems] = useState(20);
  const shopPreviewMut = useMutation({
    mutationFn: (shop: string) =>
      clientFetch<ShopPreviewResp>('/import-shop/preview', {
        method: 'POST',
        body: { shop, maxItems: shopMaxItems },
      }),
    onSuccess: (data) => {
      setShopPreview(data);
      setSelected(new Set());
      setShopCoupon(undefined);
      setResultMsg(null);
    },
    onError: (err) => {
      setShopPreview(null);
      setResultMsg({ kind: 'err', text: `❌ ${(err as Error).message}` });
    },
  });

  const shopDispatchMut = useMutation({
    mutationFn: () => {
      const products = (shopPreview?.products ?? []).filter((p) => selected.has(p.externalId));
      return clientFetch<ShopDispatchResp>('/import-shop/dispatch', {
        method: 'POST',
        body: {
          products: products.map((p) => ({
            externalId: p.externalId,
            shopId: p.shopId,
            title: p.title,
            imageUrl: p.imageUrl,
            price: p.price,
            originalPrice: p.originalPrice,
            discountPct: p.discountPct,
            rating: p.rating,
            salesCount: p.salesCount,
            url: p.url,
          })),
          intervalSec,
          couponOverride: shopCoupon,
        },
      });
    },
    onSuccess: (data) => {
      if (data.ok) {
        const totalMin = Math.ceil((data.totalSpanSec ?? 0) / 60);
        setResultMsg({
          kind: 'ok',
          text: `✅ ${data.scheduled} produtos agendados em "${data.campaignName}" (1 a cada ${data.intervalSec}s — total ~${totalMin}min)`,
        });
        setShopPreview(null); setSelected(new Set()); setUrl('');
        setTimeout(() => setResultMsg(null), 12000);
      } else {
        setResultMsg({ kind: 'err', text: `❌ ${data.error}` });
      }
    },
    onError: (err) => setResultMsg({ kind: 'err', text: `❌ ${(err as Error).message}` }),
  });

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === (shopPreview?.products?.length ?? 0)) {
      setSelected(new Set());
    } else {
      setSelected(new Set((shopPreview?.products ?? []).map((p) => p.externalId)));
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Enviar Link Agora"
        description="Cole um link Shopee — produto único ou loja inteira — e envie pro grupo na hora"
      />

      <div className="flex gap-2 border rounded-lg p-1 w-fit">
        <button
          onClick={() => { setMode('product'); setShopPreview(null); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
            mode === 'product' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Package className="h-4 w-4" />
          Produto único
        </button>
        <button
          onClick={() => { setMode('shop'); setPreview(null); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
            mode === 'shop' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Store className="h-4 w-4" />
          Loja inteira
        </button>
      </div>

      {mode === 'product' ? (
        <>
          <Card>
            <CardHeader><CardTitle>1. Cole o link do produto</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="https://shopee.com.br/..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1 text-base"
                  onKeyDown={(e) => { if (e.key === 'Enter' && url && !previewMut.isPending) previewMut.mutate(url); }}
                />
                <Button onClick={() => previewMut.mutate(url)} disabled={!url || previewMut.isPending} size="lg">
                  {previewMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Buscar'}
                </Button>
              </div>
              {preview && !preview.ok && <p className="text-destructive text-sm">❌ {preview.error}</p>}
            </CardContent>
          </Card>

          {preview?.ok && preview.product ? (
            <Card>
              <CardHeader><CardTitle>2. Confirme e envie</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div className="flex gap-4">
                  {preview.product.imageUrl ? (
                    <img src={preview.product.imageUrl} alt={preview.product.title} className="w-40 h-40 object-cover rounded border" />
                  ) : (
                    <div className="w-40 h-40 rounded border bg-muted grid place-items-center text-xs text-muted-foreground">sem imagem</div>
                  )}
                  <div className="flex-1 space-y-1">
                    <h3 className="font-semibold leading-tight">{preview.product.title}</h3>
                    <div className="text-2xl font-bold text-emerald-600">R$ {preview.product.price.toFixed(2)}</div>
                    {preview.product.originalPrice ? (
                      <div className="text-sm text-muted-foreground line-through">De R$ {preview.product.originalPrice.toFixed(2)}</div>
                    ) : null}
                    {preview.product.discountPct ? (
                      <div className="text-sm text-destructive font-medium">-{preview.product.discountPct.toFixed(0)}% OFF</div>
                    ) : null}
                    {preview.product.rating ? (
                      <div className="text-sm text-yellow-600">★ {preview.product.rating.toFixed(1)}{preview.product.salesCount ? ` (${preview.product.salesCount} vendidos)` : ''}</div>
                    ) : null}
                    {preview.bestCoupon ? (
                      <div className="text-sm text-emerald-700 font-medium">
                        🎟️ Cupom {preview.bestCoupon.code}: -R$ {preview.bestCoupon.discount.toFixed(2)} → R$ {preview.bestCoupon.finalPrice.toFixed(2)}
                      </div>
                    ) : null}
                    <a href={preview.product.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline inline-flex items-center gap-1 pt-1">
                      ver no Shopee <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>

                {preview.allCoupons && preview.allCoupons.length > 0 ? (
                  <div>
                    <label className="block text-sm font-medium mb-1">Cupom Shopee</label>
                    <select
                      value={couponOverride ?? preview.bestCoupon?.code ?? ''}
                      onChange={(e) => setCouponOverride(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm bg-background"
                    >
                      <option value="">— sem cupom —</option>
                      {preview.allCoupons.map((c) => (
                        <option key={c.code} value={c.code}>{c.code}{c.description ? ` — ${c.description}` : ''}{preview.bestCoupon?.code === c.code ? ' ✓' : ''}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <Button size="xl" className="w-full" disabled={dispatchMut.isPending} onClick={() => dispatchMut.mutate()}>
                  {dispatchMut.isPending ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />Enviando...</> : <><Send className="h-5 w-5 mr-2" />Enviar Agora</>}
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>1. Cole o link da loja (ou só o nome de usuário)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="https://shopee.com.br/sobodybaby  ou  sobodybaby"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1 text-base"
                  onKeyDown={(e) => { if (e.key === 'Enter' && url && !shopPreviewMut.isPending) shopPreviewMut.mutate(url); }}
                />
                <Button onClick={() => shopPreviewMut.mutate(url)} disabled={!url || shopPreviewMut.isPending} size="lg">
                  {shopPreviewMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Listar Produtos'}
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-muted-foreground">Quantos puxar?</label>
                <select
                  value={shopMaxItems}
                  onChange={(e) => setShopMaxItems(Number(e.target.value))}
                  className="border rounded px-2 py-1 text-sm bg-background"
                >
                  <option value={10}>10 (~$0.35)</option>
                  <option value={20}>20 (~$0.50) — recomendado</option>
                  <option value={30}>30 (~$0.65)</option>
                  <option value={50}>50 (~$0.95)</option>
                </select>
                <span className="text-xs text-muted-foreground">
                  Estimativa Apify (cache 1h re-lista grátis)
                </span>
              </div>
              {shopPreview && !shopPreview.ok && <p className="text-destructive text-sm">❌ {shopPreview.error}</p>}
              {shopPreview?.ok && shopPreview.estimatedCostUsd != null ? (
                <p className="text-xs text-muted-foreground">
                  💰 Custo {shopPreview.cached ? '(cache, grátis)' : `~$${shopPreview.estimatedCostUsd.toFixed(2)} Apify`}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {shopPreview?.ok && shopPreview.products && shopPreview.products.length > 0 ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>2. Selecione os produtos ({selected.size}/{shopPreview.count})</CardTitle>
                  <Button size="sm" variant="outline" onClick={toggleAll}>
                    {selected.size === shopPreview.products.length ? 'Desmarcar todos' : 'Marcar todos'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto">
                  {shopPreview.products.map((p) => {
                    const isSelected = selected.has(p.externalId);
                    return (
                      <label
                        key={p.externalId}
                        className={`flex gap-3 p-3 rounded border cursor-pointer transition ${
                          isSelected ? 'bg-accent-soft border-accent' : 'hover:bg-muted/30'
                        }`}
                      >
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(p.externalId)} className="mt-1" />
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" className="w-16 h-16 object-cover rounded shrink-0" />
                        ) : (
                          <div className="w-16 h-16 rounded bg-muted shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate" title={p.title}>{p.title}</div>
                          <div className="text-lg font-bold text-emerald-600">R$ {p.price.toFixed(2)}</div>
                          {p.originalPrice ? <div className="text-[10px] text-muted-foreground line-through">R$ {p.originalPrice.toFixed(2)}</div> : null}
                          {p.discountPct ? <div className="text-[10px] text-destructive font-medium">-{p.discountPct.toFixed(0)}%</div> : null}
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t">
                  <div>
                    <label className="block text-sm font-medium mb-1">Intervalo entre envios</label>
                    <select value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))} className="w-full border rounded px-3 py-2 text-sm bg-background">
                      <option value={120}>2 minutos</option>
                      <option value={180}>3 minutos (recomendado)</option>
                      <option value={240}>4 minutos</option>
                      <option value={300}>5 minutos</option>
                      <option value={600}>10 minutos</option>
                    </select>
                  </div>
                  {shopPreview.allCoupons && shopPreview.allCoupons.length > 0 ? (
                    <div>
                      <label className="block text-sm font-medium mb-1">Cupom Shopee (todos)</label>
                      <select value={shopCoupon ?? ''} onChange={(e) => setShopCoupon(e.target.value)} className="w-full border rounded px-3 py-2 text-sm bg-background">
                        <option value="">— escolher automático (melhor por produto) —</option>
                        {shopPreview.allCoupons.map((c) => (
                          <option key={c.code} value={c.code}>{c.code}{c.description ? ` — ${c.description}` : ''}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>

                {selected.size > 0 ? (
                  <div className="text-sm text-muted-foreground">
                    📊 {selected.size} produtos × {intervalSec}s = total ~{Math.ceil((selected.size * intervalSec) / 60)}min até último envio
                  </div>
                ) : null}

                <Button
                  size="xl"
                  className="w-full"
                  disabled={selected.size === 0 || shopDispatchMut.isPending}
                  onClick={() => shopDispatchMut.mutate()}
                >
                  {shopDispatchMut.isPending ? (
                    <><Loader2 className="h-5 w-5 animate-spin mr-2" />Agendando...</>
                  ) : (
                    <><Send className="h-5 w-5 mr-2" />Enviar {selected.size} produtos no Grupo Promo Helena</>
                  )}
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      {resultMsg ? (
        <div className={`p-4 rounded font-medium ${
          resultMsg.kind === 'ok'
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
            : 'bg-destructive/10 text-destructive border border-destructive/20'
        }`}>
          {resultMsg.text}
        </div>
      ) : null}
    </div>
  );
}
