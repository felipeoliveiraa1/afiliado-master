'use client';

import * as React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'system', label: 'Sistema', icon: Monitor },
  { value: 'dark', label: 'Escuro', icon: Moon },
] as const;

export function ThemeToggle({ className }: { className?: string }): React.ReactElement {
  const { theme, setTheme } = useTheme();
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border bg-muted/30 p-0.5 text-muted-foreground',
        className,
      )}
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-label={`Tema ${opt.label}`}
            onClick={() => setTheme(opt.value)}
            className={cn(
              'grid size-7 place-items-center rounded-full transition-all',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
