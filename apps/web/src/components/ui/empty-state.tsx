import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center px-6 py-14 animate-fade-in',
        className,
      )}
    >
      {Icon ? (
        <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-soft-foreground ring-8 ring-accent-soft/30">
          <Icon className="size-5" aria-hidden />
        </div>
      ) : null}
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground text-balance">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
