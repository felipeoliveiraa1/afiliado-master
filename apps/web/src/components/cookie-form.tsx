'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { clientFetch } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { formatDate } from '@/lib/utils';
import type { CookieHealth } from '@afiliado-master/types';

type Props = {
  marketplace: 'SHOPEE' | 'MERCADOLIVRE';
  title: string;
  panelUrl: string;
  envVarName: string;
};

export function CookieForm({ marketplace, title, panelUrl, envVarName }: Props): React.ReactElement {
  const [cookieValue, setCookieValue] = useState('');

  const validateMutation = useMutation<CookieHealth>({
    mutationFn: () => clientFetch<CookieHealth>(`/sources/${marketplace}/validate-cookie`, { method: 'POST' }),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">
          Cole o cookie da sessão logada no painel para habilitar conversão automática URL → link de afiliado.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como pegar o cookie</CardTitle>
          <CardDescription>Passo a passo (precisa de computador):</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li>
              Abra <a href={panelUrl} target="_blank" rel="noreferrer" className="underline">{panelUrl}</a>{' '}
              logado na sua conta de afiliado.
            </li>
            <li>Pressione <kbd className="rounded bg-muted px-1">F12</kbd> para abrir o DevTools.</li>
            <li>
              Vá em <strong>Network</strong> (Rede) e pressione <kbd className="rounded bg-muted px-1">F5</kbd>{' '}
              para recarregar.
            </li>
            <li>Clique na <strong>primeira linha</strong> da listagem (a request principal da página).</li>
            <li>
              No painel lateral, abra <strong>Headers</strong> (Cabeçalhos) →{' '}
              <strong>Request Headers</strong> (Cabeçalhos de solicitação).
            </li>
            <li>
              Encontre o campo <code className="rounded bg-muted px-1">Cookie:</code>, dê três cliques no valor
              ao lado para selecionar tudo e copie.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Passo 1 — colar no .env</CardTitle>
          <CardDescription>
            Cole o cookie completo no <code className="rounded bg-muted px-1">.env</code> do{' '}
            <code className="rounded bg-muted px-1">apps/api</code>:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={cookieValue}
            onChange={(e) => setCookieValue(e.target.value)}
            placeholder={`${envVarName}=k1=v1; k2=v2; ...`}
            className="font-mono text-xs h-40"
          />
          <p className="text-xs text-muted-foreground">
            Por segurança esta tela <strong>não envia</strong> o cookie pelo browser. Cole manualmente em{' '}
            <code className="rounded bg-muted px-1">apps/api/.env</code> e reinicie o backend.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigator.clipboard.writeText(`${envVarName}=${cookieValue}`)}
            disabled={!cookieValue}
          >
            Copiar linha pronta
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Passo 2 — validar</CardTitle>
          <CardDescription>
            Aciona o backend para chamar o endpoint de validação. Resposta verde = cookie OK.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={() => validateMutation.mutate()} disabled={validateMutation.isPending}>
            {validateMutation.isPending ? 'Validando...' : 'Validar agora'}
          </Button>
          {validateMutation.data ? (
            validateMutation.data.valid ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <Badge variant="success">Validação completa</Badge>
                <p className="mt-2">
                  Afiliado: <strong>{validateMutation.data.affiliateName ?? '—'}</strong>
                  {validateMutation.data.tag ? ` · tag: ${validateMutation.data.tag}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  Verificado em {formatDate(validateMutation.data.checkedAt)}
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                <Badge variant="destructive">Cookie inválido</Badge>
                <p className="mt-2 text-destructive">{validateMutation.data.errorMessage}</p>
                <p className="text-xs text-muted-foreground">
                  Verificado em {formatDate(validateMutation.data.checkedAt)}
                </p>
              </div>
            )
          ) : null}
          {validateMutation.error ? (
            <p className="text-sm text-destructive">Erro: {(validateMutation.error as Error).message}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
