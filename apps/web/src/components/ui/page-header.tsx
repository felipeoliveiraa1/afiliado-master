import * as React from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  badge,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-4 animate-fade-in-up', className)}>
      <div className="min-w-0 flex-1">
        {badge ? <div className="mb-2">{badge}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground md:text-base text-balance">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
