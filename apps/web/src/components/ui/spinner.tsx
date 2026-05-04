import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({
  className,
  size = 'md',
  label,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}): React.ReactElement {
  const sizeClass = size === 'sm' ? 'size-4' : size === 'lg' ? 'size-8' : 'size-5';
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-2', className)}>
      <Loader2 className={cn('animate-spin text-muted-foreground', sizeClass)} aria-hidden />
      {label ? <span className="text-sm text-muted-foreground">{label}</span> : null}
    </span>
  );
}
