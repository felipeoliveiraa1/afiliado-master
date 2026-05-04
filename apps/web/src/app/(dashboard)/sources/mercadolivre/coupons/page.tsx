'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Tag, RefreshCw, Plus, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
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
import { formatBRL } from '@/lib/utils';

type MlCoupon = {
  id: string;
  mlCouponId: number;
  alias: string | null;
  code: string | null;
  prefix: string | null;
  title: string;
  seller: string;
  category: string;
  remainingBudget: number;
  expirationDate: string;
  status: 'AVAILABLE' | 'ACTIVE' | 'EXPIRED' | 'EXHAUSTED';
  enabled: boolean;
  lastSyncedAt: string;
};

type SyncResp = { prefix: string; upserted: number; generated: number };

const STATUS_BADGE: Record<MlCoupon['status'], { label: string; variant: 'default' | 'accent' | 'destructive' | 'secondary' }> = {
  AVAILABLE: { label: 'Disponível', variant: 'secondary' },
  ACTIVE: { label: 'Ativo', variant: 'accent' },
  EXPIRED: { label: 'Expirado', variant: 'destructive' },
  EXHAUSTED: { label: 'Orçamento zerou', variant: 'destructive' },
};

export default function MlCouponsPage(): React.ReactElement {
  const qc = useQueryClient();
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: coupons, isLoading } = useQuery<MlCoupon[]>({
    queryKey: ['ml-coupons'],
    queryFn: () => clientFetch<MlCoupon[]>('/sources/MERCADOLIVRE/coupons'),
  });

  const sync = useMutation<SyncResp>({
    mutationFn: () =>
      clientFetch<SyncResp>('/sources/MERCADOLIVRE/coupons/sync', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ml-coupons'] }),
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const generate = useMutation<MlCoupon, Error, { id: string; code: string }>({
    mutationFn: ({ id, code }) =>
      clientFetch<MlCoupon>(`/sources/MERCADOLIVRE/coupons/${id}/generate`, {
        method: 'POST',
        body: { code },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ml-coupons'] });
      setGeneratingId(null);
      setCode('');
      setErrorMsg(null);
    },
    onError: (err) => setErrorMsg(err.message),
  });

  const toggle = useMutation<MlCoupon, Error, { id: string; enabled: boolean }>({
    mutationFn: ({ id, enabled }) =>
      clientFetch<MlCoupon>(`/sources/MERCADOLIVRE/coupons/${id}`, {
        method: 'PATCH',
        body: { enabled },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ml-coupons'] }),
  });

  const prefix = useMemo(() => coupons?.find((c) => c.prefix)?.prefix ?? null, [coupons]);
  const active = coupons?.filter((c) => c.alias && c.status === 'ACTIVE') ?? [];
  const available = coupons?.filter((c) => !c.alias && c.status === 'AVAILABLE') ?? [];
  const inactive = coupons?.filter((c) => c.status === 'EXPIRED' || c.status === 'EXHAUSTED') ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cupons Mercado Livre"
        description={
          prefix
            ? `Seu prefixo: #${prefix} — todos os códigos gerados terão esse prefixo automaticamente`
            : 'Gerencie cupons patrocinados por vendedores do ML. Sincronize pra ver os disponíveis.'
        }
        actions={
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={`mr-2 h-4 w-4 ${sync.isPending ? 'animate-spin' : ''}`} />
            {sync.isPending ? 'Sincronizando...' : 'Sincronizar do ML'}
          </Button>
        }
      />

      {sync.data && (
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">
            Última sync: {sync.data.upserted} cupons disponíveis · {sync.data.generated} já ativos
          </CardContent>
        </Card>
      )}

      {errorMsg && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {errorMsg}
          </CardContent>
        </Card>
      )}

      <CouponSection
        title="Cupons ativos"
        headerIcon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        description="Você já gerou esses códigos. Use no caption do WhatsApp pra dar desconto extra ao comprador."
        coupons={active}
        isLoading={isLoading}
        emptyText="Você ainda não gerou nenhum cupom. Veja a lista de disponíveis abaixo."
        onToggle={(id, enabled) => toggle.mutate({ id, enabled })}
      />

      <CouponSection
        title="Cupons disponíveis"
        headerIcon={<Tag className="h-4 w-4 text-primary" />}
        description="Vendedores patrocinaram esses descontos. Gere seu código personalizado e divulgue."
        coupons={available}
        isLoading={isLoading}
        emptyText='Sincronize com o ML pra ver cupons disponíveis (botão "Sincronizar" acima).'
        onGenerate={(id) => {
          setGeneratingId(id);
          setCode('');
          setErrorMsg(null);
        }}
        generatingId={generatingId}
        codeInput={code}
        onCodeChange={setCode}
        onConfirmGenerate={(id) => {
          if (code.trim().length < 3) {
            setErrorMsg('Sufixo precisa ter pelo menos 3 caracteres (A-Z, 0-9).');
            return;
          }
          generate.mutate({ id, code: code.trim().toUpperCase() });
        }}
        onCancelGenerate={() => {
          setGeneratingId(null);
          setCode('');
          setErrorMsg(null);
        }}
        prefix={prefix}
        generatePending={generate.isPending}
      />

      {inactive.length > 0 && (
        <CouponSection
          title="Cupons inativos"
          headerIcon={<Clock className="h-4 w-4 text-muted-foreground" />}
          description="Expirados ou com orçamento esgotado. Mantidos pra histórico."
          coupons={inactive}
          isLoading={false}
          emptyText=""
        />
      )}
    </div>
  );
}

type SectionProps = {
  title: string;
  headerIcon: React.ReactNode;
  description: string;
  coupons: MlCoupon[];
  isLoading: boolean;
  emptyText: string;
  onGenerate?: (id: string) => void;
  onToggle?: (id: string, enabled: boolean) => void;
  generatingId?: string | null;
  codeInput?: string;
  onCodeChange?: (v: string) => void;
  onConfirmGenerate?: (id: string) => void;
  onCancelGenerate?: () => void;
  prefix?: string | null;
  generatePending?: boolean;
};

function CouponSection(props: SectionProps): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {props.headerIcon}
          {props.title}
          <span className="text-xs text-muted-foreground">({props.coupons.length})</span>
        </CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.isLoading ? (
          <SkeletonRows count={3} />
        ) : props.coupons.length === 0 ? (
          <EmptyState
            icon={Tag}
            title="Nada aqui ainda"
            description={props.emptyText}
          />
        ) : (
          props.coupons.map((c) => (
            <CouponRow
              key={c.id}
              coupon={c}
              isGenerating={props.generatingId === c.id}
              codeInput={props.codeInput ?? ''}
              prefix={props.prefix ?? null}
              onCodeChange={props.onCodeChange}
              onConfirmGenerate={props.onConfirmGenerate}
              onCancelGenerate={props.onCancelGenerate}
              onGenerate={props.onGenerate}
              onToggle={props.onToggle}
              generatePending={props.generatePending}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function CouponRow(props: {
  coupon: MlCoupon;
  isGenerating: boolean;
  codeInput: string;
  prefix: string | null;
  onCodeChange?: (v: string) => void;
  onConfirmGenerate?: (id: string) => void;
  onCancelGenerate?: () => void;
  onGenerate?: (id: string) => void;
  onToggle?: (id: string, enabled: boolean) => void;
  generatePending?: boolean;
}): React.ReactElement {
  const { coupon: c } = props;
  const status = STATUS_BADGE[c.status];
  const expiresAt = new Date(c.expirationDate);
  const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return (
    <div className="rounded-lg border bg-card/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{c.title}</span>
            <Badge variant={status.variant}>{status.label}</Badge>
            {c.alias && (
              <Badge variant="default" className="font-mono">
                {c.alias}
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            Vendedor: <span className="font-medium text-foreground">{c.seller}</span>
            {' · '}
            Orçamento: <span className="font-medium text-foreground">{formatBRL(c.remainingBudget)}</span>
            {' · '}
            Vence em {daysLeft > 0 ? `${daysLeft} dia${daysLeft > 1 ? 's' : ''}` : 'expirado'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!c.alias && props.onGenerate && !props.isGenerating && (
            <Button size="sm" onClick={() => props.onGenerate!(c.id)}>
              <Plus className="mr-1 h-4 w-4" />
              Gerar código
            </Button>
          )}
          {c.alias && props.onToggle && (
            <Button
              size="sm"
              variant={c.enabled ? 'outline' : 'default'}
              onClick={() => props.onToggle!(c.id, !c.enabled)}
            >
              {c.enabled ? 'Desativar' : 'Ativar'}
            </Button>
          )}
        </div>
      </div>

      {props.isGenerating && (
        <div className="mt-4 space-y-3 rounded-md bg-muted/40 p-3">
          <Label className="text-sm">
            Sufixo do código (3-20 caracteres, só A-Z e 0-9)
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">
              #{props.prefix ?? '???'}
            </span>
            <Input
              autoFocus
              value={props.codeInput}
              onChange={(e) => props.onCodeChange?.(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="EX: PROMO20"
              className="max-w-xs font-mono"
              maxLength={20}
            />
            <Button
              size="sm"
              onClick={() => props.onConfirmGenerate?.(c.id)}
              disabled={props.generatePending || props.codeInput.trim().length < 3}
            >
              {props.generatePending ? 'Gerando...' : 'Confirmar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => props.onCancelGenerate?.()}>
              Cancelar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Código final que o comprador vai usar:{' '}
            <span className="font-mono font-medium text-foreground">
              #{props.prefix ?? '???'}{props.codeInput || 'SEUSUFIXO'}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
