'use client';

import { useQuery } from '@tanstack/react-query';
import { clientFetch } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type PreviewResponse = {
  text: string;
  offer: { id: string; title: string; imageUrl: string | null };
  variantUsed: { caption: string } | null;
};

type Props = {
  offerId?: string;
  channelId?: string;
  title?: string;
};

export function MessagePreviewCard({ offerId, channelId, title = 'Preview da mensagem' }: Props): React.ReactElement {
  const preview = useQuery<PreviewResponse>({
    queryKey: ['preview-message', offerId, channelId],
    queryFn: () =>
      clientFetch<PreviewResponse>('/channels/preview-message', {
        method: 'POST',
        body: { offerId, channelId },
      }),
    retry: false,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          Texto exato que sai no WhatsApp (com hook line da IA quando disponível).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {preview.isLoading ? (
          <p className="text-sm text-muted-foreground">Gerando preview...</p>
        ) : preview.error ? (
          <p className="text-sm text-destructive">
            Não há ofertas com link de afiliado para preview.{' '}
            <span className="text-muted-foreground">
              Cadastre um shortlink em /offers/pending pra habilitar.
            </span>
          </p>
        ) : preview.data ? (
          <div className="grid gap-4 md:grid-cols-[120px_1fr]">
            {preview.data.offer.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.data.offer.imageUrl}
                alt=""
                className="size-[120px] rounded-md object-cover bg-muted"
              />
            ) : (
              <div className="size-[120px] rounded-md bg-muted" />
            )}
            <div className="rounded-md bg-[#dcf8c6] p-3 text-sm font-mono whitespace-pre-wrap text-zinc-900 max-w-prose shadow-sm">
              {preview.data.text}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
