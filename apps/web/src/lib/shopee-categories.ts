/**
 * Categorias Shopee BR — Level 1 (productCatId).
 * Fonte: https://seller.shopee.com.br/edu/category-guide
 *
 * Mantemos só Level 1 (mais comuns). Pra subcategorias, edita aqui ou
 * adiciona ID custom no campo "outras categorias" da UI.
 */
export type ShopeeCategory = {
  id: string; // numérico string
  name: string;
  emoji?: string;
};

export const SHOPEE_CATEGORIES: ShopeeCategory[] = [
  { id: '100012', name: 'Moda Feminina', emoji: '👗' },
  { id: '100013', name: 'Eletrônicos', emoji: '📱' },
  { id: '100018', name: 'Casa e Decoração', emoji: '🏠' },
  { id: '100022', name: 'Saúde e Beleza', emoji: '💄' },
  { id: '100039', name: 'Esporte e Lazer', emoji: '⚽' },
  { id: '100040', name: 'Acessórios de Moda', emoji: '👜' },
  { id: '100041', name: 'Moda Masculina', emoji: '👔' },
  { id: '100042', name: 'Mãe e Bebê', emoji: '🍼' },
  { id: '100043', name: 'Pet Shop', emoji: '🐾' },
  { id: '100044', name: 'Brinquedos', emoji: '🧸' },
  { id: '100045', name: 'Livros e Papelaria', emoji: '📚' },
  { id: '100046', name: 'Computadores', emoji: '💻' },
  { id: '100048', name: 'Calçados', emoji: '👟' },
  { id: '100050', name: 'Hobbies e Coleções', emoji: '🎨' },
  { id: '100053', name: 'Áudio', emoji: '🎧' },
  { id: '100066', name: 'Eletrodomésticos', emoji: '🔌' },
  { id: '100256', name: 'Maquiagem', emoji: '💋' },
  { id: '100623', name: 'Automotivo', emoji: '🚗' },
  { id: '100628', name: 'Ferramentas', emoji: '🔨' },
  { id: '100629', name: 'Cuidado Pessoal', emoji: '🧴' },
];
