'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, KeySquare, ShieldCheck, XCircle } from 'lucide-react';
import { clientFetch } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Kbd } from '@/components/ui/kbd';
import { PageHeader } from '@/components/ui/page-header';
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
      <PageHeader
        title={title}
        description="Cole o cookie da sessão logada no painel para habilitar conversão automática URL → link de afiliado."
        badge={
          <Badge variant="accent" dot>
            <KeySquare className="size-3" /> cookie hijacking
          </Badge>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>1 · Como pegar o cookie</CardTitle>
          <CardDescription>Funciona melhor pelo desktop.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2.5 text-sm">
            <Step n={1}>
              Abra{' '}
              <a
                href={panelUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                {panelUrl}
                <ExternalLink className="size-3.5" />
              </a>{' '}
              logado na sua conta de afiliado.
            </Step>
            <Step n={2}>
              Pressione <Kbd>F12</Kbd> para abrir o DevTools.
            </Step>
            <Step n={3}>
              Vá em <strong>Network</strong> (Rede), pressione <Kbd>F5</Kbd> para recarregar e selecione a{' '}
              <strong>primeira linha</strong> da listagem.
            </Step>
            <Step n={4}>
              No painel lateral abra <strong>Headers → Request Headers</strong> e encontre{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">cookie:</code>.
            </Step>
            <Step n={5}>
              Triple-click no valor para selecionar tudo, copie e cole abaixo.
            </Step>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2 · Colar no .env</CardTitle>
          <CardDescription>
            Cole o cookie completo no <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">.env</code>{' '}
            do <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">apps/api</code>:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={cookieValue}
            onChange={(e) => setCookieValue(e.target.value)}
            placeholder={`${envVarName}=k1=v1; k2=v2; ...`}
            className="font-mono text-xs h-40"
          />
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(`${envVarName}=${cookieValue}`)}
              disabled={!cookieValue}
            >
              Copiar linha pronta
            </Button>
            <p className="text-xs text-muted-foreground">
              Por segurança esta tela <strong>não envia</strong> o cookie pelo browser. Cole manualmente em{' '}
              <code className="rounded bg-muted px-1 font-mono">apps/api/.env</code> e reinicie o backend.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            3 · Validar
          </CardTitle>
          <CardDescription>
            Aciona o backend pra chamar o endpoint de validação. Resposta verde = cookie OK.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="accent"
            onClick={() => validateMutation.mutate()}
            loading={validateMutation.isPending}
          >
            Validar agora
          </Button>

          {validateMutation.data ? (
            validateMutation.data.valid ? (
              <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                <div>
                  <Badge variant="success">Validação completa</Badge>
                  <p className="mt-2 text-success-soft-foreground">
                    Afiliado: <strong>{validateMutation.data.affiliateName ?? '—'}</strong>
                    {validateMutation.data.tag ? ` · tag: ${validateMutation.data.tag}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Verificado em {formatDate(validateMutation.data.checkedAt)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm">
                <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div>
                  <Badge variant="destructive">Cookie inválido</Badge>
                  <p className="mt-2 text-destructive-soft-foreground">
                    {validateMutation.data.errorMessage}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Verificado em {formatDate(validateMutation.data.checkedAt)}
                  </p>
                </div>
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

function Step({ n, children }: { n: number; children: React.ReactNode }): React.ReactElement {
  return (
    <li className="flex items-start gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-soft-foreground">
        {n}
      </span>
      <div className="flex-1 leading-relaxed">{children}</div>
    </li>
  );
}
