import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Símbolo do afiliado-master: cifrão estilizado dentro de gradiente verde — representa
 * monetização/conversão. Funciona em sidebar, login, favicon.
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
          <stop offset="0" stopColor="hsl(152 76% 42%)" />
          <stop offset="1" stopColor="hsl(168 76% 38%)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#logo-grad)" />
      <path
        d="M17.2 7.2v2.05c2.3.18 4.05 1.42 4.05 3.55h-2.6c0-.85-.7-1.45-1.95-1.55v3.3c2.95.5 4.55 1.45 4.55 4 0 2.4-1.85 3.75-4.55 3.95v2.1h-2.4v-2.1c-2.6-.2-4.45-1.55-4.45-3.95h2.6c0 .9.8 1.55 2.25 1.7v-3.45c-2.85-.5-4.55-1.4-4.55-3.85 0-2.25 1.8-3.55 4.55-3.7V7.2h2.4Zm-2.4 4.05c-1.25.1-1.95.65-1.95 1.45 0 .7.5 1.2 1.95 1.55v-3Zm2.4 5.95v3.15c1.35-.1 2.1-.65 2.1-1.55 0-.85-.55-1.3-2.1-1.6Z"
        fill="white"
        fillOpacity="0.97"
      />
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
