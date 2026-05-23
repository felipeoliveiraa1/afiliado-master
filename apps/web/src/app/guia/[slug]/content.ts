// Conteúdo estático dos guias da Helena. Cada produto leva pra Amazon com
// a tag de afiliado promodahele07-20. Atualizar manualmente quando produto
// sair de linha.
//
// Por que estático: Amazon's bot precisa ler o HTML server-rendered, e
// o tempo de aprovação valoriza conteúdo curado/honesto > vitrines automáticas.

const TAG = 'promodahele07-20';

function az(asin: string): string {
  return `https://www.amazon.com.br/dp/${asin}?tag=${TAG}`;
}

type Product = { name: string; why: string; url: string };

type Section = {
  heading: string;
  paragraphs: string[];
  products?: Product[];
};

type Guide = {
  title: string;
  excerpt: string;
  readTime: string;
  updatedAt: string;
  sections: Section[];
};

export const GUIDES: Record<string, Guide> = {
  'enxoval-recem-nascido': {
    title: 'Enxoval pro Recém-Nascido: 15 itens essenciais',
    excerpt:
      'A lista enxuta de tudo que VAI usar na maternidade — sem coisa enrolada que vendedor empurra mas você não usa.',
    readTime: '8 min de leitura',
    updatedAt: '2026-05-21',
    sections: [
      {
        heading: 'Por que enxuta?',
        paragraphs: [
          'Quem chega na primeira gravidez tende a comprar de tudo um pouco. Resultado: gaveta cheia de roupinha tamanho RN que o bebê usou 1 semana, kits de banho que não couberam na banheira da maternidade, e brinquedos que ele só vai olhar com 6 meses.',
          'Essa lista é o que eu REALMENTE usei nos primeiros 60 dias da minha filha. Tudo abaixo está em uso até hoje (3 meses) ou foi usado intensamente naqueles primeiros dias caóticos.',
        ],
      },
      {
        heading: 'Roupinhas pra maternidade',
        paragraphs: [
          'Você vai precisar de menos do que pensa. O bebê não fica acordado pra trocar de roupa o dia todo — fica dormindo e mamando. Compre menos peças em RN (tamanho de recém-nascido) e mais em P/M, que ele cresce em 2-3 semanas.',
          'Foco em peças fáceis de vestir: macacão com zíper e body com abertura embaixo. Esqueça blusinha com botão na hora da dor de cabeça.',
        ],
        products: [
          {
            name: 'Kit Body Manga Longa Carter\'s (3 peças)',
            why: 'Carter\'s tem fama merecida — algodão macio, abertura por botões no entrepernas. 3 peças num kit dá pra revezar até a 2ª lavagem.',
            url: az('B08XW62YQH'),
          },
          {
            name: 'Kit Macacão Suedine Bebê Greg (5 peças)',
            why: 'Suedine fininho, perfeito pra Brasil. Zipper facilita troca de fralda no meio da noite. Vai do RN ao 6 meses.',
            url: az('B0B1RSP997'),
          },
        ],
      },
      {
        heading: 'Banho e higiene',
        paragraphs: [
          'Banheira dobrável vale MUITO se você mora em apartamento. Mais segura que banho na pia (que cansa as costas e o bebê escorrega).',
          'Toalhinhas umedecidas: compre em volume. Você usa muito mais do que imagina nos primeiros 60 dias.',
        ],
        products: [
          {
            name: 'Banheira Para Bebê C/ Suporte Dobrável - Maxi Baby',
            why: 'Suporte na altura certa pra você não destruir a coluna. Drena água por uma tampinha no fundo. Dobra pra guardar no banheiro.',
            url: az('B0CGBNCPC5'),
          },
          {
            name: 'Toalhinhas Umedecidas Johnsons Baby (48un)',
            why: 'Não dá alergia, cheiro neutro. Usei desde o 1º dia. Compre 3-4 pacotes pra começar.',
            url: az('B099KXW911'),
          },
        ],
      },
      {
        heading: 'Fraldas — quanto comprar?',
        paragraphs: [
          'A regra de ouro: NÃO compre muito do tamanho RN. Recém-nascido grande pula direto pra P. Comprei 2 pacotes de RN e sobraram 30 fraldas pra doar.',
          'Estoque mais o tamanho P (até 6kg) e M (5-9kg) — aí ele fica por meses. Bebê usa em média 8-10 fraldas/dia nos primeiros meses.',
        ],
        products: [
          {
            name: 'Fralda Turma da Mônica Baby Jumbo M (28un)',
            why: 'Custo-benefício imbatível pra tamanho M. Cabe bem em bebê de 5-10kg. Pra escola/passeio uso uma premium, mas em casa é essa.',
            url: az('B099KXW911'),
          },
          {
            name: 'Fralda Turma da Mônica Baby Mega XG (42un)',
            why: 'Pra quem o bebê já passou de 9kg. Pacote mega faz a fralda sair barato em quem usa muito.',
            url: az('B099KV2733'),
          },
        ],
      },
      {
        heading: 'Sono e segurança',
        paragraphs: [
          'Babá eletrônica com vídeo deixa qualquer pai/mãe dormir mais tranquilo. Não precisa ser sofisticada — só precisa cobrir o quarto e ter visão noturna.',
          'Cobertor fino também é melhor que cobertor grosso (risco de sufocamento). Aposte em cobertores de algodão que respiram.',
        ],
        products: [
          {
            name: 'Huggies Supreme Care Fralda Xtra-Flex',
            why: 'A premium da Huggies. Uso pra noite porque segura mais sem vazar. Sai cara, mas vale pra dormir tranquila.',
            url: az('B0BFXGY9B7'),
          },
        ],
      },
      {
        heading: 'O que NÃO comprar (ainda)',
        paragraphs: [
          'Mamadeira em excesso: se vai amamentar, comece com 1-2 — você pode nem precisar.',
          'Berço com decoração elaborada: bebê não vê direito nos primeiros meses, e protetor de berço acolchoado é PERIGOSO (associado à morte súbita).',
          'Roupinha tamanho RN: compre 3-4 peças. Bebê cresce em semanas.',
          'Banheira com brinquedos coloridos: bebê de 0-3 meses não interage. Banheira simples + sua mão segurando ele resolve.',
        ],
      },
    ],
  },

  'como-escolher-fralda': {
    title: 'Como escolher a fralda descartável certa',
    excerpt:
      'Comparativo honesto entre Pampers, Huggies, Turma da Mônica e marcas premium. Por tamanho, peso e bolso.',
    readTime: '6 min de leitura',
    updatedAt: '2026-05-21',
    sections: [
      {
        heading: 'A fralda perfeita não existe',
        paragraphs: [
          'Cada bebê tem um formato diferente. Fralda que veste como luva no filho de uma amiga pode vazar no seu — e vice-versa. A única forma de saber é TESTAR pacotes pequenos antes de estocar.',
          'Outra regra: marca premium nem sempre é melhor. Pampers e Huggies são consistentes, mas marcas como Turma da Mônica e Cremer entregam 90% do desempenho por 50% do preço.',
        ],
      },
      {
        heading: 'Pra noite: invista em premium',
        paragraphs: [
          'À noite o bebê fica 8-10h sem trocar. Fralda comum vai vazar e acordar todo mundo. Aqui vale pagar mais por absorção.',
        ],
        products: [
          {
            name: 'Huggies Supreme Care Xtra-Flex',
            why: 'Top de absorção noturna. Tem indicador de troca (linha amarela vira azul). Cara mas vale a pena pra dormir a noite toda.',
            url: az('B0BFXGY9B7'),
          },
        ],
      },
      {
        heading: 'Pra dia a dia: equilibre custo',
        paragraphs: [
          'Em casa, durante o dia, você troca a cada 3h de qualquer jeito. Não precisa da premium. Marca intermediária resolve.',
        ],
        products: [
          {
            name: 'Fralda Turma da Mônica Baby Jumbo M',
            why: 'Marca brasileira honesta. Absorção boa pro preço. Pacote jumbo faz render. Uso 80% do tempo aqui em casa.',
            url: az('B099KXW911'),
          },
          {
            name: 'Fralda Turma da Mônica Baby Mega XG',
            why: 'Pra bebê grande (9kg+). Mega pack mais econômico.',
            url: az('B099KV2733'),
          },
        ],
      },
      {
        heading: 'Tamanhos: o erro mais comum',
        paragraphs: [
          'Mãe de primeira viagem compra muito RN (recém-nascido) e quase nada de P. Resultado: 50% das fraldas RN sobram.',
          'Sugestão de estoque inicial (bebê médio de 3kg): 1 pacote RN, 2 P, 1 M. Vá ajustando conforme o bebê cresce.',
        ],
      },
      {
        heading: 'Quando trocar urgente',
        paragraphs: [
          'Indicador de troca virou: TROCA. Bebê chorando do nada + cara vermelha: provavelmente fez cocô. Cheiro forte: TROCA.',
          'Pele assada do bebê (vermelhidão na zona da fralda): pode ser alergia a uma marca específica. Troca por outra e veja se melhora em 2 dias.',
        ],
      },
    ],
  },

  'cadeirinha-de-carro': {
    title: 'Cadeirinha de carro segura: o guia completo',
    excerpt:
      'O que considerar na compra (NBR 14400, ISO-Fix, idade certa), e por que cadeirinha barata pode sair cara.',
    readTime: '10 min de leitura',
    updatedAt: '2026-05-21',
    sections: [
      {
        heading: 'A regra que pouca gente respeita',
        paragraphs: [
          'No Brasil é OBRIGATÓRIO criança em cadeirinha do nascimento até 7 anos e meio. Multa: R$ 293 + 7 pontos na CNH. Mas o problema não é a multa — é que cadeirinha mal escolhida ou mal instalada SALVA a criança em colisão a 30km/h.',
          'Em 80% dos acidentes infantis sem morte, a cadeirinha estava bem instalada. Quando não está: 4x mais chances de óbito.',
        ],
      },
      {
        heading: '3 sinais de uma cadeirinha segura',
        paragraphs: [
          '1) Selo INMETRO + Norma NBR 14400 (Brasil). Sem isso, é ilegal e não passou em testes de impacto.',
          '2) ISO-Fix ou Cinto de 3 pontos: ISO-Fix é mais seguro (engata direto no chassi) mas precisa que seu carro tenha. Carro novo (2010+) geralmente tem.',
          '3) Idade/peso compatível: cadeirinha de 0-13kg ≠ cadeirinha de 9-36kg. Comprar a errada gera falsa segurança.',
        ],
      },
      {
        heading: 'Bebê conforto (0-13kg, até 1 ano)',
        paragraphs: [
          'Os primeiros 12-15 meses, a criança DEVE ir de costas (sentido contrário ao motorista). Pescoço ainda não aguenta uma colisão frontal de frente.',
          'Bebê conforto bom também serve como carrinho de transporte da maternidade pra casa.',
        ],
        products: [
          {
            name: 'Cosco Kids Travel System Reverse',
            why: 'Sistema 3 em 1 — bebê conforto + carrinho + estrutura. Cobre dos 0-15kg. Inmetro + NBR 14400. Custo-benefício excelente.',
            url: az('B09B36RPVF'),
          },
        ],
      },
      {
        heading: 'Cadeirinha (9-36kg, 1-7 anos)',
        paragraphs: [
          'Depois de 1 ano e 15kg, troca pra cadeirinha de conversível ou específica de criança. Continua de costas até 2 anos se a cadeirinha permitir — proven mais seguro.',
          'A maioria das cadeirinhas modernas é "convertível" e cobre dos 9 aos 36kg, então é a única que você compra até os 7 anos.',
        ],
      },
      {
        heading: 'Erros comuns que matam',
        paragraphs: [
          '1) Cadeirinha frouxa: o cinto que prende a cadeirinha no banco do carro tem que estar APERTADO. Se você consegue mexer a cadeirinha mais de 2cm pros lados, está frouxa.',
          '2) Casaco grosso sob o cinto: NUNCA. Em impacto, casaco amassa e cinto fica frouxo demais. Coloque a criança SEM casaco, prenda o cinto, depois cobre por cima com cobertor.',
          '3) Cadeirinha de segunda mão sem histórico: se a cadeirinha já sofreu impacto, ela perde resistência. Compre nova ou de pessoa muito conhecida.',
          '4) Cadeirinha vencida: tem prazo de validade (geralmente 6-10 anos). Plástico envelhece e perde resistência ao UV.',
        ],
      },
      {
        heading: 'Banheira não substitui cadeirinha',
        paragraphs: [
          'Pareceu óbvio? Tem gente que leva bebê no colo ou em banheira/cesto "porque é só perto de casa". Acidente acontece a 200m de casa também.',
          'Resistência ao impacto da cadeirinha vem da estrutura interna projetada pra colisão. Banheira, cesto Moisés ou bebê no colo SÃO ARMA pra criança em colisão.',
        ],
        products: [
          {
            name: 'Banheira Para Bebê C/ Suporte Lift - Maxi Baby',
            why: 'SÓ pra banho em casa. Não substitui cadeirinha em carro nunca. Mas dentro de casa é ótima.',
            url: az('B0CGBNCPC5'),
          },
        ],
      },
      {
        heading: 'Instalação: faça você ler o manual',
        paragraphs: [
          'Cadeirinha mal instalada perde 80% da eficácia. NÃO confie só no vendedor da loja — leia o manual em casa e instale com calma.',
          'Detran do RJ e SP têm postos de checagem gratuita de cadeirinha. Em outras cidades, peça pra mecânico de confiança verificar.',
        ],
      },
    ],
  },
};
