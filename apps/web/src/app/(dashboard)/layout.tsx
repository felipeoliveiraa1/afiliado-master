import { Sidebar } from '@/components/sidebar';
import { MobileTopbar } from '@/components/mobile-topbar';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const session = await auth();
  if (!session) redirect('/login');
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopbar />
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className="page-shell">{children}</div>
        </main>
      </div>
    </div>
  );
}
