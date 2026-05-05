'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Tag } from 'lucide-react';
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

type NicheFilters = {
  categoryIds?: { SHOPEE?: string[]; MERCADOLIVRE?: string[]; AMAZON?: string[] };
  keywords?: string[];
  minDiscount?: number;
  minScore?: number;
  maxPrice?: number;
};

type Niche = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  filters: NicheFilters;
  enabled: boolean;
  _count?: { campaigns: number };
};

// Templates pré-prontos pra acelerar criação
const TEMPLATES: Array<{ name: string; icon: string; filters: NicheFilters }> = [
  {
    name: 'Bebê & Maternidade',
    icon: '🍼',
    filters: {
      categoryIds: { MERCADOLIVRE: ['MLB1384'], SHOPEE: [] },
      keywords: ['carrinho bebê', 'fralda', 'mamadeira'],
      minDiscount: 15,
    },
  },
  {
    name: 'Beleza & Cuidado Pessoal',
    icon: '💄',
    filters: {
      categoryIds: { MERCADOLIVRE: ['MLB1246'], SHOPEE: [] },
      keywords: ['perfume', 'maquiagem', 'shampoo'],
      minDiscount: 10,
    },
  },
  {
    name: 'Casa & Decoração',
    icon: '🏠',
    filters: {
      categoryIds: { MERCADOLIVRE: ['MLB1574'], SHOPEE: [] },
      keywords: ['decoração casa', 'organizador'],
      minDiscount: 15,
    },
  },
  {
    name: 'Eletrônicos',
    icon: '📱',
    filters: {
      categoryIds: { MERCADOLIVRE: ['MLB1051', 'MLB1000'], SHOPEE: [] },
      keywords: ['smartwatch', 'fone bluetooth', 'echo dot'],
      minDiscount: 10,
    },
  },
  {
    name: 'Fitness & Suplementos',
    icon: '🏋️',
    filters: {
      categoryIds: { MERCADOLIVRE: ['MLB1276', 'MLB1540'], SHOPEE: [] },
      keywords: ['whey', 'creatina', 'tênis corrida'],
      minDiscount: 10,
    },
  },
  {
    name: 'Pet',
    icon: '🐾',
    filters: {
      categoryIds: { MERCADOLIVRE: ['MLB1071'], SHOPEE: [] },
      keywords: ['ração cachorro', 'gato'],
      minDiscount: 10,
    },
  },
];

export default function NichesPage(): React.ReactElement {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    icon: '',
    description: '',
    mlCategoryIds: '',
    shopeeCategoryIds: '',
    keywords: '',
    minDiscount: 0,
    minScore: 0,
    maxPrice: 0,
  });

  const { data: niches, isLoading } = useQuery<Niche[]>({
    queryKey: ['niches'],
    queryFn: () => clientFetch<Niche[]>('/niches'),
  });

  const create = useMutation<Niche>({
    mutationFn: () =>
      clientFetch<Niche>('/niches', {
        method: 'POST',
        body: {
          name: form.name,
          icon: form.icon || undefined,
          description: form.description || undefined,
          filters: {
            categoryIds: {
              MERCADOLIVRE: form.mlCategoryIds.split(',').map((s) => s.trim()).filter(Boolean),
              SHOPEE: form.shopeeCategoryIds.split(',').map((s) => s.trim()).filter(Boolean),
            },
            keywords: form.keywords.split(',').map((s) => s.trim()).filter(Boolean),
            minDiscount: form.minDiscount || undefined,
            minScore: form.minScore || undefined,
            maxPrice: form.maxPrice || undefined,
          },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['niches'] });
      setForm({
        name: '',
        icon: '',
        description: '',
        mlCategoryIds: '',
        shopeeCategoryIds: '',
        keywords: '',
        minDiscount: 0,
        minScore: 0,
        maxPrice: 0,
      });
    },
  });

  const toggle = useMutation<Niche, Error, { id: string; enabled: boolean }>({
    mutationFn: ({ id, enabled }) =>
      clientFetch<Niche>(`/niches/${id}`, { method: 'PATCH', body: { enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['niches'] }),
  });

  const del = useMutation<unknown, Error, string>({
    mutationFn: (id) => clientFetch(`/niches/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['niches'] }),
  });

  const applyTemplate = (t: (typeof TEMPLATES)[number]): void => {
    setForm({
      name: t.name,
      icon: t.icon,
      description: '',
      mlCategoryIds: (t.filters.categoryIds?.MERCADOLIVRE ?? []).join(', '),
      shopeeCategoryIds: (t.filters.categoryIds?.SHOPEE ?? []).join(', '),
      keywords: (t.filters.keywords ?? []).join(', '),
      minDiscount: t.filters.minDiscount ?? 0,
      minScore: 0,
      maxPrice: 0,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nichos"
        description="Preset reutilizável de filtros (categorias + keywords + qualidade) que você atribui a 1+ campanhas. Permite ter grupo 'Mães' só com nicho Bebê e grupo 'Tudo' com Bebê+Casa+Beleza."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">⚡ Templates rápidos</CardTitle>
          <CardDescription>Clica num pra preencher o form abaixo</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <Button key={t.name} variant="outline" size="sm" onClick={() => applyTemplate(t)}>
              {t.icon} {t.name}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4 text-primary" />
            Criar nicho
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Bebê & Maternidade"
              />
            </div>
            <div className="space-y-1">
              <Label>Ícone (emoji)</Label>
              <Input
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                placeholder="🍼"
                maxLength={4}
              />
            </div>
            <div className="space-y-1">
              <Label>Descrição</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Itens pra grávidas e mães de bebês 0-2 anos"
              />
            </div>
            <div className="space-y-1">
              <Label>Categorias ML (CSV)</Label>
              <Input
                value={form.mlCategoryIds}
                onChange={(e) => setForm({ ...form, mlCategoryIds: e.target.value })}
                placeholder="MLB1384, MLB1399"
              />
            </div>
            <div className="space-y-1">
              <Label>Categorias Shopee (CSV)</Label>
              <Input
                value={form.shopeeCategoryIds}
                onChange={(e) => setForm({ ...form, shopeeCategoryIds: e.target.value })}
                placeholder="100068, 100129"
              />
            </div>
            <div className="space-y-1">
              <Label>Keywords (CSV)</Label>
              <Input
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                placeholder="carrinho bebê, fralda"
              />
            </div>
            <div className="space-y-1">
              <Label>Desconto mínimo (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.minDiscount}
                onChange={(e) => setForm({ ...form, minDiscount: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label>Score mínimo (0-1)</Label>
              <Input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={form.minScore}
                onChange={(e) => setForm({ ...form, minScore: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label>Preço máximo (R$)</Label>
              <Input
                type="number"
                min={0}
                value={form.maxPrice}
                onChange={(e) => setForm({ ...form, maxPrice: Number(e.target.value) })}
              />
            </div>
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !form.name.trim()}>
            {create.isPending ? 'Salvando...' : 'Salvar nicho'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Nichos cadastrados ({niches?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <SkeletonRows count={3} />
          ) : !niches?.length ? (
            <EmptyState icon={Tag} title="Nenhum nicho" description="Use um template ou crie manualmente." />
          ) : (
            niches.map((n) => {
              const f = n.filters ?? {};
              const cats = [
                ...(f.categoryIds?.MERCADOLIVRE ?? []),
                ...(f.categoryIds?.SHOPEE ?? []),
                ...(f.categoryIds?.AMAZON ?? []),
              ];
              return (
                <div key={n.id} className="rounded-lg border bg-card/50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold">
                          {n.icon} {n.name}
                        </span>
                        {n.enabled ? (
                          <Badge variant="success" dot>ativo</Badge>
                        ) : (
                          <Badge variant="secondary">pausado</Badge>
                        )}
                        <Badge variant="secondary">
                          {n._count?.campaigns ?? 0} campanha{(n._count?.campaigns ?? 0) === 1 ? '' : 's'}
                        </Badge>
                      </div>
                      {n.description ? (
                        <p className="mt-1 text-sm text-muted-foreground">{n.description}</p>
                      ) : null}
                      <div className="mt-1 text-xs text-muted-foreground">
                        {cats.length > 0 ? <>📁 {cats.length} categorias · </> : null}
                        {f.keywords?.length ? <>🔍 {f.keywords.length} keywords · </> : null}
                        {f.minDiscount ? <>💸 ≥{f.minDiscount}% off</> : null}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggle.mutate({ id: n.id, enabled: !n.enabled })}
                      >
                        {n.enabled ? 'Pausar' : 'Ativar'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm(`Excluir nicho "${n.name}"?`)) del.mutate(n.id);
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
