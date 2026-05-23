import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Sparkles, MessageCircle, ArrowLeft, Calendar } from 'lucide-react';
import { GUIDES } from './content';

export const revalidate = 86400;

type Params = { slug: string };

export async function generateStaticParams(): Promise<Params[]> {
  return Object.keys(GUIDES).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<{ title: string; description: string }> {
  const { slug } = await params;
  const guide = GUIDES[slug];
  if (!guide) return { title: 'Guia não encontrado', description: '' };
  return {
    title: `${guide.title} | Promo da Helena`,
    description: guide.excerpt,
  };
}

export default async function GuiaPage({
  params,
}: {
  params: Promise<Params>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const guide = GUIDES[slug];
  if (!guide) notFound();

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
            <Link href="/" className="rounded-full bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">
              <MessageCircle className="inline size-4 mr-1" />
              Entrar no grupo
            </Link>
          </nav>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/guia" className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:underline">
          <ArrowLeft className="size-4" /> Voltar pros guias
        </Link>
        <h1 className="mt-4 text-3xl md:text-4xl font-extrabold tracking-tight">{guide.title}</h1>
        <div className="mt-3 flex items-center gap-3 text-sm text-zinc-500">
          <Calendar className="size-4" />
          Atualizado em {new Date(guide.updatedAt).toLocaleDateString('pt-BR')}
          <span>·</span>
          <span>{guide.readTime}</span>
        </div>
        <p className="mt-4 text-lg text-zinc-600 leading-relaxed">{guide.excerpt}</p>

        <div className="prose prose-emerald mt-8 max-w-none">
          {guide.sections.map((s, i) => (
            <section key={i} className="mb-8">
              <h2 className="mb-3 text-2xl font-bold text-zinc-900">{s.heading}</h2>
              {s.paragraphs.map((p, pi) => (
                <p key={pi} className="mb-3 leading-relaxed text-zinc-700">{p}</p>
              ))}
              {s.products && s.products.length > 0 ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {s.products.map((p, pi) => (
                    <a
                      key={pi}
                      href={p.url}
                      target="_blank"
                      rel="nofollow sponsored noopener"
                      className="block rounded-lg border bg-emerald-50/30 p-4 transition-shadow hover:shadow-md"
                    >
                      <div className="font-semibold text-zinc-900">{p.name}</div>
                      <p className="mt-1 text-sm text-zinc-600">{p.why}</p>
                      <div className="mt-2 text-sm font-medium text-emerald-700">
                        Ver na Amazon →
                      </div>
                    </a>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border bg-gradient-to-br from-emerald-50 to-white p-6">
          <h3 className="text-lg font-bold">Gostou? Tem muito mais lá no grupo</h3>
          <p className="mt-1 text-sm text-zinc-600">
            Todo dia a Helena posta novos achados com cupons exclusivos. Tudo curado, sem spam.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700"
          >
            <MessageCircle className="size-4" />
            Entrar no grupo WhatsApp
          </Link>
        </div>
      </article>

      <footer className="border-t bg-zinc-50 mt-10">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-zinc-600">
          <p>
            <strong>promodahelena.oficial</strong> participa do Programa de Associados da Amazon.com.
            Ganhamos uma pequena comissão quando você compra através dos nossos links, sem custo
            adicional pra você. Conteúdo informativo, não substitui orientação profissional.
          </p>
        </div>
      </footer>
    </div>
  );
}
