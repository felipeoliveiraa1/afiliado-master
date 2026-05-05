'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';

type Props = {
  /** Aceita 1 ou múltiplos. Quando > 1, escolhe aleatório no mount. */
  groupLinks: string[];
  totalVagas: number;
  vagasBase: number;
  deadlineSeconds: number;
  headline?: string;
  subheadline?: string;
  /** Meta Pixel ID. Vazio = pixel desativado. */
  metaPixelId?: string;
};

// fbq global injetado pelo script do Meta Pixel (definido em runtime).
declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export function PromoLanding({
  groupLinks,
  totalVagas,
  vagasBase,
  deadlineSeconds,
  headline,
  subheadline,
  metaPixelId,
}: Props): React.ReactElement {
  // Rotação aleatória entre múltiplos grupos. Mantém estável durante toda a
  // sessão (não muda no re-render). Cada visita pega 1 grupo random.
  const [groupLink] = useState<string>(() => {
    if (groupLinks.length === 0) return 'https://chat.whatsapp.com/CONFIGURAR';
    return groupLinks[Math.floor(Math.random() * groupLinks.length)];
  });
  // Timer countdown — começa em deadlineSeconds pra cada visitante
  // (sessão do navegador, persiste em localStorage pra mesma session continuar)
  const [secondsLeft, setSecondsLeft] = useState<number>(deadlineSeconds);
  const [vagas, setVagas] = useState<number>(vagasBase);

  useEffect(() => {
    const key = 'promo_helena_deadline';
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    let target: number;
    if (saved) {
      target = Number(saved);
      if (target < Date.now()) {
        target = Date.now() + deadlineSeconds * 1000;
        window.localStorage.setItem(key, String(target));
      }
    } else {
      target = Date.now() + deadlineSeconds * 1000;
      if (typeof window !== 'undefined') window.localStorage.setItem(key, String(target));
    }
    const update = (): void => {
      const left = Math.max(0, Math.floor((target - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [deadlineSeconds]);

  // Vagas — incrementa ~1 a cada 8-25s pra simular preenchimento orgânico.
  // Para quando chegar a totalVagas - 5 (sempre fica "vagas finais").
  useEffect(() => {
    const cap = totalVagas - 5;
    const tick = (): void => {
      setVagas((v) => {
        if (v >= cap) return v;
        const inc = Math.random() < 0.7 ? 1 : 2;
        return Math.min(cap, v + inc);
      });
      const next = 8000 + Math.random() * 17000;
      timer = setTimeout(tick, next);
    };
    let timer = setTimeout(tick, 5000 + Math.random() * 8000);
    return () => clearTimeout(timer);
  }, [totalVagas]);

  const hours = Math.floor(secondsLeft / 3600);
  const mins = Math.floor((secondsLeft % 3600) / 60);
  const secs = secondsLeft % 60;
  const pct = Math.min(100, (vagas / totalVagas) * 100);
  const vagasRestantes = totalVagas - vagas;

  // Click handler do CTA — dispara Lead no pixel ANTES de abrir o WhatsApp.
  // Não bloqueia: window.open() roda na sequência mesmo se fbq não existir.
  const handleEnterGroup = (): void => {
    if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
      try {
        window.fbq('track', 'Lead');
      } catch {
        // Fallback silencioso — pixel não pode quebrar o CTA.
      }
    }
    window.open(groupLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#FAF6F0] via-[#F4E4E1] to-[#E8D5E5] flex items-center justify-center p-4">
      {metaPixelId ? (
        <>
          <Script
            id="meta-pixel"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${metaPixelId}');
fbq('track', 'PageView');
              `,
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <noscript>
            <img
              height="1"
              width="1"
              style={{ display: 'none' }}
              src={`https://www.facebook.com/tr?id=${metaPixelId}&ev=PageView&noscript=1`}
              alt=""
            />
          </noscript>
        </>
      ) : null}
      <div className="w-full max-w-md mx-auto">
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-2xl shadow-pink-200/40 p-6 sm:p-8 space-y-5 border border-white/60">
          {/* Logo */}
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/foto2.png"
              alt="Promo da Helena"
              className="size-32 sm:size-40 object-contain drop-shadow-md"
            />
          </div>

          {/* Headline (configurável via dashboard) */}
          <div className="text-center space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-[#7B6E8C] leading-tight">
              {headline || 'Achadinhos de mãe pra mãe 💕'}
            </h1>
            <p className="text-sm sm:text-base text-[#A58B7E]">
              {subheadline ||
                'Promoções selecionadas com cupons exclusivos direto no seu WhatsApp.'}
            </p>
          </div>

          {/* Timer countdown */}
          <div className="bg-gradient-to-r from-[#F4D5D5] to-[#E8D5E5] rounded-2xl p-4 text-center">
            <p className="text-xs uppercase tracking-wider text-[#7B6E8C] font-semibold mb-2">
              ⏰ Inscrições encerram em
            </p>
            <div className="flex justify-center gap-2 sm:gap-3">
              {hours > 0 ? (
                <>
                  <TimeBox value={hours} label="horas" />
                  <span className="text-2xl font-bold text-[#A58B7E] self-center">:</span>
                  <TimeBox value={mins} label="min" />
                  <span className="text-2xl font-bold text-[#A58B7E] self-center">:</span>
                  <TimeBox value={secs} label="seg" />
                </>
              ) : (
                <>
                  <TimeBoxLarge value={mins} label="minutos" />
                  <span className="text-4xl font-bold text-[#D89399] self-center">:</span>
                  <TimeBoxLarge value={secs} label="segundos" />
                </>
              )}
            </div>
          </div>

          {/* Barra de vagas */}
          <div className="space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="text-sm font-medium text-[#7B6E8C]">
                Vagas preenchidas
              </span>
              <span className="text-sm font-bold text-[#D89399]">
                {vagas} de {totalVagas}
              </span>
            </div>
            <div className="h-3 rounded-full bg-[#F4E4E1] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#D89399] via-[#E8B4B8] to-[#A599C7] transition-all duration-700 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-center text-[#A58B7E]">
              ⚠️ <strong className="text-[#D89399]">Apenas {vagasRestantes} vagas</strong>{' '}
              restantes — entrada limitada!
            </p>
          </div>

          {/* CTA WhatsApp — button (não <a>) pra disparar Lead no pixel antes de abrir */}
          <button
            type="button"
            onClick={handleEnterGroup}
            className="block w-full bg-gradient-to-r from-[#25D366] to-[#128C7E] hover:from-[#128C7E] hover:to-[#25D366] text-white font-bold text-center py-4 px-6 rounded-2xl shadow-lg shadow-green-300/50 transition-all hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
          >
            <span className="flex items-center justify-center gap-2 text-base sm:text-lg">
              <WhatsAppIcon />
              ENTRAR NO GRUPO GRÁTIS
            </span>
          </button>

          {/* Social proof */}
          <p className="text-center text-xs text-[#A58B7E]">
            🔒 Sem spam · Você sai quando quiser · Grupo só com promoções
          </p>
        </div>

        {/* Footer credibilidade */}
        <p className="text-center text-xs text-[#A58B7E] mt-4">
          © Promo da Helena · Achadinhos selecionados todos os dias
        </p>
      </div>
    </main>
  );
}

function TimeBox({ value, label }: { value: number; label: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center min-w-[3rem] sm:min-w-[3.5rem]">
      <span className="text-3xl sm:text-4xl font-bold text-[#7B6E8C] tabular-nums">
        {String(value).padStart(2, '0')}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-[#A58B7E]">{label}</span>
    </div>
  );
}

function TimeBoxLarge({ value, label }: { value: number; label: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center min-w-[5rem] sm:min-w-[6rem]">
      <span className="text-5xl sm:text-6xl font-bold text-[#D89399] tabular-nums leading-none">
        {String(value).padStart(2, '0')}
      </span>
      <span className="text-[11px] uppercase tracking-wider text-[#A58B7E] mt-1">{label}</span>
    </div>
  );
}

function WhatsAppIcon(): React.ReactElement {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
