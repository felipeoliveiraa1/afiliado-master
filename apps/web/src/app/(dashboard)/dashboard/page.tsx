import { serverFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Visão do dia — ofertas captadas, dispatches e saúde dos cookies.</p>
      </header>

      {error ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">Falha ao carregar stats: {error}</p>
            <p className="text-sm text-muted-foreground mt-2">
              Verifique se o backend está rodando em <code className="rounded bg-muted px-1">{process.env.API_BASE_URL ?? 'http://localhost:3000'}</code>.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label="Ofertas captadas hoje" value={totalOffersToday} />
        <Kpi label="Disparos enviados" value={sentToday} tone="success" />
        <Kpi label="Falhas" value={failedToday} tone={failedToday > 0 ? 'destructive' : 'muted'} />
        <Kpi label="Skipped" value={skippedToday} tone="muted" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Saúde dos cookies de afiliação</CardTitle>
        </CardHeader>
        <CardContent>
          {!stats || stats.cookieHealth.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum cookie validado ainda. Vá em &quot;Cookie ML&quot; ou &quot;Cookie Shopee&quot; para configurar.
            </p>
          ) : (
            <div className="space-y-3">
              {stats.cookieHealth.map((s) => (
                <div key={s.kind} className="flex items-center justify-between border-b pb-2 last:border-b-0">
                  <div>
                    <div className="font-medium">{s.kind}</div>
                    <div className="text-xs text-muted-foreground">
                      Validado em {formatDate(s.cookieValidatedAt)}
                      {s.cookieHealth?.affiliateName ? ` — ${s.cookieHealth.affiliateName}` : ''}
                    </div>
                  </div>
                  {s.cookieHealth?.valid ? (
                    <Badge variant="success">OK</Badge>
                  ) : (
                    <Badge variant="destructive">{s.cookieHealth?.errorMessage ?? 'inválido'}</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'destructive' | 'muted';
}): React.ReactElement {
  const valueClass =
    tone === 'success'
      ? 'text-emerald-600'
      : tone === 'destructive'
        ? 'text-destructive'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : '';
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-3xl font-bold ${valueClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
