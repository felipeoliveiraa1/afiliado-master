import Link from 'next/link';
import { Sparkles, MessageCircle, ShieldCheck } from 'lucide-react';

export const metadata = {
  title: 'Política de Privacidade | Promo da Helena',
  description:
    'Como coletamos, usamos e protegemos seus dados ao usar o site Promo da Helena. Em conformidade com a LGPD.',
};

export default function PrivacidadePage(): React.ReactElement {
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
            <Link href="/sobre" className="text-zinc-600 hover:text-emerald-700">Sobre</Link>
            <Link href="/" className="rounded-full bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">
              <MessageCircle className="inline size-4 mr-1" />
              Entrar no grupo
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center gap-3 text-emerald-600 mb-4">
          <ShieldCheck className="size-7" />
          <span className="text-sm font-bold uppercase tracking-wide">Política de Privacidade</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Política de Privacidade</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Última atualização: 23 de maio de 2026
        </p>

        <div className="prose prose-emerald mt-8 max-w-none">
          <section className="mb-6">
            <h2 className="text-2xl font-bold mb-3">1. Quem somos</h2>
            <p>
              O site <strong>Promo da Helena</strong> (promodahelenaoficial.vercel.app) é
              operado pela Helena, mãe e curadora de ofertas para o nicho materno-infantil.
              Esta política descreve como tratamos os dados pessoais coletados quando você visita
              nosso site ou participa do nosso grupo de WhatsApp.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-bold mb-3">2. Dados que coletamos</h2>
            <p>Coletamos os seguintes tipos de dados:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>
                <strong>Dados de navegação anônimos:</strong> endereço IP, tipo de navegador,
                páginas visitadas, tempo de permanência (via Meta Pixel e cookies essenciais).
              </li>
              <li>
                <strong>Dados voluntários:</strong> quando você entra no grupo de WhatsApp, seu
                número de telefone fica visível pra outros membros (limitação do WhatsApp). Não
                coletamos seu número fora desse contexto.
              </li>
              <li>
                <strong>Dados de afiliação:</strong> ao clicar em links de produtos (Amazon,
                Shopee, Mercado Livre), o marketplace correspondente registra o clique vinculado
                à nossa conta de afiliado pra fins de comissionamento. Nenhum dado pessoal seu é
                compartilhado por nós.
              </li>
            </ul>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-bold mb-3">3. Como usamos os dados</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Melhorar a experiência do site (entender quais ofertas geram mais interesse)</li>
              <li>Mensurar a efetividade de campanhas (Meta Pixel)</li>
              <li>Receber comissões dos marketplaces parceiros via cookies de afiliado</li>
            </ul>
            <p className="mt-3">
              <strong>Não vendemos seus dados pra terceiros.</strong> Não enviamos email marketing.
              Não compartilhamos seu número de telefone fora do grupo de WhatsApp (que você entrou
              voluntariamente).
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-bold mb-3">4. Cookies e tecnologias similares</h2>
            <p>O site usa:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>
                <strong>Cookies essenciais:</strong> mantêm preferências da sessão (countdown da
                landing, idioma).
              </li>
              <li>
                <strong>Meta Pixel (Facebook):</strong> mensura conversões pra campanhas pagas.
                Você pode desabilitar nas configurações do Facebook ou via bloqueador (uBlock,
                Brave Shields).
              </li>
              <li>
                <strong>Cookies de afiliado:</strong> Amazon, Shopee e Mercado Livre instalam
                cookies próprios quando você clica nos links — sujeito às políticas de privacidade
                deles, não nossas.
              </li>
            </ul>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-bold mb-3">5. Programas de Afiliados</h2>
            <p>
              <strong>promodahelena.oficial é participante do Programa de Associados da Amazon.com.br</strong>,
              do Programa Shopee Affiliate e do Programa de Afiliados do Mercado Livre. Esses
              programas fornecem um meio para nós ganharmos comissões por publicidade e links pros
              respectivos sites. Quando você compra via nossos links, recebemos uma pequena
              comissão — sem custo adicional pra você.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-bold mb-3">6. Seus direitos (LGPD)</h2>
            <p>Em conformidade com a Lei Geral de Proteção de Dados (LGPD), você tem direito a:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Saber quais dados temos sobre você</li>
              <li>Solicitar correção ou exclusão</li>
              <li>Revogar consentimento a qualquer momento (saindo do grupo de WhatsApp)</li>
              <li>Reclamar à ANPD (Autoridade Nacional de Proteção de Dados)</li>
            </ul>
            <p className="mt-3">
              Pra exercer qualquer um desses direitos, fale conosco pelo grupo de WhatsApp ou pelo
              email indicado na página{' '}
              <Link href="/sobre" className="text-emerald-700 underline">Sobre</Link>.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-bold mb-3">7. Alterações nesta política</h2>
            <p>
              Esta política pode ser atualizada periodicamente. Mudanças significativas serão
              comunicadas no grupo de WhatsApp. A versão vigente sempre está disponível nesta
              página, com a data de "Última atualização" indicada no topo.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-bold mb-3">8. Contato</h2>
            <p>
              Dúvidas sobre privacidade? Fale conosco via grupo de WhatsApp{' '}
              <Link href="/" className="text-emerald-700 underline">aqui</Link> ou pelos canais
              indicados na{' '}
              <Link href="/sobre" className="text-emerald-700 underline">página Sobre</Link>.
            </p>
          </section>
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
