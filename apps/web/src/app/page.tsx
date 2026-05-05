import { PromoLanding } from './promo/landing';

// Página inicial pública — landing Promo da Helena.
// Config vem do dashboard (POST /settings/landing) — sem rebuild ao mudar.
// Quando há múltiplos groupLinks, landing rotaciona automaticamente (random no mount).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type LandingConfig = {
  groupLinks: string[];
  totalVagas: number;
  vagasBase: number;
  deadlineSeconds: number;
  headline: string;
  subheadline: string;
  metaPixelId: string;
};

async function fetchLandingConfig(): Promise<LandingConfig> {
  const apiBase =
    process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3047';
  try {
    const res = await fetch(`${apiBase}/landing-config`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as LandingConfig;
  } catch {
    return {
      groupLinks: [],
      totalVagas: 500,
      vagasBase: 423,
      deadlineSeconds: 120,
      headline: 'Achadinhos de mãe pra mãe 💕',
      subheadline:
        'Promoções selecionadas com cupons exclusivos direto no seu WhatsApp.',
      metaPixelId: '',
    };
  }
}

export default async function HomePage(): Promise<React.ReactElement> {
  const cfg = await fetchLandingConfig();
  // Fallback final pra env legacy + placeholder de dev
  const groupLinks =
    cfg.groupLinks.length > 0
      ? cfg.groupLinks
      : process.env.NEXT_PUBLIC_GROUP_LINK
        ? [process.env.NEXT_PUBLIC_GROUP_LINK]
        : ['https://chat.whatsapp.com/CONFIGURAR'];
  return (
    <PromoLanding
      groupLinks={groupLinks}
      totalVagas={cfg.totalVagas}
      vagasBase={cfg.vagasBase}
      deadlineSeconds={cfg.deadlineSeconds}
      headline={cfg.headline}
      subheadline={cfg.subheadline}
      metaPixelId={cfg.metaPixelId}
    />
  );
}

export const metadata = {
  title: 'Promo da Helena — Achadinhos para Mães',
  description:
    'Grupo VIP de promoções selecionadas para mães. Cupons exclusivos e ofertas relâmpago.',
};
