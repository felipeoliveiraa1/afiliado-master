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
  ShoppingBag,
  Tags,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/offers', label: 'Ofertas', icon: ShoppingBag },
  { href: '/offers/pending', label: 'Pendentes (manual)', icon: ListChecks },
  { href: '/sources/SHOPEE', label: 'Shopee', icon: Tags },
  { href: '/sources/AMAZON', label: 'Amazon', icon: Tags },
  { href: '/sources/MERCADOLIVRE', label: 'Mercado Livre', icon: Tags },
  { href: '/sources/PROMOBIT', label: 'Promobit', icon: Tags },
  { href: '/sources/mercadolivre/cookie', label: 'Cookie ML', icon: Cookie },
  { href: '/sources/shopee/cookie', label: 'Cookie Shopee', icon: Cookie },
  { href: '/sources/mercadolivre/search', label: 'Buscar ML por categoria', icon: BarChart3 },
  { href: '/channels', label: 'Canais (WA)', icon: Users },
  { href: '/campaigns', label: 'Campanhas', icon: Megaphone },
  { href: '/dispatches', label: 'Disparos', icon: Send },
] as const;

export function Sidebar(): React.ReactElement {
  const pathname = usePathname();
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r bg-card h-screen sticky top-0">
      <div className="px-4 py-5 border-b">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <div className="size-7 rounded-md bg-primary text-primary-foreground grid place-items-center text-xs">AM</div>
          <span>afiliado-master</span>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto py-3">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'mx-2 my-0.5 flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="size-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}
