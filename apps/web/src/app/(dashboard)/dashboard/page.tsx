import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Cookie,
  Inbox,
  Send,
  ShoppingBag,
  XCircle,
} from 'lucide-react';
import { serverFetch } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate } from '@/lib/utils';
import type { CookieHealth } from '@afiliado-master/types';

type StatsResponse = {
  offersToday: { sourceId: string; _count: number }[];
  dispatchAgg: { status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'; _count: number }[];
  cookieHealth: {
    kind: 'SHOPEE' | 'MERCADOLIVRE';
    cookieHealth: CookieHealth | null;
    cookieValidatedAt: string | null;
  }[];
};

export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<React.ReactElement> {
  let stats: StatsResponse | null = null;
  let error: string | null = null;
  try {
    stats = await serverFetch<StatsResponse>('/stats/today', { cache: 'no-store' });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const totalOffersToday = stats?.offersToday.reduce((acc, o) => acc + o._count, 0) ?? 0;
  const sentToday = stats?.dispatchAgg.find((d) => d.status === 'SENT')?._count ?? 0;
  const failedToday = stats?.dispatchAgg.find((d) => d.status === 'FAILED')?._count ?? 0;
  const skippedToday = stats?.dispatchAgg.find((d) => d.status === 'SKIPPED')?._count ?? 0;
  const pendingToday = stats?.dispatchAgg.find((d) => d.status === 'PENDING')?._count ?? 0;

  const totalDispatchAttempts = sentToday + failedToday + skippedToday + pendingToday;
  const successRate = totalDispatchAttempts > 0 ? Math.round((sentToday / totalDispatchAttempts) * 100) : null;

  return (
    <div className="space-y-7">
      <PageHeader
        title="Dashboard"
        description="Visão do dia — captação, disparos e saúde dos cookies."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/offers">Ver ofertas</Link>
            </Button>
            <Button variant="accent" asChild>
              <Link href="/campaigns">Nova campanha</Link>
            </Button>
          </>
        }
      />

      {error ? (
        <Card className="border-destructive/30 bg-destructive-soft/50">
          <CardContent className="flex items-start gap-3 px-5 py-4">
            <XCircle className="size-5 shrink-0 text-destructive" />
            <div className="text-sm">
              <p className="font-medium text-destructive-soft-foreground">Backend offline.</p>
              <p className="mt-1 text-destructive-soft-foreground/80">
                {error} — verifique <code className="rounded bg-background/60 px-1">{process.env.API_BASE_URL ?? 'http://localhost:3000'}</code>.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Ofertas captadas"
          value={totalOffersToday}
          hint="entradas únicas hoje (cron + manual)"
          icon={ShoppingBag}
          tone="accent"
        />
        <StatCard
          label="Enviadas"
          value={sentToday}
          hint={successRate !== null ? `${successRate}% de aproveitamento` : 'sem disparos hoje'}
          icon={Send}
          tone="success"
        />
        <StatCard
          label="Falhas"
          value={failedToday}
          hint={failedToday > 0 ? 'investigar logs do worker' : 'pipeline limpo'}
          icon={AlertTriangle}
          tone={failedToday > 0 ? 'destructive' : 'default'}
        />
        <StatCard
          label="Skipped"
          value={skippedToday}
          hint="janela horária / sem affiliateUrl"
          icon={Inbox}
          tone="warning"
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Funil de hoje</CardTitle>
            <CardDescription>De ofertas captadas até disparo enviado.</CardDescription>
          </CardHeader>
          <CardContent>
            <FunnelBar
              steps={[
                { label: 'Captadas', value: totalOffersToday, tone: 'accent' },
                { label: 'Pendentes', value: pendingToday, tone: 'default' },
                { label: 'Enviadas', value: sentToday, tone: 'success' },
                { label: 'Falhas + Skipped', value: failedToday + skippedToday, tone: 'destructive' },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cookies de afiliação</CardTitle>
            <CardDescription>Sessões logadas usadas pra gerar shortlinks.</CardDescription>
          </CardHeader>
          <CardContent>
            {!stats || stats.cookieHealth.length === 0 ? (
              <EmptyState
                icon={Cookie}
                title="Nenhum cookie validado"
                description="Cole o cookie do painel ML ou Shopee para habilitar conversão automática URL → afiliado."
                action={
                  <div className="flex gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href="/sources/mercadolivre/cookie">Cookie ML</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/sources/shopee/cookie">Cookie Shopee</Link>
                    </Button>
                  </div>
                }
              />
            ) : (
              <ul className="space-y-2">
                {stats.cookieHealth.map((s) => (
                  <li
                    key={s.kind}
                    className="flex items-center justify-between rounded-lg border bg-background/40 px-3 py-2.5 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{s.kind}</span>
                        {s.cookieHealth?.affiliateName ? (
                          <span className="truncate text-xs text-muted-foreground">
                            · {s.cookieHealth.affiliateName}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        validado em {formatDate(s.cookieValidatedAt)}
                      </p>
                    </div>
                    {s.cookieHealth?.valid ? (
                      <Badge variant="success" dot>
                        <CheckCircle2 className="size-3" /> ok
                      </Badge>
                    ) : (
                      <Badge variant="destructive" dot>
                        expirado
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

type FunnelStep = { label: string; value: number; tone: 'accent' | 'default' | 'success' | 'destructive' };

function FunnelBar({ steps }: { steps: FunnelStep[] }): React.ReactElement {
  const max = Math.max(1, ...steps.map((s) => s.value));
  const colorMap: Record<FunnelStep['tone'], string> = {
    accent: 'bg-accent/80',
    default: 'bg-muted-foreground/40',
    success: 'bg-success/80',
    destructive: 'bg-destructive/80',
  };
  return (
    <div className="space-y-3">
      {steps.map((s) => (
        <div key={s.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-mono tabular-nums font-semibold">{s.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all duration-500 ${colorMap[s.tone]}`}
              style={{ width: `${Math.max(2, (s.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
