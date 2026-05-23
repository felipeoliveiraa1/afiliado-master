import Link from 'next/link';
import { Sparkles, MessageCircle, Heart, Award, Users, ShoppingBag, BookOpen } from 'lucide-react';

export const metadata = {
  title: 'Sobre a Helena | Promo da Helena',
  description:
    'Conheça a Helena — mãe, curadora de ofertas e fundadora do grupo Promo da Helena. Por que criamos esse projeto e como funciona.',
};

export default function SobrePage(): React.ReactElement {
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
            <Link href="/guia" className="text-zinc-600 hover:text-emerald-700">Guias</Link>
            <Link href="/sobre" className="font-semibold text-emerald-700">Sobre</Link>
            <Link href="/" className="rounded-full bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">
              <MessageCircle className="inline size-4 mr-1" />
              Entrar no grupo
            </Link>
          </nav>
        </div>
      </header>

      <section className="border-b bg-gradient-to-br from-emerald-50/40 to-white">
        <div className="mx-auto max-w-3xl px-4 py-12">
          <div className="flex items-center gap-3 text-emerald-600 mb-4">
            <Heart className="size-7" />
            <span className="text-sm font-bold uppercase tracking-wide">Sobre nós</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight">
            Oi, eu sou a <span className="text-emerald-600">Helena</span> 💕
          </h1>
          <p className="mt-4 text-lg text-zinc-600 leading-relaxed">
            Sou mãe da Sofia (3 meses) e criei o Promo da Helena depois de passar meses pesquisando
            cada produto que ia comprar pro enxoval. Cansei de gastar horas no Instagram comparando
            preço de fralda — então virei isso uma rotina e comecei a compartilhar os achados.
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="prose prose-emerald max-w-none">
          <section className="mb-8">
            <h2 className="text-2xl font-bold mb-3">Por que esse projeto existe</h2>
            <p>
              Mãe de primeira viagem tem 3 problemas que vivenciei na pele:
            </p>
            <ol className="list-decimal pl-6 mt-3 space-y-2">
              <li>
                <strong>Vendedor empurra coisa que não usa.</strong> Listas de enxoval com 80
                itens, sendo que metade vai pro fundo da gaveta.
              </li>
              <li>
                <strong>Preço vendido como "promoção" não é promoção.</strong> Loja sobe o valor,
                marca como "30% OFF" e na verdade tá mais caro que o normal.
              </li>
              <li>
                <strong>Falta tempo pra pesquisar.</strong> Quem tem RN em casa não tem 4h livres
                pra comparar 20 modelos de babá eletrônica.
              </li>
            </ol>
            <p className="mt-3">
              Resolvi isso pra mim e descobri que tinha um monte de mãe na mesma situação. Aí o
              grupo do WhatsApp virou natural.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold mb-3">Como funciona o grupo</h2>
            <p>
              Todo dia eu garimpo promoções reais nos marketplaces (Amazon, Shopee, Mercado Livre),
              valido o preço (uso o app{' '}
              <a href="https://www.zoom.com.br/" target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">Zoom</a>{' '}
              pra checar histórico), aplico os cupons disponíveis e mando só o que vale MESMO a
              pena pro grupo.
            </p>
            <p className="mt-3">
              <strong>Regras simples:</strong>
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Só promoção real (preço abaixo da média dos últimos 30 dias)</li>
              <li>Sempre com cupom quando disponível</li>
              <li>Só produtos que eu compraria pra mim ou indicaria pra amiga</li>
              <li>Sem spam — máximo 20-30 mensagens/dia, espaçadas</li>
            </ul>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-8">
            <div className="rounded-xl border bg-white p-4 text-center">
              <Users className="size-8 text-emerald-600 mx-auto" />
              <div className="mt-2 text-2xl font-bold">500+</div>
              <div className="text-sm text-zinc-600">mães no grupo</div>
            </div>
            <div className="rounded-xl border bg-white p-4 text-center">
              <ShoppingBag className="size-8 text-emerald-600 mx-auto" />
              <div className="mt-2 text-2xl font-bold">~20</div>
              <div className="text-sm text-zinc-600">achados curados por dia</div>
            </div>
            <div className="rounded-xl border bg-white p-4 text-center">
              <Award className="size-8 text-emerald-600 mx-auto" />
              <div className="mt-2 text-2xl font-bold">100%</div>
              <div className="text-sm text-zinc-600">testado ou indicado</div>
            </div>
          </div>

          <section className="mb-8">
            <h2 className="text-2xl font-bold mb-3">Como me sustento</h2>
            <p>
              Sou afiliada oficial da Amazon, Shopee e Mercado Livre. Quando você compra através
              dos meus links, recebo uma pequena comissão dos marketplaces —{' '}
              <strong>sem custo adicional pra você</strong>.
            </p>
            <p className="mt-3">
              Isso me permite dedicar várias horas por dia pesquisando ofertas, escrevendo guias e
              mantendo o grupo ativo. <strong>Não cobro nada de você</strong> nem peço PIX. Toda
              comissão vem dos marketplaces depois da sua compra.
            </p>
            <p className="mt-3">
              <strong>Transparência total:</strong> todo link que você clicar aqui tem o código
              <code className="bg-zinc-100 px-1 rounded text-sm">promodahele03-20</code> (Amazon),
              e o equivalente em Shopee/ML. Isso é a marca que diz "essa pessoa indicou" pros
              marketplaces.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold mb-3">Conteúdo editorial</h2>
            <p>
              Além do grupo de WhatsApp, mantenho aqui no site:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>
                <Link href="/guia" className="text-emerald-700 underline">Guias práticos</Link> —
                artigos longos comparando marcas e ajudando você a escolher (enxoval, fralda,
                cadeirinha, etc)
              </li>
              <li>
                <Link href="/ofertas" className="text-emerald-700 underline">Vitrine de ofertas</Link>{' '}
                — produtos selecionados do mês, atualizada conforme novos achados
              </li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold mb-3">Contato</h2>
            <p>A melhor forma de falar comigo é dentro do grupo de WhatsApp.</p>
            <p className="mt-3">
              Pra parcerias, marcas ou imprensa, fale via DM no Instagram{' '}
              <a
                href="https://instagram.com/promodahelena.oficial"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-700 underline"
              >
                @promodahelena.oficial
              </a>.
            </p>
          </section>

          <div className="rounded-2xl border bg-gradient-to-br from-emerald-50 to-white p-6 mt-12">
            <div className="flex items-start gap-3">
              <BookOpen className="size-6 shrink-0 text-emerald-600 mt-1" />
              <div>
                <h3 className="text-lg font-bold">Quer ver os achados de hoje?</h3>
                <p className="mt-1 text-sm text-zinc-600">
                  Acompanhe a vitrine atualizada diariamente.
                </p>
                <Link
                  href="/ofertas"
                  className="mt-3 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Ver Ofertas →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t bg-zinc-50">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-zinc-600">
          <p>
            <strong>promodahelena.oficial</strong> participa do Programa de Associados da Amazon.com,
            do Programa Shopee Affiliate e do Programa de Afiliados Mercado Livre.
          </p>
          <p className="mt-3 flex flex-wrap gap-4">
            <Link href="/" className="hover:text-emerald-700">Início</Link>
            <Link href="/ofertas" className="hover:text-emerald-700">Ofertas</Link>
            <Link href="/guia" className="hover:text-emerald-700">Guias</Link>
            <Link href="/sobre" className="hover:text-emerald-700">Sobre</Link>
            <Link href="/privacidade" className="hover:text-emerald-700">Privacidade</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
