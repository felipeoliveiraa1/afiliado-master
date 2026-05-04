'use client';

import * as React from 'react';
import Link from 'next/link';
import { LogoFull } from '@/components/ui/logo';
import { ThemeToggle } from '@/components/theme-toggle';

export function MobileTopbar(): React.ReactElement {
  return (
    <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between border-b bg-background/80 px-4 py-3 backdrop-blur">
      <Link href="/dashboard" aria-label="afiliado.master">
        <LogoFull />
      </Link>
      <ThemeToggle />
    </header>
  );
}
