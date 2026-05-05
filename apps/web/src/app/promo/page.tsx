import { PromoLanding } from './landing';

// Página pública — sem auth, fora do (dashboard) layout.
// Fluxo: Anúncio (Meta/Google) → /promo → grupo WhatsApp
//
// Configuráveis via env (NEXT_PUBLIC_*):
//   NEXT_PUBLIC_GROUP_LINK     — link do grupo (chat.whatsapp.com/...)
//   NEXT_PUBLIC_VAGAS_TOTAL    — total de vagas (default 500)
//   NEXT_PUBLIC_VAGAS_BASE     — vagas já preenchidas (default 423)
//   NEXT_PUBLIC_DEADLINE_HOURS — horas até o timer zerar (default 23)
export default function PromoPage(): React.ReactElement {
  const groupLink =
    process.env.NEXT_PUBLIC_GROUP_LINK || 'https://chat.whatsapp.com/CONFIGURAR';
  const totalVagas = Number(process.env.NEXT_PUBLIC_VAGAS_TOTAL ?? '500');
  const vagasBase = Number(process.env.NEXT_PUBLIC_VAGAS_BASE ?? '423');
  const deadlineHours = Number(process.env.NEXT_PUBLIC_DEADLINE_HOURS ?? '23');
  return (
    <PromoLanding
      groupLink={groupLink}
      totalVagas={totalVagas}
      vagasBase={vagasBase}
      deadlineHours={deadlineHours}
    />
  );
}

export const metadata = {
  title: 'Promo da Helena — Achadinhos para Mães',
  description:
    'Grupo VIP de promoções selecionadas para mães. Cupons exclusivos e ofertas relâmpago.',
};
