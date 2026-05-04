import { Badge } from '@/components/ui/badge';

const STYLES: Record<string, { variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive'; label: string }> = {
  SHOPEE: { variant: 'warning', label: 'Shopee' },
  AMAZON: { variant: 'default', label: 'Amazon' },
  MERCADOLIVRE: { variant: 'success', label: 'Mercado Livre' },
  PROMOBIT: { variant: 'secondary', label: 'Promobit' },
};

export function SourceBadge({ kind }: { kind: string }): React.ReactElement {
  const cfg = STYLES[kind] ?? { variant: 'secondary' as const, label: kind };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
