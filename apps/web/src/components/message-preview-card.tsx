'use client';

import { useQuery } from '@tanstack/react-query';
import { ImageOff, MessageSquareText } from 'lucide-react';
import { clientFetch } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

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

export function MessagePreviewCard({
  offerId,
  channelId,
  title = 'Preview da mensagem',
}: Props): React.ReactElement {
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
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareText className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription>Texto exato que sai no WhatsApp (com hook line da IA quando disponível).</CardDescription>
      </CardHeader>
      <CardContent>
        {preview.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : preview.error ? (
          <EmptyState
            title="Sem oferta com link de afiliado"
            description="Cadastre um shortlink em Pendentes para habilitar o preview."
          />
        ) : preview.data ? (
          <WhatsAppBubble
            imageUrl={preview.data.offer.imageUrl}
            text={preview.data.text}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function WhatsAppBubble({ imageUrl, text }: { imageUrl: string | null; text: string }): React.ReactElement {
  return (
    <div className="rounded-2xl bg-[#e5ddd5] p-3 dark:bg-[#0b141a]">
      <div className="ml-auto max-w-[420px] overflow-hidden rounded-2xl rounded-tr-sm bg-[#dcf8c6] shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] dark:bg-[#005c4b]">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="aspect-square w-full object-cover" />
        ) : (
          <div className="grid aspect-square place-items-center bg-zinc-200">
            <ImageOff className="size-8 text-zinc-500" />
          </div>
        )}
        <div className="px-3 py-2.5">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-snug text-zinc-900 dark:text-zinc-50">
            {text}
          </pre>
          <p className="mt-1.5 text-right text-[11px] text-zinc-700/70 dark:text-zinc-300/70">
            agora · enviada
          </p>
        </div>
      </div>
    </div>
  );
}
