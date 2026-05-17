'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { AlertCircle, Lock, Mail, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { LogoMark } from '@/components/ui/logo';

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
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Background gradient mesh — animação sutil de respiração */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `
            radial-gradient(at 20% 30%, hsl(var(--accent) / 0.18), transparent 50%),
            radial-gradient(at 80% 70%, hsl(var(--accent-vivid) / 0.15), transparent 50%),
            radial-gradient(at 50% 100%, hsl(var(--accent) / 0.1), transparent 60%)
          `,
        }}
      />
      {/* Grid pattern overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative grid min-h-screen place-items-center px-4 py-10">
        <div className="w-full max-w-sm space-y-6 animate-fade-in-up">
          {/* Logo destacado com glow */}
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-3">
              <div
                aria-hidden
                className="absolute inset-0 -z-10 scale-150 rounded-full bg-accent/30 blur-2xl"
              />
              <LogoMark size={56} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              afiliado<span className="text-gradient-accent">.master</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Painel privado · automação de afiliados
            </p>
          </div>

          <Card className="shadow-pop border-border/60 hero-gradient backdrop-blur-sm">
            <CardContent className="px-6 pt-6 pb-6">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <label
                    htmlFor="email"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
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
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
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
                    className="flex animate-fade-in items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <p>{error}</p>
                  </div>
                ) : null}

                <Button
                  type="submit"
                  variant="accent"
                  className="w-full"
                  size="lg"
                  loading={submitting}
                >
                  {submitting ? (
                    'Entrando…'
                  ) : (
                    <>
                      <Sparkles className="size-4" />
                      Entrar no painel
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            Acesso restrito ao owner.
          </p>
        </div>
      </div>
    </div>
  );
}
