'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { LogoFull } from '@/components/ui/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { SidebarContent } from '@/components/sidebar';

export function MobileTopbar(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Fecha drawer quando rota muda (clicou em link)
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-background/85 px-3 py-2.5 backdrop-blur">
      <div className="flex items-center gap-1.5">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" className="p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <Link href="/dashboard" aria-label="afiliado.master" className="ml-1">
          <LogoFull />
        </Link>
      </div>
      <ThemeToggle />
    </header>
  );
}
