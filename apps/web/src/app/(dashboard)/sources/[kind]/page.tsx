'use client';

import React, { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cookie, Download, ExternalLink, ImageOff, Inbox, Zap } from 'lucide-react';
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
import { SkeletonRows } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/page-header';
import { SourceBadge } from '@/components/source-badge';
import { formatDate } from '@/lib/utils';

type SourceKind = 'SHOPEE' | 'AMAZON' | 'MERCADOLIVRE';

type RecentOffer = {
  id: string;
  title: string;
  affiliateUrl: string | null;
  url: string;
  fetchedAt: string;
  imageUrl: string | null;
};

const COPY: Record<SourceKind, { title: string; subtitle: string; hasCookie: boolean; tip?: string }> = {
  SHOPEE: {
    title: 'Shopee',
    subtitle: 'Open API quando aprovada, fallback via cookie do painel.',
    hasCookie: true,
    tip: 'Endpoint GraphQL com assinatura SHA256. Em produção, prefira a Open API.',
  },
  AMAZON: {
    title: 'Amazon',
    subtitle: 'Captação via Apify. Link de afiliado montado com ?tag=.',
    hasCookie: false,
  },
  MERCADOLIVRE: {
    title: 'Mercado Livre',
    subtitle: 'API pública para descoberta + cookie do painel para conversão automática.',
    hasCookie: true,
  },
};

export default function SourcePage({ params }: { params: Promise<{ kind: string }> }): React.ReactElement {
  const { kind: rawKind } = use(params);
  const kind = rawKind.toUpperCase() as SourceKind;
  const copy = COPY[kind];
  const [limit, setLimit] = useState('30');
  const queryClient = useQueryClient();

  const offers = useQuery<RecentOffer[]>({
    queryKey: ['source-offers', kind],
    queryFn: () => clientFetch<RecentOffer[]>(`/offers?source=${kind}&take=10`),
  });

  const fetchMutation = useMutation({
    mutationFn: () =>
      clientFetch(`/sources/${kind}/fetch`, {
        method: 'POST',
        body: { limit: Number(limit) },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['source-offers', kind] }),
  });

  // Source.config — define o que o cron puxa por nicho/categoria/keyword
  type SourceData = {
    config?: {
      categoryIds?: string[];
      keywords?: string[];
      minDiscount?: number;
      limitPerCategory?: number;
      onlyMall?: boolean;
      onlyKeySellers?: boolean;
    };
  };
  const sourceQuery = useQuery<SourceData>({
    queryKey: ['source', kind],
    queryFn: () => clientFetch<SourceData>(`/sources/${kind}`),
  });

  const [cfgForm, setCfgForm] = useState({
    categoryIdsCsv: '',
    keywordsCsv: '',
    minDiscount: 0,
    limitPerCategory: 10,
    onlyMall: false,
    onlyKeySellers: false,
  });

  // Hidrata form quando dados chegarem
  React.useEffect(() => {
    const c = sourceQuery.data?.config;
    if (!c) return;
    setCfgForm({
      categoryIdsCsv: (c.categoryIds ?? []).join(', '),
      keywordsCsv: (c.keywords ?? []).join(', '),
      minDiscount: c.minDiscount ?? 0,
      limitPerCategory: c.limitPerCategory ?? 10,
      onlyMall: c.onlyMall ?? false,
      onlyKeySellers: c.onlyKeySellers ?? false,
    });
  }, [sourceQuery.data?.config]);

  const saveConfig = useMutation({
    mutationFn: () =>
      clientFetch(`/sources/${kind}/config`, {
        method: 'PATCH',
        body: {
          categoryIds: cfgForm.categoryIdsCsv
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          keywords: cfgForm.keywordsCsv
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          minDiscount: cfgForm.minDiscount || undefined,
          limitPerCategory: cfgForm.limitPerCategory,
          onlyMall: cfgForm.onlyMall,
          onlyKeySellers: cfgForm.onlyKeySellers,
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['source', kind] }),
  });

  if (!copy) {
    return <p className="text-sm text-destructive">Source desconhecida: {kind}</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.subtitle}
        badge={<SourceBadge kind={kind} />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">🎯 Configuração de captura (cron)</CardTitle>
          <CardDescription>
            Define o que o cron puxa automaticamente a cada 30min. Sem categorias/keywords =
            comportamento padrão (top trending). Hint: ML usa MLB&lt;num&gt;, Shopee Int (productCatId), Amazon BrowseNodeId.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Categorias (CSV)</Label>
              <Input
                placeholder={
                  kind === 'MERCADOLIVRE'
                    ? 'MLB1276, MLB1574, MLB5726'
                    : kind === 'SHOPEE'
                      ? '100012, 100068, 100256'
                      : '17873924011, 17873925011'
                }
                value={cfgForm.categoryIdsCsv}
                onChange={(e) => setCfgForm({ ...cfgForm, categoryIdsCsv: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Keywords (CSV)</Label>
              <Input
                placeholder="smartwatch, fone bluetooth, perfume, suplemento"
                value={cfgForm.keywordsCsv}
                onChange={(e) => setCfgForm({ ...cfgForm, keywordsCsv: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Desconto mínimo (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={cfgForm.minDiscount}
                onChange={(e) => setCfgForm({ ...cfgForm, minDiscount: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label>Produtos por categoria/keyword</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={cfgForm.limitPerCategory}
                onChange={(e) =>
                  setCfgForm({ ...cfgForm, limitPerCategory: Number(e.target.value) })
                }
              />
            </div>
            {kind === 'SHOPEE' ? (
              <>
                <div className="space-y-1">
                  <Label>
                    <input
                      type="checkbox"
                      checked={cfgForm.onlyMall}
                      onChange={(e) => setCfgForm({ ...cfgForm, onlyMall: e.target.checked })}
                      className="mr-2 size-4"
                    />
                    Apenas Shopee Mall (lojas oficiais)
                  </Label>
                </div>
                <div className="space-y-1">
                  <Label>
                    <input
                      type="checkbox"
                      checked={cfgForm.onlyKeySellers}
                      onChange={(e) =>
                        setCfgForm({ ...cfgForm, onlyKeySellers: e.target.checked })
                      }
                      className="mr-2 size-4"
                    />
                    Apenas key sellers (top vendedores)
                  </Label>
                </div>
              </>
            ) : null}
          </div>
          <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>
            {saveConfig.isPending ? 'Salvando...' : 'Salvar config'}
          </Button>
          {saveConfig.isSuccess && (
            <div className="text-sm text-success">
              ✅ Salvo. Próximo fetch (cron ou manual) vai usar a nova config.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,360px)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="size-4 text-muted-foreground" />
              Captura manual
            </CardTitle>
            <CardDescription>
              Dispara um job de fetch agora. O cron já roda a cada 30min — isso é só pra forçar.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5 w-32">
              <Label>Limite</Label>
              <Input
                type="number"
                min="1"
                max="200"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </div>
            <Button
              variant="accent"
              onClick={() => fetchMutation.mutate()}
              loading={fetchMutation.isPending}
            >
              <Zap className="size-4" /> Capturar agora
            </Button>
            {fetchMutation.data ? (
              <Badge variant="success" dot>
                enfileirado
              </Badge>
            ) : fetchMutation.error ? (
              <Badge variant="destructive" dot>
                {(fetchMutation.error as Error).message}
              </Badge>
            ) : null}
          </CardContent>
        </Card>

        {copy.hasCookie ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cookie className="size-4 text-muted-foreground" />
                Cookie do painel
              </CardTitle>
              <CardDescription>
                Necessário para conversão automática URL → afiliado quando a API oficial não está disponível.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/sources/${kind === 'SHOPEE' ? 'shopee' : 'mercadolivre'}/cookie`}>
                  Configurar cookie {copy.title}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="px-6 py-6 text-sm text-muted-foreground">
              {copy.tip ?? 'Source automatizada — não exige cookie.'}
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Últimas ofertas captadas</CardTitle>
          <CardDescription>10 mais recentes desse source.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {offers.isLoading ? (
            <div className="px-6 py-4">
              <SkeletonRows count={4} />
            </div>
          ) : (offers.data ?? []).length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Nenhuma oferta ainda"
              description="Use “Capturar agora” acima ou aguarde o cron das próximas 30min."
            />
          ) : (
            <ul className="divide-y">
              {(offers.data ?? []).map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-5 py-3 row-hover">
                  {o.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={o.imageUrl}
                      alt=""
                      className="size-12 shrink-0 rounded object-cover ring-1 ring-border"
                    />
                  ) : (
                    <div className="grid size-12 shrink-0 place-items-center rounded bg-muted">
                      <ImageOff className="size-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <a
                      href={o.affiliateUrl ?? o.url}
                      target="_blank"
                      rel="noreferrer"
                      className="line-clamp-1 inline-flex items-center gap-1 font-medium text-sm hover:text-accent"
                    >
                      {o.title}
                      <ExternalLink className="size-3 shrink-0 opacity-60" />
                    </a>
                    <p className="text-xs text-muted-foreground">{formatDate(o.fetchedAt)}</p>
                  </div>
                  {o.affiliateUrl ? (
                    <Badge variant="success" dot>
                      afiliado
                    </Badge>
                  ) : (
                    <Badge variant="warning" dot>
                      sem link
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
