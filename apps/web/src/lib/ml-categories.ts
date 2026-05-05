/**
 * Catálogo COMPLETO de categorias raiz do Mercado Livre BR — paridade com
 * Divulga Links. IDs vêm da API pública /sites/MLB/categories (estáveis).
 *
 * Subcategorias incluídas são as mais comuns/úteis pra busca de promoções.
 * Catálogo total é massivo (centenas) — mantemos curado pra não poluir UI.
 * Se faltar subcat específica, edita aqui ou usa categoria raiz que cobre.
 */
export type MlCategory = {
  id: string;
  name: string;
  children?: MlCategory[];
};

export const ML_CATEGORIES: MlCategory[] = [
  { id: 'MLB5672', name: 'Acessórios para Veículos', children: [
    { id: 'MLB1745', name: 'Acessórios para Carros' },
    { id: 'MLB1747', name: 'Pneus e Acessórios' },
    { id: 'MLB1772', name: 'Som Automotivo' },
  ]},
  { id: 'MLB271599', name: 'Agro' },
  { id: 'MLB1071', name: 'Animais', children: [
    { id: 'MLB1075', name: 'Cachorros' },
    { id: 'MLB1077', name: 'Gatos' },
    { id: 'MLB1081', name: 'Pássaros' },
    { id: 'MLB1086', name: 'Peixes' },
  ]},
  { id: 'MLB1367', name: 'Antiguidades e Coleções' },
  { id: 'MLB1368', name: 'Arte, Papelaria e Armarinho', children: [
    { id: 'MLB1370', name: 'Materiais Escolares' },
    { id: 'MLB1372', name: 'Artesanato' },
  ]},
  { id: 'MLB1384', name: 'Bebês', children: [
    { id: 'MLB1387', name: 'Roupas de Bebê' },
    { id: 'MLB1389', name: 'Carrinhos e Acessórios' },
    { id: 'MLB1394', name: 'Higiene e Cuidados' },
    { id: 'MLB1399', name: 'Brinquedos para Bebês' },
  ]},
  { id: 'MLB1246', name: 'Beleza e Cuidado Pessoal', children: [
    { id: 'MLB1248', name: 'Cuidados com a Pele' },
    { id: 'MLB1250', name: 'Maquiagem' },
    { id: 'MLB1257', name: 'Perfumes' },
    { id: 'MLB263002', name: 'Manicure e Pedicure' },
  ]},
  { id: 'MLB1132', name: 'Brinquedos e Hobbies', children: [
    { id: 'MLB1141', name: 'Bonecos e Bonecas' },
    { id: 'MLB1142', name: 'Carros e Veículos de Brinquedo' },
    { id: 'MLB1147', name: 'Jogos de Tabuleiro' },
    { id: 'MLB1149', name: 'Brinquedos para Bebês' },
  ]},
  { id: 'MLB1430', name: 'Calçados, Roupas e Bolsas', children: [
    { id: 'MLB1433', name: 'Roupas Femininas' },
    { id: 'MLB1432', name: 'Roupas Masculinas' },
    { id: 'MLB1438', name: 'Calçados Femininos' },
    { id: 'MLB1437', name: 'Calçados Masculinos' },
    { id: 'MLB1440', name: 'Bolsas e Carteiras' },
  ]},
  { id: 'MLB1039', name: 'Câmeras e Acessórios', children: [
    { id: 'MLB1041', name: 'Câmeras Digitais' },
    { id: 'MLB1043', name: 'Acessórios para Câmeras' },
    { id: 'MLB417880', name: 'Câmeras de Ação' },
  ]},
  { id: 'MLB1574', name: 'Casa, Móveis e Decoração', children: [
    { id: 'MLB1576', name: 'Móveis para Casa' },
    { id: 'MLB1578', name: 'Decoração' },
    { id: 'MLB1582', name: 'Cama, Mesa e Banho' },
    { id: 'MLB1584', name: 'Cozinha' },
  ]},
  { id: 'MLB1051', name: 'Celulares e Telefones', children: [
    { id: 'MLB1055', name: 'Smartphones' },
    { id: 'MLB1056', name: 'Acessórios para Celulares' },
    { id: 'MLB1058', name: 'Smartwatches e Acessórios' },
    { id: 'MLB1054', name: 'Tablets' },
  ]},
  { id: 'MLB263532', name: 'Construção', children: [
    { id: 'MLB263533', name: 'Materiais de Construção' },
    { id: 'MLB263534', name: 'Elétrica' },
    { id: 'MLB263535', name: 'Pintura' },
  ]},
  { id: 'MLB5726', name: 'Eletrodomésticos', children: [
    { id: 'MLB271611', name: 'Refrigeração' },
    { id: 'MLB191694', name: 'Lavanderia' },
    { id: 'MLB191695', name: 'Cocção' },
    { id: 'MLB271599', name: 'Ar e Ventilação' },
  ]},
  { id: 'MLB1000', name: 'Eletrônicos, Áudio e Vídeo', children: [
    { id: 'MLB1002', name: 'TVs' },
    { id: 'MLB1003', name: 'Áudio' },
    { id: 'MLB1004', name: 'Home Theater e Projetores' },
    { id: 'MLB1014', name: 'Acessórios de TV' },
  ]},
  { id: 'MLB1276', name: 'Esportes e Fitness', children: [
    { id: 'MLB126405', name: 'Bicicletas' },
    { id: 'MLB271605', name: 'Fitness e Musculação' },
    { id: 'MLB1289', name: 'Camping' },
    { id: 'MLB1284', name: 'Caça e Pesca' },
    { id: 'MLB1280', name: 'Esportes Aquáticos' },
  ]},
  { id: 'MLB1499', name: 'Ferramentas', children: [
    { id: 'MLB272029', name: 'Ferramentas Elétricas' },
    { id: 'MLB272030', name: 'Ferramentas Manuais' },
  ]},
  { id: 'MLB1953', name: 'Festas e Lembrancinhas' },
  { id: 'MLB1144', name: 'Games', children: [
    { id: 'MLB1146', name: 'Consoles e Vídeo Games' },
    { id: 'MLB1148', name: 'Jogos para Consoles' },
    { id: 'MLB186456', name: 'Acessórios para Consoles' },
  ]},
  { id: 'MLB1500', name: 'Indústria e Comércio' },
  { id: 'MLB1648', name: 'Informática', children: [
    { id: 'MLB1652', name: 'Notebooks e Acessórios' },
    { id: 'MLB1700', name: 'Componentes para PC' },
    { id: 'MLB1672', name: 'Periféricos para PC' },
    { id: 'MLB1659', name: 'Armazenamento' },
    { id: 'MLB1665', name: 'Impressão' },
  ]},
  { id: 'MLB1182', name: 'Instrumentos Musicais' },
  { id: 'MLB3937', name: 'Joias e Relógios', children: [
    { id: 'MLB3938', name: 'Relógios' },
    { id: 'MLB3939', name: 'Joias' },
  ]},
  { id: 'MLB1196', name: 'Livros, Revistas e Comics' },
  { id: 'MLB1168', name: 'Música, Filmes e Seriados' },
  { id: 'MLB1540', name: 'Saúde', children: [
    { id: 'MLB1542', name: 'Suplementos Alimentares' },
    { id: 'MLB1546', name: 'Equipamentos Médicos' },
    { id: 'MLB1548', name: 'Cuidado da Saúde' },
  ]},
  { id: 'MLB1907', name: 'Serviços' },
];
