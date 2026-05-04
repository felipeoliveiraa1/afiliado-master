import * as React from 'react';
import { cn } from '@/lib/utils';

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>): React.ReactElement {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-[5px] border border-border bg-muted/60 px-1.5 text-[10px] font-medium text-muted-foreground shadow-sm font-mono',
        className,
      )}
      {...props}
    />
  );
}
