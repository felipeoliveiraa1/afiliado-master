'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Inbox,
  Percent,
  Send,
  ShoppingBag,
  TrendingUp,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { clientFetch } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type ExtendedStats = {
  today: {
    offersCaptadas: number;
    offersDelta: number | null;
    sent: number;
    sentDelta: number | null;
    failed: number;
    skipped: number;
    pending: number;
    commissionPotential: number;
    discountAvg: number;
    successRate: number;
  };
  totals: { bySource: Record<string, number>; all: number };
  week: { bySource: Record<string, number>; sparkline: { day: string; count: number }[] };
  throughput24h: { hour: number; count: number }[];
  sources: {
    kind: string;
    enabled: boolean;
    lastFetchAt: string | null;
    hoursAgo: number | null;
    cookieValid: boolean | null;
    cookieValidatedAt: string | null;
  }[];
};

const SOURCE_COLORS: Record<string, string> = {
  SHOPEE: '#ff6b35',
  MERCADOLIVRE: '#ffc107',
  AMAZON: '#1e88e5',
  PROMOBIT: '#9c27b0',
};

const SOURCE_LABEL: Record<string, string> = {
  SHOPEE: '🟠 Shopee',
  MERCADOLIVRE: '🟡 ML',
  AMAZON: '🔵 Amazon',
  PROMOBIT: '🟣 Promobit',
};

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

export default function DashboardPage(): React.ReactElement {
  const { data, isLoading, error, refetch, isFetching } = useQuery<ExtendedStats>({
    queryKey: ['stats-extended'],
    queryFn: () => clientFetch<ExtendedStats>('/stats/extended'),
    refetchInterval: 60_000, // refresh 60s
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Visão do dia em tempo real — atualiza a cada 60s."
        badge={
          <Badge variant="success" dot>
            <span className="relative flex size-2">
              <span className="absolute inset-0 inline-flex animate-ping rounded-full bg-current opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-current" />
            </span>
            ao vivo
          </Badge>
        }
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/offers">Ofertas</Link>
            </Button>
            <Button asChild variant="accent" size="sm">
              <Link href="/import-link">Enviar link</Link>
            </Button>
          </div>
        }
      />

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            ❌ Erro ao carregar stats: {(error as Error).message}
          </CardContent>
        </Card>
      ) : null}

      {/* KPI Cards top — 4 stats principais */}
      <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Captadas hoje"
          value={data?.today.offersCaptadas ?? 0}
          delta={data?.today.offersDelta ?? null}
          icon={Inbox}
          loading={isLoading}
          sparkline={data?.week.sparkline.map((s) => s.count) ?? []}
          accent
        />
        <KpiCard
          label="Enviadas hoje"
          value={data?.today.sent ?? 0}
          delta={data?.today.sentDelta ?? null}
          icon={Send}
          loading={isLoading}
          sublabel={`${data?.today.successRate ?? 100}% aproveitamento`}
        />
        <KpiCard
          label="Comissão potencial"
          value={data?.today.commissionPotential ?? 0}
          icon={CircleDollarSign}
          loading={isLoading}
          format="brl"
          sublabel={`do que foi enviado hoje`}
          tone="success"
        />
        <KpiCard
          label="Desconto médio"
          value={data?.today.discountAvg ?? 0}
          icon={Percent}
          loading={isLoading}
          format="pct"
          sublabel="ofertas enviadas"
        />
      </div>

      {/* Linha 2: gráfico 24h (2/3) + distribuição (1/3) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 hero-gradient">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-accent" />
              Disparos por hora — hoje
            </CardTitle>
            <CardDescription>
              {data?.today.sent ?? 0} enviados nas últimas 24h
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {isLoading ? (
              <Skeleton className="h-[200px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart
                  data={data?.throughput24h ?? []}
                  margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="thrFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(h) => `${h}h`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid hsl(var(--border))',
                      background: 'hsl(var(--card))',
                      fontSize: 12,
                    }}
                    labelFormatter={(h) => `${h}:00 UTC`}
                    formatter={(v) => [`${v} dispatches`, 'Enviados']}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(var(--accent))"
                    strokeWidth={2}
                    fill="url(#thrFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingBag className="size-4 text-accent" />
              Distribuição de fontes
            </CardTitle>
            <CardDescription>{data?.totals.all ?? 0} ofertas no banco</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[200px] w-full" />
            ) : (
              <SourcesDonut data={data?.totals.bySource ?? {}} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Linha 3: Funil + Sources Health + Top 7d */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Funil de hoje</CardTitle>
            <CardDescription>De captada até enviada</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <FunnelBar label="Captadas" value={data?.today.offersCaptadas ?? 0} max={data?.today.offersCaptadas ?? 1} tone="default" loading={isLoading} />
            <FunnelBar label="Enviadas" value={data?.today.sent ?? 0} max={data?.today.offersCaptadas ?? 1} tone="success" loading={isLoading} />
            <FunnelBar label="Pendentes" value={data?.today.pending ?? 0} max={data?.today.offersCaptadas ?? 1} tone="warning" loading={isLoading} />
            <FunnelBar label="Falhas + Skip" value={(data?.today.failed ?? 0) + (data?.today.skipped ?? 0)} max={data?.today.offersCaptadas ?? 1} tone="destructive" loading={isLoading} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Saúde das fontes</CardTitle>
            <CardDescription>Último fetch + cookies</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              data?.sources.map((s) => <SourceHealthRow key={s.kind} src={s} />)
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-accent" />
              7 dias por fonte
            </CardTitle>
            <CardDescription>Total {Object.values(data?.week.bySource ?? {}).reduce((a, b) => a + b, 0)} captadas</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[160px] w-full" />
            ) : (
              <SourcesBarChart data={data?.week.bySource ?? {}} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* -------- Componentes locais -------- */

function KpiCard({
  label,
  value,
  delta,
  sublabel,
  icon: Icon,
  loading,
  format = 'int',
  sparkline,
  tone,
  accent,
}: {
  label: string;
  value: number;
  delta?: number | null;
  sublabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
  format?: 'int' | 'brl' | 'pct';
  sparkline?: number[];
  tone?: 'success' | 'warning' | 'destructive';
  accent?: boolean;
}): React.ReactElement {
  const formatted =
    format === 'brl' ? formatBRL(value) : format === 'pct' ? `${value.toFixed(1)}%` : value.toLocaleString('pt-BR');
  const deltaSign = delta != null ? (delta >= 0 ? '+' : '') : '';
  const deltaText = delta != null ? `${deltaSign}${delta.toFixed(0)}% vs ontem` : null;

  return (
    <Card className={cn('card-interactive overflow-hidden', accent && 'hero-gradient')}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <div
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent',
              tone === 'success' && 'bg-success-soft text-success-soft-foreground',
              tone === 'warning' && 'bg-warning-soft text-warning-soft-foreground',
              tone === 'destructive' && 'bg-destructive-soft text-destructive-soft-foreground',
            )}
          >
            <Icon className="size-4" />
          </div>
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-24" />
        ) : (
          <p className={cn('mt-2 text-2xl font-bold tracking-tight sm:text-3xl', accent && 'text-gradient-accent')}>
            {formatted}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2 text-[11px]">
          {deltaText ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                delta && delta >= 0 ? 'text-success-soft-foreground' : 'text-destructive-soft-foreground',
              )}
            >
              {delta && delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {deltaText}
            </span>
          ) : sublabel ? (
            <span className="text-muted-foreground">{sublabel}</span>
          ) : null}
        </div>
        {sparkline && sparkline.length > 1 ? (
          <div className="mt-3 h-8 -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline.map((v, i) => ({ i, v }))}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="hsl(var(--accent))"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FunnelBar({
  label,
  value,
  max,
  tone,
  loading,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'default' | 'success' | 'warning' | 'destructive';
  loading?: boolean;
}): React.ReactElement {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const toneCls = {
    default: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
  }[tone];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{loading ? '—' : value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all duration-500', toneCls)}
          style={{ width: loading ? '0%' : `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SourceHealthRow({
  src,
}: {
  src: ExtendedStats['sources'][number];
}): React.ReactElement {
  const ok =
    src.enabled &&
    (src.kind === 'SHOPEE'
      ? true // Open API, sem cookie
      : src.kind === 'MERCADOLIVRE'
        ? src.cookieValid === true
        : src.enabled);
  const last =
    src.hoursAgo == null
      ? 'nunca'
      : src.hoursAgo < 1
        ? 'agora há pouco'
        : src.hoursAgo < 24
          ? `${src.hoursAgo}h atrás`
          : `${Math.floor(src.hoursAgo / 24)}d atrás`;

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">{SOURCE_LABEL[src.kind] ?? src.kind}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[11px] text-muted-foreground">{last}</span>
        {ok ? (
          <Wifi className="size-3.5 text-success" />
        ) : !src.enabled ? (
          <span className="text-[11px] text-muted-foreground italic">desativado</span>
        ) : (
          <WifiOff className="size-3.5 text-destructive" />
        )}
      </div>
    </div>
  );
}

function SourcesDonut({ data }: { data: Record<string, number> }): React.ReactElement {
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  if (entries.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">sem dados</p>;
  }
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const chartData = entries.map(([kind, v]) => ({
    name: SOURCE_LABEL[kind] ?? kind,
    kind,
    value: v,
    pct: ((v / total) * 100).toFixed(0),
  }));
  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie
            data={chartData}
            innerRadius={36}
            outerRadius={62}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={2}
            stroke="hsl(var(--card))"
          >
            {chartData.map((d, i) => (
              <Cell key={i} fill={SOURCE_COLORS[d.kind] ?? '#888'} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: '1px solid hsl(var(--border))',
              background: 'hsl(var(--card))',
              fontSize: 12,
            }}
            formatter={(v: number) => [v.toLocaleString('pt-BR'), 'ofertas']}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1 text-xs">
        {chartData.map((d) => (
          <div key={d.kind} className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: SOURCE_COLORS[d.kind] ?? '#888' }}
              />
              {d.name}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {d.value.toLocaleString('pt-BR')} ({d.pct}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourcesBarChart({ data }: { data: Record<string, number> }): React.ReactElement {
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  if (entries.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">sem dados</p>;
  }
  const chartData = entries.map(([kind, v]) => ({
    name: SOURCE_LABEL[kind] ?? kind,
    kind,
    count: v,
  }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: '1px solid hsl(var(--border))',
            background: 'hsl(var(--card))',
            fontSize: 12,
          }}
          formatter={(v: number) => [v.toLocaleString('pt-BR'), 'ofertas']}
        />
        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
          {chartData.map((d, i) => (
            <Cell key={i} fill={SOURCE_COLORS[d.kind] ?? 'hsl(var(--accent))'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
