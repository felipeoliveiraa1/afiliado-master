import { PromoLanding } from './promo/landing';

// Página inicial pública — landing page Promo da Helena.
// Anúncios apontam pra cá. Login do painel fica em /login mas não tem
// link público apontando — só quem souber a URL chega lá.
export default function HomePage(): React.ReactElement {
  const groupLink =
    process.env.NEXT_PUBLIC_GROUP_LINK || 'https://chat.whatsapp.com/CONFIGURAR';
  const totalVagas = Number(process.env.NEXT_PUBLIC_VAGAS_TOTAL ?? '500');
  const vagasBase = Number(process.env.NEXT_PUBLIC_VAGAS_BASE ?? '423');
  const deadlineSeconds = Number(process.env.NEXT_PUBLIC_DEADLINE_SECONDS ?? '120');
  return (
    <PromoLanding
      groupLink={groupLink}
      totalVagas={totalVagas}
      vagasBase={vagasBase}
      deadlineSeconds={deadlineSeconds}
    />
  );
}

export const metadata = {
  title: 'Promo da Helena — Achadinhos para Mães',
  description:
    'Grupo VIP de promoções selecionadas para mães. Cupons exclusivos e ofertas relâmpago.',
};
