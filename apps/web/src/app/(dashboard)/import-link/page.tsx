'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Send, ExternalLink } from 'lucide-react';
import { clientFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

type PreviewProduct = {
  externalId: string;
  title: string;
  imageUrl?: string;
  price: number;
  originalPrice?: number;
  discountPct?: number;
  rating?: number;
  ratingCount?: number;
  salesCount?: number;
  affiliateUrl?: string;
  url: string;
  source: 'graphql' | 'apify';
};

type PreviewResp = {
  ok: boolean;
  error?: string;
  product?: PreviewProduct;
  bestCoupon?: { code: string; discount: number; finalPrice: number };
  allCoupons?: Array<{ code: string; description: string }>;
};

type DispatchResp = {
  ok: boolean;
  error?: string;
  offer?: { id: string; title: string; price: number; couponApplied: string | null };
  campaignName?: string;
  dispatchIds?: string[];
};

export default function ImportLinkPage(): React.ReactElement {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [couponOverride, setCouponOverride] = useState<string | undefined>(undefined);
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
      setResultMsg({ kind: 'err', text: `❌ Erro: ${(err as Error).message}` });
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
        setResultMsg({
          kind: 'ok',
          text: `✅ Enviado no grupo "${data.campaignName}"${cupom}!`,
        });
        setUrl('');
        setPreview(null);
        setCouponOverride(undefined);
        setTimeout(() => setResultMsg(null), 10000);
      } else {
        setResultMsg({ kind: 'err', text: `❌ ${data.error}` });
      }
    },
    onError: (err) => {
      setResultMsg({ kind: 'err', text: `❌ Erro: ${(err as Error).message}` });
    },
  });

  const selectedCoupon =
    couponOverride !== undefined ? couponOverride : (preview?.bestCoupon?.code ?? '');

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        title="Enviar Link Agora"
        description="Cole um link do Shopee — sistema puxa foto, preço e cupom automaticamente, e envia no grupo Promo Helena"
      />

      <Card>
        <CardHeader>
          <CardTitle>1. Cole o link do produto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="https://shopee.com.br/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 text-base"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && url && !previewMut.isPending) previewMut.mutate(url);
              }}
            />
            <Button
              onClick={() => previewMut.mutate(url)}
              disabled={!url || previewMut.isPending}
              size="lg"
            >
              {previewMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Buscar Produto'
              )}
            </Button>
          </div>
          {preview && !preview.ok && (
            <p className="text-destructive text-sm">❌ {preview.error}</p>
          )}
        </CardContent>
      </Card>

      {preview?.ok && preview.product ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Confirme e envie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex gap-4">
              {preview.product.imageUrl ? (
                <img
                  src={preview.product.imageUrl}
                  alt={preview.product.title}
                  className="w-40 h-40 object-cover rounded border"
                />
              ) : (
                <div className="w-40 h-40 rounded border bg-muted grid place-items-center text-xs text-muted-foreground">
                  sem imagem
                </div>
              )}
              <div className="flex-1 space-y-1">
                <h3 className="font-semibold leading-tight">{preview.product.title}</h3>
                <div className="text-2xl font-bold text-emerald-600">
                  R$ {preview.product.price.toFixed(2)}
                </div>
                {preview.product.originalPrice && (
                  <div className="text-sm text-muted-foreground line-through">
                    De R$ {preview.product.originalPrice.toFixed(2)}
                  </div>
                )}
                {preview.product.discountPct ? (
                  <div className="text-sm text-destructive font-medium">
                    -{preview.product.discountPct.toFixed(0)}% OFF
                  </div>
                ) : null}
                {preview.product.rating ? (
                  <div className="text-sm text-yellow-600">
                    ★ {preview.product.rating.toFixed(1)}
                    {preview.product.salesCount
                      ? ` (${preview.product.salesCount} vendidos)`
                      : ''}
                  </div>
                ) : null}
                {preview.bestCoupon ? (
                  <div className="text-sm text-emerald-700 font-medium">
                    🎟️ Cupom {preview.bestCoupon.code}: -R$ {preview.bestCoupon.discount.toFixed(2)} → R${' '}
                    {preview.bestCoupon.finalPrice.toFixed(2)}
                  </div>
                ) : null}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">
                    Dados via {preview.product.source === 'graphql' ? 'API Shopee' : 'Apify scraper'}
                  </span>
                  <a
                    href={preview.product.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent hover:underline inline-flex items-center gap-1"
                  >
                    ver no Shopee <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>

            {preview.allCoupons && preview.allCoupons.length > 0 ? (
              <div>
                <label className="block text-sm font-medium mb-1">Cupom Shopee</label>
                <select
                  value={selectedCoupon}
                  onChange={(e) => setCouponOverride(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                >
                  <option value="">— sem cupom —</option>
                  {preview.allCoupons.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                      {c.description ? ` — ${c.description}` : ''}
                      {preview.bestCoupon?.code === c.code ? ' ✓ (melhor)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <Button
              size="xl"
              className="w-full"
              disabled={dispatchMut.isPending}
              onClick={() => dispatchMut.mutate()}
            >
              {dispatchMut.isPending ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="h-5 w-5 mr-2" />
                  Enviar Agora no Grupo Promo Helena
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {resultMsg ? (
        <div
          className={`p-4 rounded font-medium ${
            resultMsg.kind === 'ok'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-destructive/10 text-destructive border border-destructive/20'
          }`}
        >
          {resultMsg.text}
        </div>
      ) : null}
    </div>
  );
}
