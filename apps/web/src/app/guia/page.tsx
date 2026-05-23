import Link from 'next/link';
import { Sparkles, BookOpen, MessageCircle, ShoppingBag } from 'lucide-react';

export const metadata = {
  title: 'Guias da Helena | Promo da Helena',
  description:
    'Guias práticos pra escolher os melhores produtos pra você e seu bebê: enxoval, fralda, cadeirinha, babá eletrônica.',
};

const GUIDES = [
  {
    slug: 'enxoval-recem-nascido',
    title: 'Enxoval pro Recém-Nascido: 15 itens essenciais',
    excerpt:
      'A lista enxuta de tudo que VAI usar na maternidade — sem coisa enrolada que vendedor empurra mas você não usa.',
    readTime: '8 min',
  },
  {
    slug: 'como-escolher-fralda',
    title: 'Como escolher a fralda descartável certa',
    excerpt:
      'Comparativo honesto entre Pampers, Huggies, Turma da Mônica e marcas premium. Por tamanho, peso e bolso.',
    readTime: '6 min',
  },
  {
    slug: 'cadeirinha-de-carro',
    title: 'Cadeirinha de carro segura: o guia completo',
    excerpt:
      'O que considerar na compra (NBR 14400, ISO-Fix, idade certa), e por que cadeirinha barata pode sair cara.',
    readTime: '10 min',
  },
  {
    slug: 'baba-eletronica-vale-a-pena',
    title: 'Babá eletrônica vale a pena? Comparativo honesto 2026',
    excerpt:
      'Comparativo entre babá só áudio, com vídeo, e babá inteligente com Wi-Fi. Em quais casos cada uma faz sentido e quais armadilhas evitar.',
    readTime: '7 min',
  },
  {
    slug: 'brinquedos-por-idade-do-bebe',
    title: 'Brinquedos por faixa etária: 0 a 12 meses',
    excerpt:
      'Guia mensal do que o bebê REALMENTE usa em cada fase. Sem comprar brinquedo que ele só vai brincar daqui 6 meses.',
    readTime: '9 min',
  },
];

export default function GuiaIndexPage(): React.ReactElement {
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
            <Link href="/ofertas" className="text-zinc-600 hover:text-emerald-700">Ofertas</Link>
            <Link href="/guia" className="font-semibold text-emerald-700">Guias</Link>
            <Link href="/sobre" className="text-zinc-600 hover:text-emerald-700">Sobre</Link>
            <Link href="/" className="rounded-full bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">
              <MessageCircle className="inline size-4 mr-1" />
              Entrar no grupo
            </Link>
          </nav>
        </div>
      </header>

      <section className="border-b bg-gradient-to-br from-emerald-50/40 to-white">
        <div className="mx-auto max-w-4xl px-4 py-12">
          <div className="flex items-center gap-3 text-emerald-600">
            <BookOpen className="size-7" />
            <span className="text-sm font-bold uppercase tracking-wide">Guias da Helena</span>
          </div>
          <h1 className="mt-3 text-3xl md:text-5xl font-extrabold tracking-tight">
            Conteúdo honesto pra <span className="text-emerald-600">mães decidirem melhor</span>
          </h1>
          <p className="mt-3 text-lg text-zinc-600">
            Artigos curtos e diretos, com produtos testados, comparativos reais e indicações de
            quem usa no dia a dia. Sem jabá disfarçado.
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="grid gap-4 md:grid-cols-1">
          {GUIDES.map((g) => (
            <Link
              key={g.slug}
              href={`/guia/${g.slug}`}
              className="group rounded-xl border bg-white p-6 transition-shadow hover:shadow-lg"
            >
              <h2 className="text-xl font-bold text-zinc-900 group-hover:text-emerald-700">
                {g.title}
              </h2>
              <p className="mt-2 text-zinc-600">{g.excerpt}</p>
              <p className="mt-3 text-sm font-medium text-emerald-600">
                Ler guia completo ({g.readTime}) →
              </p>
            </Link>
          ))}
        </div>

        <section className="mt-12 rounded-2xl border bg-gradient-to-br from-emerald-50 to-white p-6">
          <div className="flex items-start gap-3">
            <ShoppingBag className="size-6 shrink-0 text-emerald-600 mt-1" />
            <div>
              <h2 className="text-lg font-bold">Procurando ofertas?</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Confira nossa vitrine de produtos selecionados pra hoje.
              </p>
              <Link
                href="/ofertas"
                className="mt-3 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Ver Ofertas →
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-zinc-50">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-zinc-600">
          <p>
            <strong>promodahelena.oficial</strong> participa do Programa de Associados da Amazon.com,
            um programa de publicidade que fornece um meio para sites ganharem comissões por
            publicidade e links para amazon.com.br.
          </p>
        </div>
      </footer>
    </div>
  );
}
