import Link from 'next/link';
import { Sparkles, Star, ShoppingBag, BookOpen, MessageCircle } from 'lucide-react';

// SSR + revalidate 1h — Amazon bot precisa indexar o conteúdo.
export const revalidate = 3600;

const API_BASE =
  process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3047';

type Offer = {
  id: string;
  externalId: string;
  title: string;
  imageUrl: string | null;
  price: number;
  originalPrice: number | null;
  discountPct: number | null;
  rating: number | null;
  ratingCount: number | null;
  salesCount: number | null;
  affiliateUrl: string | null;
  source: 'AMAZON' | 'SHOPEE' | 'MERCADOLIVRE';
};

async function fetchFeatured(): Promise<Offer[]> {
  try {
    const res = await fetch(`${API_BASE}/public/featured-products?source=AMAZON&limit=24`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items: Offer[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

function formatBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export const metadata = {
  title: 'Ofertas Amazon Selecionadas | Promo da Helena',
  description:
    'Os melhores achados de mãe pra mãe na Amazon: enxoval, fralda, babá eletrônica, brinquedos infantis. Curadoria diária com cupons e descontos reais.',
};

export default async function OfertasPage(): Promise<React.ReactElement> {
  const offers = await fetchFeatured();

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="border-b bg-gradient-to-b from-emerald-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-6 flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2">
            <Sparkles className="size-6 text-emerald-600" />
            <span className="font-bold text-lg">
              promo da<span className="text-emerald-600">.helena</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/ofertas" className="font-semibold text-emerald-700">Ofertas</Link>
            <Link href="/guia" className="text-zinc-600 hover:text-emerald-700">Guias</Link>
            <Link href="/sobre" className="text-zinc-600 hover:text-emerald-700">Sobre</Link>
            <Link href="/" className="rounded-full bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">
              <MessageCircle className="inline size-4 mr-1" />
              Entrar no grupo
            </Link>
          </nav>
        </div>
      </header>

      <section className="border-b bg-gradient-to-br from-emerald-50/40 to-white">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight">
            Ofertas <span className="text-emerald-600">selecionadas a dedo</span> 💕
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-zinc-600">
            Produtos que a Helena testou, recomenda e usa em casa. Tudo com link direto pra Amazon,
            sem enrolação. Atualizado diariamente conforme novos achados.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-800">
              ✓ Frete Prime
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-900">
              🎟️ Cupons quando disponíveis
            </span>
            <span className="rounded-full bg-rose-100 px-3 py-1 font-medium text-rose-800">
              💕 Curadoria de mãe pra mãe
            </span>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="mb-6 text-2xl font-bold flex items-center gap-2">
          <ShoppingBag className="size-6 text-emerald-600" />
          {offers.length} produtos em destaque hoje
        </h2>

        {offers.length === 0 ? (
          <div className="rounded-lg border bg-zinc-50 p-8 text-center text-zinc-600">
            Estamos atualizando nossa vitrine. Volte em alguns minutos!
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {offers.map((o) => (
              <OfferCard key={o.id} offer={o} />
            ))}
          </div>
        )}

        <section className="mt-16 rounded-2xl border bg-gradient-to-br from-emerald-50 to-white p-8">
          <div className="flex items-start gap-4">
            <BookOpen className="size-8 shrink-0 text-emerald-600 mt-1" />
            <div>
              <h2 className="text-2xl font-bold">Guias da Helena</h2>
              <p className="mt-1 text-zinc-600">
                Artigos com conteúdo aprofundado pra te ajudar a escolher os melhores produtos.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <GuideTeaser
                  slug="enxoval-recem-nascido"
                  title="Enxoval pro Recém-Nascido"
                  desc="15 itens que não podem faltar na maternidade"
                />
                <GuideTeaser
                  slug="como-escolher-fralda"
                  title="Como escolher a fralda certa"
                  desc="Guia honesto comparando marcas e tamanhos"
                />
                <GuideTeaser
                  slug="cadeirinha-de-carro"
                  title="Cadeirinha de carro segura"
                  desc="O que considerar na compra (NBR + Inmetro)"
                />
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function OfferCard({ offer }: { offer: Offer }): React.ReactElement {
  const hasDiscount = offer.originalPrice && offer.originalPrice > offer.price;
  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border bg-white transition-shadow hover:shadow-lg">
      <a
        href={offer.affiliateUrl ?? '#'}
        target="_blank"
        rel="nofollow sponsored noopener"
        className="relative aspect-square overflow-hidden bg-zinc-50"
      >
        {offer.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={offer.imageUrl}
            alt={offer.title}
            className="size-full object-contain transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="grid size-full place-items-center text-zinc-400">sem foto</div>
        )}
        {offer.discountPct && offer.discountPct >= 5 ? (
          <span className="absolute left-2 top-2 rounded-md bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">
            -{Math.round(offer.discountPct)}%
          </span>
        ) : null}
      </a>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug">{offer.title}</h3>
        {offer.rating ? (
          <div className="flex items-center gap-1 text-xs text-amber-600">
            <Star className="size-3 fill-current" />
            {offer.rating.toFixed(1)}
            {offer.ratingCount ? (
              <span className="text-zinc-500">({offer.ratingCount.toLocaleString('pt-BR')})</span>
            ) : null}
          </div>
        ) : null}
        <div className="mt-auto">
          {hasDiscount ? (
            <div className="text-xs text-zinc-500 line-through">
              {formatBRL(offer.originalPrice as number)}
            </div>
          ) : null}
          <div className="text-lg font-bold text-emerald-600">{formatBRL(offer.price)}</div>
        </div>
        <a
          href={offer.affiliateUrl ?? '#'}
          target="_blank"
          rel="nofollow sponsored noopener"
          className="mt-1 block rounded-md bg-emerald-600 px-3 py-2 text-center text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
        >
          Ver na Amazon →
        </a>
      </div>
    </article>
  );
}

function GuideTeaser({
  slug,
  title,
  desc,
}: {
  slug: string;
  title: string;
  desc: string;
}): React.ReactElement {
  return (
    <Link
      href={`/guia/${slug}`}
      className="rounded-lg border bg-white p-4 transition-shadow hover:shadow-md"
    >
      <h3 className="font-semibold text-zinc-900">{title}</h3>
      <p className="mt-1 text-sm text-zinc-600">{desc}</p>
      <p className="mt-2 text-xs font-medium text-emerald-600">Ler artigo →</p>
    </Link>
  );
}

function Footer(): React.ReactElement {
  return (
    <footer className="border-t bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-zinc-600">
        <p>
          <strong>promodahelena.oficial</strong> participa do Programa de Associados da Amazon.com,
          um programa de publicidade que fornece um meio para sites ganharem comissões por
          publicidade e links para amazon.com.br. Ganhamos uma pequena comissão quando você compra
          através dos nossos links, sem custo adicional pra você.
        </p>
        <p className="mt-3 flex flex-wrap gap-4">
          <Link href="/" className="hover:text-emerald-700">Início</Link>
          <Link href="/ofertas" className="hover:text-emerald-700">Ofertas</Link>
          <Link href="/guia" className="hover:text-emerald-700">Guias</Link>
          <Link href="/sobre" className="hover:text-emerald-700">Sobre</Link>
          <Link href="/privacidade" className="hover:text-emerald-700">Privacidade</Link>
        </p>
        <p className="mt-3 text-xs text-zinc-500">
          © {new Date().getFullYear()} Promo da Helena. Conteúdo informativo, não substitui
          orientação profissional.
        </p>
      </div>
    </footer>
  );
}
