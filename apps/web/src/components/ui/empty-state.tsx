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
        <div className="relative mb-4">
          <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-accent/15 blur-xl" aria-hidden />
          <div className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent-soft-foreground ring-8 ring-accent-soft/30">
            <Icon className="size-6" aria-hidden />
          </div>
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
