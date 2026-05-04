'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { AlertCircle, Lock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { LogoFull } from '@/components/ui/logo';

export function LoginForm(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await signIn('credentials', { email, password, redirect: false });
    setSubmitting(false);
    if (result?.error) {
      setError('Credenciais inválidas — verifique e-mail e senha.');
      return;
    }
    router.push(params.get('callbackUrl') ?? '/dashboard');
    router.refresh();
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background mesh */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid-fade [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-radial opacity-70" />

      <div className="relative grid min-h-screen place-items-center px-4 py-10">
        <div className="w-full max-w-sm space-y-6 animate-fade-in-up">
          <div className="flex flex-col items-center text-center">
            <LogoFull className="text-lg" />
            <p className="mt-2 text-sm text-muted-foreground">painel privado · single user</p>
          </div>

          <Card className="shadow-pop border-border/60">
            <CardContent className="px-6 pt-6 pb-6">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    E-mail
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="voce@exemplo.com"
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="password"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Senha
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="pl-9"
                    />
                  </div>
                </div>

                {error ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <p>{error}</p>
                  </div>
                ) : null}

                <Button type="submit" variant="accent" className="w-full" loading={submitting}>
                  {submitting ? 'Entrando…' : 'Entrar no painel'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            Acesso restrito ao owner. Esqueceu a senha? Edite{' '}
            <code className="rounded bg-muted px-1 py-0.5">OWNER_PASSWORD_HASH_B64</code> no .env.
          </p>
        </div>
      </div>
    </div>
  );
}
