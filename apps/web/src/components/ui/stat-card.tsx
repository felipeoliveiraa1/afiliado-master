import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'success' | 'warning' | 'destructive' | 'accent';

export function StatCard({
  label,
  value,
  hint,
  delta,
  icon: Icon,
  tone = 'default',
  className,
  loading,
}: {
  label: string;
  value: string | number;
  hint?: string;
  delta?: { value: number; suffix?: string; positiveIs?: 'good' | 'bad' };
  icon?: LucideIcon;
  tone?: Tone;
  className?: string;
  loading?: boolean;
}): React.ReactElement {
  const toneClass: Record<Tone, string> = {
    default: 'text-foreground',
    success: 'text-success-soft-foreground',
    warning: 'text-warning-soft-foreground',
    destructive: 'text-destructive-soft-foreground',
    accent: 'text-accent-soft-foreground',
  };
  const iconBg: Record<Tone, string> = {
    default: 'bg-muted text-muted-foreground',
    success: 'bg-success-soft text-success-soft-foreground',
    warning: 'bg-warning-soft text-warning-soft-foreground',
    destructive: 'bg-destructive-soft text-destructive-soft-foreground',
    accent: 'bg-accent-soft text-accent-soft-foreground',
  };
  const deltaPositive = delta && delta.value > 0;
  const deltaNegative = delta && delta.value < 0;
  const positiveIsGood = delta?.positiveIs !== 'bad';
  const deltaGood = positiveIsGood ? deltaPositive : deltaNegative;
  const deltaBad = positiveIsGood ? deltaNegative : deltaPositive;
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-card p-5 shadow-card transition-all hover:shadow-pop animate-fade-in-up',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {Icon ? (
          <div className={cn('grid size-8 place-items-center rounded-lg', iconBg[tone])}>
            <Icon className="size-4" aria-hidden />
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        {loading ? (
          <span className="inline-block h-9 w-20 animate-pulse rounded-md bg-muted" aria-hidden />
        ) : (
          <span className={cn('text-3xl font-semibold tracking-tight tabular-nums', toneClass[tone])}>
            {value}
          </span>
        )}
        {delta && !loading ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
              deltaGood && 'bg-success-soft text-success-soft-foreground',
              deltaBad && 'bg-destructive-soft text-destructive-soft-foreground',
              !deltaGood && !deltaBad && 'bg-muted text-muted-foreground',
            )}
          >
            {deltaPositive ? (
              <ArrowUp className="size-3" />
            ) : deltaNegative ? (
              <ArrowDown className="size-3" />
            ) : (
              <Minus className="size-3" />
            )}
            {Math.abs(delta.value)}
            {delta.suffix ?? ''}
          </span>
        ) : null}
      </div>
      {hint && !loading ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
