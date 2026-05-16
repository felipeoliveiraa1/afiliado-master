'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Cookie,
  EyeOff,
  Eye,
  Save,
  Settings as SettingsIcon,
  Shield,
  Smartphone,
  Tag,
  Wand2,
  Webhook,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { clientFetch } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { PageHeader } from '@/components/ui/page-header';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

type Section =
  | 'evolution'
  | 'mercadolivre_panel'
  | 'shopee_panel'
  | 'marketplaces'
  | 'antiban'
  | 'automation'
  | 'admin'
  | 'landing';

type SectionMeta = {
  key: Section;
  title: string;
  description: string;
  icon: LucideIcon;
  fields: FieldDef[];
  /** Emoji ou letra grande pra header do card (visual rápido). */
  badge?: string;
  /** "Pra que serve" em 1 frase — exibido no card compacto. */
  shortHint?: string;
  /** Campo chave pra detectar "configurado" (não-vazio = ✅). */
  configuredKey?: string;
};

type FieldDef = {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'number' | 'textarea' | 'boolean';
  placeholder?: string;
  hint?: string;
  secret?: boolean;
};

const SECTIONS: SectionMeta[] = [
  {
    key: 'evolution',
    title: 'Evolution API (WhatsApp)',
    description: 'Conexão com a sua Evolution. URL + API key + nome da instância default.',
    icon: Smartphone,
    fields: [
      { key: 'apiUrl', label: 'API URL', placeholder: 'https://sua-evolution.exemplo.com' },
      { key: 'apiKey', label: 'API Key', secret: true, type: 'password' },
      { key: 'defaultInstance', label: 'Instância default', placeholder: 'afiliado-master-1' },
    ],
  },
  {
    key: 'mercadolivre_panel',
    title: 'Mercado Livre Panel (cookie)',
    description: 'Cookie do painel afiliados-home + tag default. Sem isso a auto-conversão URL → meli.la não funciona.',
    icon: Cookie,
    fields: [
      { key: 'autoEnabled', label: 'Auto-gerar shortlinks', type: 'boolean' },
      { key: 'cookie', label: 'Cookie completo', secret: true, type: 'textarea', hint: 'Cole o VALOR do header Cookie (começa em _ga=... ou _hjSession...). Sem prefixo MERCADOLIVRE_PANEL_COOKIE=.' },
      { key: 'defaultTag', label: 'Default tag', placeholder: 'ofpXXXXX (autodetectado se vazio)' },
      { key: 'dailyLimit', label: 'Limite diário', type: 'number' },
      { key: 'minIntervalSec', label: 'Intervalo mín. (s)', type: 'number' },
      { key: 'maxIntervalSec', label: 'Intervalo máx. (s)', type: 'number' },
    ],
  },
  // Shopee Panel (cookie hijacking) — REMOVIDO da UI. Open API GraphQL
  // (App ID + Secret) substitui completamente. Código mantido em
  // shopee_panel.ts como dead-stub pra não quebrar imports antigos.
  {
    key: 'marketplaces',
    title: '🟡 Mercado Livre',
    description:
      'Tag de afiliado, scraper opcional. O cookie do painel ML é configurado em /sources/mercadolivre/cookie (não aqui).',
    icon: Tag,
    fields: [
      {
        key: 'mercadoLivreAffiliateTag',
        label: 'ML affiliate tag',
        placeholder: 'ofpXXXXX',
        hint: 'Tag automática vinda do cookie ML — só edite se souber o que está fazendo.',
      },
      {
        key: 'mercadoLivreScraper',
        label: 'Scraper ML (public-api | apify)',
        placeholder: 'public-api',
        hint: 'public-api = API pública grátis. apify = via Apify (paga, requer apifyToken abaixo).',
      },
      {
        key: 'apifyToken',
        label: 'Apify Token (só se scraper=apify)',
        secret: true,
        type: 'password',
        hint: 'Necessário APENAS quando mercadoLivreScraper=apify. Vazio se usa public-api.',
      },
      {
        key: 'apifyMercadoLivreActor',
        label: 'Actor Apify ML',
        placeholder: 'apify~mercadolibre-scraper',
        hint: 'Default: apify~mercadolibre-scraper.',
      },
      {
        key: 'mercadoLivreApifyStartUrls',
        label: 'Start URLs Apify ML (CSV)',
        type: 'textarea',
        hint: 'URLs do ML pra Apify processar (só se scraper=apify).',
      },
    ],
  },
  {
    key: 'marketplaces',
    title: '🟠 Shopee',
    description:
      'Open API GraphQL — credenciais oficiais do programa de afiliados Shopee BR (https://affiliate.shopee.com.br).',
    icon: Tag,
    fields: [
      {
        key: 'shopeeAppId',
        label: 'Shopee App ID',
        placeholder: '15XXXXXXXXX',
        hint: 'Cadastre-se em https://affiliate.shopee.com.br/open_api pra obter App ID + Secret.',
      },
      {
        key: 'shopeeAppSecret',
        label: 'Shopee App Secret',
        secret: true,
        type: 'password',
        hint: 'Vem junto do App ID. NUNCA commite. Mascarado após salvar.',
      },
    ],
  },
  {
    key: 'marketplaces',
    title: '🔵 Amazon',
    description:
      'PA-API 5.0 oficial. Liberado APÓS 10 vendas qualificadas em 180 dias. Antes disso o provider fica "disabled" e o cron não fetcha.',
    icon: Tag,
    fields: [
      {
        key: 'amazonProvider',
        label: 'Provider Amazon (disabled | paapi)',
        placeholder: 'disabled',
        hint: 'Default disabled (não fetcha). Mude pra "paapi" só quando tiver as credenciais PA-API.',
      },
      {
        key: 'amazonAffiliateTag',
        label: 'Amazon affiliate tag (legado)',
        placeholder: 'seunome-20',
        hint: 'Tag de afiliado. Usado como fallback se Partner Tag PA-API estiver vazio.',
      },
      {
        key: 'amazonPaapiAccessKey',
        label: 'PA-API Access Key',
        secret: true,
        type: 'password',
        hint: 'Liberado em https://webservices.amazon.com/paapi5/documentation/register-for-pa-api.html após 10 vendas qualificadas.',
      },
      {
        key: 'amazonPaapiSecretKey',
        label: 'PA-API Secret Key',
        secret: true,
        type: 'password',
        hint: 'Vem junto da Access Key.',
      },
      {
        key: 'amazonPaapiPartnerTag',
        label: 'PA-API Partner Tag',
        placeholder: 'seunome-20',
        hint: 'Mesmo do amazonAffiliateTag normalmente.',
      },
      {
        key: 'amazonPaapiHost',
        label: 'PA-API Host',
        placeholder: 'webservices.amazon.com.br',
        hint: 'Default Brasil. US: webservices.amazon.com',
      },
      {
        key: 'amazonPaapiRegion',
        label: 'PA-API Region',
        placeholder: 'us-east-1',
        hint: 'Default us-east-1 funciona pra todos os marketplaces.',
      },
      {
        key: 'amazonPaapiBrowseNodes',
        label: 'BrowseNodes (CSV de IDs)',
        type: 'textarea',
        placeholder: '17873924011, 17873925011, 17873929011',
        hint: 'IDs de categoria. Cada node vira 1 SearchItems com SortBy=Featured (proxy bestseller). Achar IDs: navegue na Amazon BR, ID está na URL (node=NNNN).',
      },
      {
        key: 'amazonPaapiMinDiscount',
        label: 'PA-API min desconto %',
        type: 'number',
        hint: 'Filtro MinSavingPercent. Default 20 = só produtos com ≥20% off.',
      },
    ],
  },
  {
    key: 'antiban',
    title: 'Anti-ban (dispatcher WhatsApp)',
    description: 'Janela de horário, jitter e limite por instância pra parecer humano.',
    icon: Shield,
    fields: [
      { key: 'typingMinSec', label: '⌨️ "Digitando..." mín (s)', type: 'number', hint: 'Tempo MÍNIMO do efeito "digitando..." antes da mensagem aparecer no grupo. Default 3s. Humano digita uma frase em ~3-5s.' },
      { key: 'typingMaxSec', label: '⌨️ "Digitando..." máx (s)', type: 'number', hint: 'Tempo MÁXIMO. Default 8s. Sistema escolhe valor aleatório entre min e max pra parecer natural.' },
      { key: 'minIntervalSec', label: 'Jitter intervalo mín (s) — legado', type: 'number', hint: 'Não usado mais pelo dispatcher (substituído por intervalMinutes da campanha). Mantido pra compat.' },
      { key: 'maxIntervalSec', label: 'Jitter intervalo máx (s) — legado', type: 'number', hint: 'Idem.' },
      { key: 'dailyLimitPerInstance', label: 'Limite diário por instância', type: 'number', hint: 'Máx mensagens por canal/dia (FALLBACK quando campanha não define). Default 300.' },
      { key: 'windowStartHour', label: 'Janela início BRT (FALLBACK)', type: 'number', hint: 'Default 8. Override por campanha em /campaigns.' },
      { key: 'windowEndHour', label: 'Janela fim BRT (FALLBACK)', type: 'number', hint: 'Default 22. Override por campanha em /campaigns.' },
    ],
  },
  {
    key: 'automation',
    title: 'Automação (cron)',
    description: 'Liga/desliga e ajusta os jobs automáticos. Mudanças tomam efeito no próximo tick (~1min).',
    icon: Clock,
    fields: [
      { key: 'fetchEnabled', label: 'Captação automática', type: 'boolean', hint: 'Cron que busca novas ofertas das Sources habilitadas' },
      { key: 'fetchIntervalMin', label: 'Intervalo de captação (min)', type: 'number', hint: 'A cada quantos min rodar fetch em todas as sources habilitadas. Default 30. PA-API e Open API são grátis, sem necessidade de throttle especial.' },
      { key: 'campaignsEnabled', label: 'Disparo automático de campanhas', type: 'boolean', hint: 'Cron checa cada minuto quais campanhas vencidas (intervalMinutes da campanha) e dispara' },
      { key: 'cookieHealthEnabled', label: 'Health check diário dos cookies', type: 'boolean', hint: 'Valida cookie ML/Shopee 1x por dia, alerta no grupo admin se expirou' },
      { key: 'cookieHealthHour', label: 'Hora do health check (0-23)', type: 'number' },
    ],
  },
  {
    key: 'admin',
    title: 'Admin',
    description: 'Grupo WA pra alertas + origens permitidas (CORS).',
    icon: Wand2,
    fields: [
      { key: 'adminAlertGroupId', label: 'Grupo WA pra alertas', placeholder: '120363xxxxxx@g.us' },
      { key: 'webOriginUrl', label: 'CORS allowed origins', hint: 'Suporta wildcard ex: https://*.vercel.app,https://meu-dominio.com' },
    ],
  },
  {
    key: 'landing',
    title: '🚀 Landing Page (/)',
    description: 'Edita a página pública sem rebuild. Múltiplos grupos = rotação automática (cada visita pega 1 random).',
    icon: Wand2,
    fields: [
      { key: 'groupLinks', label: 'Links de grupos WhatsApp (CSV)', type: 'textarea', placeholder: 'https://chat.whatsapp.com/Cn3t4N0gTpF5c0K4hcDN8F', hint: 'Cola 1 ou MAIS links separados por vírgula. Quando houver mais de 1, sistema escolhe aleatoriamente em cada visita (distribui entrada).' },
      { key: 'totalVagas', label: 'Total de vagas exibido', type: 'number', hint: 'Usado na barra de progresso. Default 500.' },
      { key: 'vagasBase', label: 'Vagas iniciais (já preenchidas)', type: 'number', hint: 'Onde a barra começa. Default 423. Sobe sozinho 1-2 a cada 8-25s pra simular demanda.' },
      { key: 'deadlineSeconds', label: 'Timer countdown (segundos)', type: 'number', hint: '120 = 2min, 600 = 10min, 3600 = 1h. Default 120.' },
      { key: 'headline', label: 'Headline', placeholder: 'Achadinhos de mãe pra mãe 💕' },
      { key: 'subheadline', label: 'Subheadline', placeholder: 'Promoções selecionadas com cupons exclusivos direto no seu WhatsApp.' },
      { key: 'metaPixelId', label: 'Meta Pixel ID', placeholder: '1015768407789187', hint: 'ID numérico do pixel do Facebook/Meta. Vazio = pixel desativado. PageView dispara automaticamente; Lead dispara no clique do botão de entrar no grupo.' },
    ],
  },
];

export default function SettingsPage(): React.ReactElement {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<Record<Section, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((s) => [s.key, false])) as Record<Section, boolean>,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Cada serviço numa caixa. Clique em Configurar pra editar."
        badge={
          <Badge variant="accent" dot>
            <SettingsIcon className="size-3" /> live config
          </Badge>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.map((section, idx) => (
          <SectionTileCard
            key={`${section.key}-${idx}`}
            meta={section}
            onOpen={() => setOpenIdx(idx)}
          />
        ))}
      </div>

      {openIdx !== null && (
        <Dialog open onOpenChange={(o) => { if (!o) setOpenIdx(null); }}>
          <DialogContent size="lg" className="p-0">
            <SectionDialogContent
              meta={SECTIONS[openIdx]}
              revealed={revealed[SECTIONS[openIdx].key]}
              onToggleReveal={() =>
                setRevealed((r) => ({
                  ...r,
                  [SECTIONS[openIdx].key]: !r[SECTIONS[openIdx].key],
                }))
              }
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Card compacto da grid — ícone + título + descrição + botão Configurar.
 * Mostra badge de status (configurado/pendente) baseado em configuredKey.
 */
function SectionTileCard({
  meta,
  onOpen,
}: {
  meta: SectionMeta;
  onOpen: () => void;
}): React.ReactElement {
  const Icon = meta.icon;
  const query = useQuery<Record<string, unknown>>({
    queryKey: ['settings-tile', meta.key],
    queryFn: () => clientFetch<Record<string, unknown>>(`/settings/${meta.key}`),
    staleTime: 30_000,
  });

  // Heurística: campo configurado = primeiro field não-boolean preenchido (ou configuredKey)
  const isConfigured = (() => {
    if (!query.data) return null;
    if (meta.configuredKey) {
      const v = query.data[meta.configuredKey];
      return Boolean(v && String(v).trim().length > 0);
    }
    return meta.fields.some((f) => {
      if (f.type === 'boolean') return false;
      const v = query.data?.[f.key];
      return v && String(v).trim().length > 0;
    });
  })();

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-1 gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            {meta.badge ? (
              <span className="text-lg leading-none">{meta.badge}</span>
            ) : (
              <Icon className="size-5" />
            )}
          </div>
          {isConfigured === true ? (
            <Badge variant="success" dot>
              <CheckCircle2 className="size-3" /> configurado
            </Badge>
          ) : isConfigured === false ? (
            <Badge variant="warning" dot>
              pendente
            </Badge>
          ) : null}
        </div>
        <CardTitle className="text-base">{meta.title}</CardTitle>
        <CardDescription className="line-clamp-2 text-xs">
          {meta.shortHint ?? meta.description}
        </CardDescription>
      </CardHeader>
      <div className="border-t p-3">
        <Button onClick={onOpen} variant="soft" size="sm" className="w-full">
          <SettingsIcon className="size-3.5" /> Configurar
        </Button>
      </div>
    </Card>
  );
}

/**
 * Conteúdo do Dialog — herda lógica do antigo SectionCard.
 * Usa o mesmo Field render existente + save mutation.
 */
function SectionDialogContent({
  meta,
  revealed,
  onToggleReveal,
}: {
  meta: SectionMeta;
  revealed: boolean;
  onToggleReveal: () => void;
}): React.ReactElement {
  const Icon = meta.icon;
  const hasSecrets = meta.fields.some((f) => f.secret);
  const queryClient = useQueryClient();

  const query = useQuery<Record<string, unknown>>({
    queryKey: ['settings', meta.key, revealed],
    queryFn: () =>
      clientFetch<Record<string, unknown>>(`/settings/${meta.key}${revealed ? '?reveal=1' : ''}`),
  });

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!query.data) return;
    const hydrated: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(query.data)) {
      if (Array.isArray(v)) hydrated[k] = v.join('\n');
      else hydrated[k] = v;
    }
    setDraft(hydrated);
  }, [query.data]);

  const dirty = useMemo(() => {
    if (!query.data) return false;
    return JSON.stringify(draft) !== JSON.stringify(query.data);
  }, [draft, query.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const isMasked = (v: unknown): boolean =>
        typeof v === 'string' && v.includes('…') && /\(\d+ chars\)\s*$/.test(v);
      const cleanBody: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(draft)) {
        if (isMasked(v)) continue;
        if (meta.key === 'landing' && k === 'groupLinks' && typeof v === 'string') {
          cleanBody[k] = v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
          continue;
        }
        cleanBody[k] = v;
      }
      return clientFetch(`/settings/${meta.key}`, { method: 'PATCH', body: cleanBody });
    },
    onSuccess: () => {
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 3000);
      queryClient.invalidateQueries({ queryKey: ['settings', meta.key] });
      queryClient.invalidateQueries({ queryKey: ['settings-tile', meta.key] });
    },
  });

  const handleChange = (key: string, value: unknown): void => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            {meta.badge ? <span className="text-lg">{meta.badge}</span> : <Icon className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle>{meta.title}</DialogTitle>
            <DialogDescription className="text-xs">{meta.description}</DialogDescription>
          </div>
          {hasSecrets ? (
            <Button size="sm" variant="ghost" onClick={onToggleReveal}>
              {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {revealed ? 'Ocultar' : 'Mostrar'}
            </Button>
          ) : null}
        </div>
      </DialogHeader>
      <DialogBody>
        {query.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner label="Carregando…" />
          </div>
        ) : query.error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">
            <AlertCircle className="mt-0.5 size-4" />
            <p>{(query.error as Error).message}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {meta.fields.map((field) => (
                <Field
                  key={field.key}
                  field={field}
                  value={draft[field.key]}
                  revealed={revealed}
                  onChange={(v) => handleChange(field.key, v)}
                />
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 border-t pt-4">
              <div className="text-xs text-muted-foreground">
                {dirty ? (
                  <span className="text-warning-soft-foreground">● alterações não salvas</span>
                ) : savedAt ? (
                  <span className="inline-flex items-center gap-1 text-success-soft-foreground">
                    <CheckCircle2 className="size-3" /> salvo
                  </span>
                ) : (
                  <span>sincronizado</span>
                )}
              </div>
              <Button
                variant="accent"
                size="sm"
                disabled={!dirty}
                loading={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                <Save className="size-4" /> Salvar
              </Button>
            </div>
            {saveMutation.error ? (
              <p className="text-xs text-destructive">{(saveMutation.error as Error).message}</p>
            ) : null}
          </div>
        )}
      </DialogBody>
    </>
  );
}


function Field({
  field,
  value,
  revealed,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  revealed: boolean;
  onChange: (v: unknown) => void;
}): React.ReactElement {
  const isMaskedSecret =
    field.secret &&
    !revealed &&
    typeof value === 'string' &&
    value.includes('…') &&
    value.includes('chars)');

  if (field.type === 'boolean') {
    const checked = Boolean(value);
    return (
      <div className="space-y-1.5">
        <Label>{field.label}</Label>
        <div className="flex h-10 items-center">
          <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm">
            <span
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                checked ? 'bg-accent' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block size-4 transform rounded-full bg-background shadow-sm transition-transform ${
                  checked ? 'translate-x-[18px]' : 'translate-x-0.5'
                }`}
              />
            </span>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
              className="sr-only"
            />
            {checked ? 'ativado' : 'desativado'}
          </label>
        </div>
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className="space-y-1.5 md:col-span-2">
        <Label>{field.label}</Label>
        <Textarea
          value={isMaskedSecret ? '' : (value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isMaskedSecret ? `(salvo: ${value as string})` : field.placeholder}
          className="font-mono text-xs h-32"
        />
        {field.hint ? <p className="text-[11px] text-muted-foreground">{field.hint}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label>{field.label}</Label>
      <Input
        type={field.type === 'number' ? 'number' : field.type === 'password' && !revealed ? 'password' : 'text'}
        value={
          isMaskedSecret
            ? ''
            : value == null
              ? ''
              : typeof value === 'number'
                ? String(value)
                : String(value)
        }
        onChange={(e) =>
          onChange(field.type === 'number' ? (e.target.value ? Number(e.target.value) : 0) : e.target.value)
        }
        placeholder={isMaskedSecret ? `(salvo: ${value as string})` : field.placeholder}
      />
      {field.hint ? <p className="text-[11px] text-muted-foreground">{field.hint}</p> : null}
    </div>
  );
}
