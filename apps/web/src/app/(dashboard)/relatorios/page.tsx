'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ImageOff,
  BarChart3,
  TrendingUp,
  ShoppingBag,
  Wallet,
  Package,
  CheckCircle2,
  Send,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { clientFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { formatBRL } from '@/lib/utils';

type OrderStatus = 'COMPLETED' | 'PENDING' | 'CANCELLED' | 'UNPAID';

type ConversionItem = {
  conversionId: string;
  orderId: string;
  orderStatus: OrderStatus | string;
  purchaseTime: number;
  device: string | null;
  shopName: string;
  shopId: string;
  itemId: string;
  itemName: string;
  itemPrice: number;
  actualAmount: number;
  qty: number;
  imageUrl: string;
  itemTotalCommission: number;
  category: string | null;
  ourOfferId: string | null;
  ourCampaignName: string | null;
  ourDispatchedAt: string | null;
};

type ReportResponse = {
  items: ConversionItem[];
  totals: {
    totalCommission: number;
    netCommission: number;
    totalOrders: number;
    totalItems: number;
    totalAmount: number;
    statusCounts: Record<OrderStatus, number>;
    fromOurDispatches: number;
  };
  pageInfo: { hasNextPage: boolean; scrollId: string | null };
  cached: boolean;
};

const STATUS_BADGE: Record<string, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  COMPLETED: 'success',
  PENDING: 'warning',
  CANCELLED: 'destructive',
  UNPAID: 'secondary',
};

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Completo',
  PENDING: 'Pendente',
  CANCELLED: 'Cancelado',
  UNPAID: 'Não pago',
};

function fmtDate(ts: number): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Defaults: últimos 7 dias
function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

export default function RelatoriosPage(): React.ReactElement {
  const [dateStart, setDateStart] = useState(daysAgo(7));
  const [dateEnd, setDateEnd] = useState(todayDate());
  const [orderStatus, setOrderStatus] = useState<OrderStatus | 'ALL'>('ALL');
  const [device, setDevice] = useState<'APP' | 'WEB' | 'ALL'>('ALL');
  const [shopName, setShopName] = useState('');
  const [productName, setProductName] = useState('');
  const [orderId, setOrderId] = useState('');
  const [showOnlyOurs, setShowOnlyOurs] = useState(false);

  const buildParams = (): string => {
    const p = new URLSearchParams();
    p.set(
      'purchaseTimeStart',
      String(Math.floor(new Date(dateStart + 'T00:00:00-03:00').getTime() / 1000)),
    );
    p.set(
      'purchaseTimeEnd',
      String(Math.floor(new Date(dateEnd + 'T23:59:59-03:00').getTime() / 1000)),
    );
    if (orderStatus !== 'ALL') p.set('orderStatus', orderStatus);
    if (device !== 'ALL') p.set('device', device);
    if (shopName.trim()) p.set('shopName', shopName.trim());
    if (productName.trim()) p.set('productName', productName.trim());
    if (orderId.trim()) p.set('orderId', orderId.trim());
    p.set('limit', '200');
    return p.toString();
  };

  const { data, isLoading, error, refetch, isRefetching } = useQuery<ReportResponse>({
    queryKey: ['shopee-conversions', dateStart, dateEnd, orderStatus, device, shopName, productName, orderId],
    queryFn: () => clientFetch<ReportResponse>(`/sources/SHOPEE/conversions?${buildParams()}`),
    refetchOnWindowFocus: false,
  });

  const visibleItems = showOnlyOurs
    ? (data?.items ?? []).filter((i) => i.ourDispatchedAt)
    : data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="📊 Relatórios Shopee"
        description="Acompanhe suas conversões, comissões e vendas — dados D+1 da Shopee"
      />

      {/* Filtros */}
      <Card>
        <CardContent className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <div className="space-y-1">
              <Label className="text-xs">Data início</Label>
              <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data fim</Label>
              <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={orderStatus} onChange={(e) => setOrderStatus(e.target.value as OrderStatus | 'ALL')}>
                <option value="ALL">Todos</option>
                <option value="COMPLETED">Completo</option>
                <option value="PENDING">Pendente</option>
                <option value="CANCELLED">Cancelado</option>
                <option value="UNPAID">Não pago</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Dispositivo</Label>
              <Select value={device} onChange={(e) => setDevice(e.target.value as 'APP' | 'WEB' | 'ALL')}>
                <option value="ALL">Todos</option>
                <option value="APP">App</option>
                <option value="WEB">Web</option>
              </Select>
            </div>
            <div className="space-y-1 col-span-2 md:col-span-1">
              <Label className="text-xs">Loja</Label>
              <Input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Nome da loja" />
            </div>
            <div className="flex items-end">
              <Button onClick={() => refetch()} disabled={isRefetching} className="w-full" size="sm">
                <RefreshCw className={`mr-1 size-4 ${isRefetching ? 'animate-spin' : ''}`} />
                Buscar
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Nome do produto..." />
            <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="ID do pedido..." />
            <label className="flex items-center gap-2 rounded-md border bg-accent-soft/30 px-3 py-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyOurs}
                onChange={(e) => setShowOnlyOurs(e.target.checked)}
                className="size-4 accent-accent"
              />
              <Send className="size-3.5" />
              Só vendas dos nossos disparos
            </label>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="py-6 text-center text-destructive">
            ❌ Erro: {(error as Error).message}
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="py-4">
                <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-6 w-20 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <StatCard icon={Wallet} label="Comissão total" value={formatBRL(data.totals.totalCommission)} color="emerald" />
            <StatCard icon={TrendingUp} label="Comissão líquida" value={formatBRL(data.totals.netCommission)} color="emerald" />
            <StatCard icon={ShoppingBag} label="Pedidos" value={String(data.totals.totalOrders)} color="blue" />
            <StatCard icon={Package} label="Itens" value={String(data.totals.totalItems)} color="blue" />
            <StatCard icon={BarChart3} label="Faturamento" value={formatBRL(data.totals.totalAmount)} color="purple" />
            <StatCard icon={Send} label="Dos nossos disparos" value={String(data.totals.fromOurDispatches)} color="amber" />
          </div>

          {/* Status breakdown */}
          <Card>
            <CardContent className="flex flex-wrap items-center justify-around gap-3 py-4">
              <StatusPill status="COMPLETED" count={data.totals.statusCounts.COMPLETED} />
              <StatusPill status="PENDING" count={data.totals.statusCounts.PENDING} />
              <StatusPill status="CANCELLED" count={data.totals.statusCounts.CANCELLED} />
              <StatusPill status="UNPAID" count={data.totals.statusCounts.UNPAID} />
            </CardContent>
          </Card>

          {/* Tabela */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Produto</th>
                      <th className="px-3 py-2 text-left">Loja</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                      <th className="px-3 py-2 text-right">Comissão</th>
                      <th className="px-3 py-2 text-center">Qtd</th>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Nosso?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                          Nenhuma venda no período selecionado.
                        </td>
                      </tr>
                    ) : (
                      visibleItems.map((it, idx) => (
                        <tr key={`${it.conversionId}-${it.itemId}-${idx}`} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-3 py-2">
                            <div className="flex items-start gap-2">
                              {it.imageUrl ? (
                                <img src={it.imageUrl} alt="" className="size-12 shrink-0 rounded object-cover" />
                              ) : (
                                <div className="size-12 shrink-0 rounded bg-muted grid place-items-center">
                                  <ImageOff className="size-4 text-muted-foreground" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="line-clamp-2 text-xs font-medium" title={it.itemName}>
                                  {it.itemName}
                                </div>
                                <div className="mt-0.5 text-[10px] text-muted-foreground">
                                  {it.category}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{it.shopName}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant={STATUS_BADGE[it.orderStatus] ?? 'secondary'}>
                              {STATUS_LABEL[it.orderStatus] ?? it.orderStatus}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatBRL(it.actualAmount)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-600">
                            {formatBRL(it.itemTotalCommission)}
                          </td>
                          <td className="px-3 py-2 text-center">{it.qty}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(it.purchaseTime)}</td>
                          <td className="px-3 py-2">
                            {it.ourDispatchedAt ? (
                              <span
                                className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-900"
                                title={`Mandado em ${new Date(it.ourDispatchedAt).toLocaleString('pt-BR')} em "${it.ourCampaignName}"`}
                              >
                                <Send className="size-3" /> nosso
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">orgânico</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="border-t px-4 py-2 text-xs text-muted-foreground">
                {visibleItems.length} itens carregados {showOnlyOurs ? '(filtro "só nossos" ativo)' : ''}
                {data.pageInfo.hasNextPage ? ' — mais páginas disponíveis (paginação não implementada ainda)' : ''}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: 'emerald' | 'blue' | 'purple' | 'amber';
}): React.ReactElement {
  const palette: Record<typeof color, string> = {
    emerald: 'text-emerald-600 bg-emerald-50',
    blue: 'text-blue-600 bg-blue-50',
    purple: 'text-purple-600 bg-purple-50',
    amber: 'text-amber-700 bg-amber-50',
  };
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className={`grid size-8 place-items-center rounded ${palette[color]}`}>
            <Icon className="size-4" />
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        </div>
        <div className="mt-2 text-xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function StatusPill({ status, count }: { status: OrderStatus; count: number }): React.ReactElement {
  const variant = STATUS_BADGE[status];
  return (
    <div className="flex items-center gap-2">
      <Badge variant={variant ?? 'secondary'}>{STATUS_LABEL[status]}</Badge>
      <span className="text-2xl font-bold tabular-nums">{count}</span>
    </div>
  );
}
