import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Animated placeholder block. Composição:
 *   <Skeleton className="h-4 w-32" />
 *   <SkeletonRows count={5} />
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-muted/60',
        'before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer',
        'before:bg-gradient-to-r before:from-transparent before:via-foreground/[0.04] before:to-transparent',
        className,
      )}
      {...props}
    />
  );
}

export function SkeletonRows({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function SkeletonCard(): React.ReactElement {
  return (
    <div className="rounded-xl border bg-card p-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-8 w-16" />
      <Skeleton className="mt-2 h-3 w-32" />
    </div>
  );
}
