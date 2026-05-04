import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Símbolo do afiliado-master: um diamante geométrico em accent.
 * Funciona em sidebar, login, favicon (re-render como SVG estático em /favicon.svg também).
 */
export function LogoMark({
  className,
  size = 28,
}: {
  className?: string;
  size?: number;
}): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="hsl(217 91% 60%)" />
          <stop offset="1" stopColor="hsl(263 83% 65%)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#logo-grad)" />
      <path
        d="M9.6 22.4 16 9.6l6.4 12.8h-3.2l-3.2-6.4-3.2 6.4H9.6Z"
        fill="white"
        fillOpacity="0.95"
      />
      <circle cx="16" cy="22.4" r="1.4" fill="hsl(217 91% 60%)" />
    </svg>
  );
}

export function LogoFull({ className }: { className?: string }): React.ReactElement {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <LogoMark size={26} />
      <span className="text-[15px]">
        afiliado<span className="text-accent">.master</span>
      </span>
    </span>
  );
}
