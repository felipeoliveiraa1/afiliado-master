import * as React from 'react';
import { cn } from '@/lib/utils';

type Kind = 'SHOPEE' | 'AMAZON' | 'MERCADOLIVRE' | string;

const STYLES: Record<string, { className: string; label: string; mark: string }> = {
  SHOPEE: {
    label: 'Shopee',
    mark: 'S',
    className: 'bg-orange-500/10 text-orange-600 ring-1 ring-orange-500/20 dark:text-orange-400',
  },
  AMAZON: {
    label: 'Amazon',
    mark: 'A',
    className: 'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300',
  },
  MERCADOLIVRE: {
    label: 'Mercado Livre',
    mark: 'ML',
    className: 'bg-yellow-500/10 text-yellow-700 ring-1 ring-yellow-500/20 dark:text-yellow-300',
  },
  PROMOBIT: {
    label: 'Promobit',
    mark: 'P',
    className: 'bg-violet-500/10 text-violet-700 ring-1 ring-violet-500/20 dark:text-violet-300',
  },
};

export function SourceBadge({
  kind,
  size = 'default',
  className,
}: {
  kind: Kind;
  size?: 'sm' | 'default';
  className?: string;
}): React.ReactElement {
  const cfg = STYLES[kind] ?? { label: kind, mark: '?', className: 'bg-muted text-muted-foreground' };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        cfg.className,
        className,
      )}
    >
      <span className="grid size-4 place-items-center rounded-full bg-current/15 text-[9px] font-semibold leading-none">
        {cfg.mark}
      </span>
      {cfg.label}
    </span>
  );
}
