'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  BarChart3,
  Cookie,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Megaphone,
  Send,
  Settings,
  ShoppingBag,
  Tag,
  Tags,
  Users,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LogoFull } from '@/components/ui/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    label: 'Visão geral',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/offers', label: 'Ofertas', icon: ShoppingBag },
      { href: '/offers/pending', label: 'Pendentes', icon: ListChecks },
    ],
  },
  {
    label: 'Disparo',
    items: [
      { href: '/disparos/novo', label: '🚀 Novo disparo (wizard)', icon: Zap },
      { href: '/campaigns', label: 'Campanhas', icon: Megaphone },
      { href: '/dispatches', label: 'Histórico de disparos', icon: Send },
      { href: '/channels', label: 'Canais (WhatsApp)', icon: Users },
      { href: '/niches', label: 'Nichos', icon: Tag },
    ],
  },
  {
    label: '🟡 Mercado Livre',
    items: [
      { href: '/sources/MERCADOLIVRE', label: 'Visão geral', icon: Tags },
      { href: '/sources/mercadolivre/cookie', label: 'Cookie (obrigatório)', icon: Cookie },
      { href: '/sources/mercadolivre/search', label: 'Busca por categoria', icon: BarChart3 },
      { href: '/sources/mercadolivre/coupons', label: 'Cupons', icon: Tag },
    ],
  },
  {
    label: '🟠 Shopee',
    items: [
      { href: '/sources/SHOPEE', label: 'Visão geral', icon: Tags },
      { href: '/sources/shopee/coupons', label: 'Cupons', icon: Tag },
    ],
  },
  {
    label: '🔵 Amazon',
    items: [
      { href: '/sources/AMAZON', label: 'Visão geral', icon: Tags },
    ],
  },
  {
    label: 'Sistema',
    items: [{ href: '/settings', label: 'Configurações', icon: Settings }],
  },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }): React.ReactElement {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all',
        active
          ? 'bg-accent-soft text-accent-soft-foreground font-medium shadow-sm'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      <Icon className={cn('size-4 shrink-0 transition-colors', active ? 'text-accent' : '')} />
      <span className="truncate">{item.label}</span>
      {item.badge ? (
        <span className="ml-auto rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
          {item.badge}
        </span>
      ) : null}
      {active ? (
        <span className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent" aria-hidden />
      ) : null}
    </Link>
  );
}

export function Sidebar(): React.ReactElement {
  const pathname = usePathname();
  const isActive = (href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-72 lg:shrink-0 lg:border-r lg:bg-card/40 lg:backdrop-blur lg:sticky lg:top-0 lg:h-screen">
      <div className="flex h-16 items-center border-b px-5">
        <Link href="/dashboard" aria-label="afiliado.master">
          <LogoFull />
        </Link>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(item.href)} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground text-xs font-semibold">
              <Zap className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Owner</p>
              <p className="truncate text-[11px] text-muted-foreground">painel privado</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-destructive-soft hover:text-destructive-soft-foreground"
        >
          <LogOut className="size-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}
