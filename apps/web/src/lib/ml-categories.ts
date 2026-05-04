/**
 * Catálogo curado de categorias raiz e subcategorias do Mercado Livre BR.
 * Fonte: API pública sites/MLB/categories. Mantido estático para evitar
 * round-trip extra; o usuário pode complementar via API mais tarde.
 */
export type MlCategory = {
  id: string;
  name: string;
  children?: MlCategory[];
};

export const ML_CATEGORIES: MlCategory[] = [
  {
    id: 'MLB5726',
    name: 'Eletrodomésticos',
    children: [
      { id: 'MLB1574', name: 'Casa, Móveis e Decoração' },
      { id: 'MLB271599', name: 'Ar e Ventilação' },
      { id: 'MLB1051', name: 'Pequenos Eletrodomésticos' },
      { id: 'MLB271611', name: 'Refrigeração' },
    ],
  },
  {
    id: 'MLB1276',
    name: 'Esportes e Fitness',
    children: [
      { id: 'MLB126405', name: 'Bicicletas' },
      { id: 'MLB271605', name: 'Fitness e Musculação' },
      { id: 'MLB1289', name: 'Camping' },
    ],
  },
  {
    id: 'MLB1648',
    name: 'Eletrônicos, Áudio e Vídeo',
    children: [
      { id: 'MLB1144', name: 'Consoles e Videogames' },
      { id: 'MLB1000', name: 'TV e Vídeo' },
      { id: 'MLB1051', name: 'Áudio' },
    ],
  },
  {
    id: 'MLB1051',
    name: 'Celulares e Telefones',
    children: [
      { id: 'MLB1055', name: 'Celulares e Smartphones' },
      { id: 'MLB1499', name: 'Acessórios para Celulares' },
    ],
  },
  {
    id: 'MLB1499',
    name: 'Indústria e Comércio',
    children: [
      { id: 'MLB263532', name: 'Ferramentas' },
      { id: 'MLB263533', name: 'Ferramentas Elétricas' },
    ],
  },
  {
    id: 'MLB1430',
    name: 'Roupas e Calçados',
    children: [
      { id: 'MLB1431', name: 'Roupas Femininas' },
      { id: 'MLB1432', name: 'Roupas Masculinas' },
      { id: 'MLB1276', name: 'Calçados Esportivos' },
    ],
  },
  {
    id: 'MLB1132',
    name: 'Brinquedos e Hobbies',
  },
  {
    id: 'MLB1196',
    name: 'Livros, Revistas e Comics',
  },
];
