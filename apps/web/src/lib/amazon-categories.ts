/**
 * BrowseNodes Amazon BR — IDs principais pra PA-API SearchItems.
 * Fonte: navegando categorias em amazon.com.br (URL contém node=NNNN).
 *
 * Lista curada das maiores categorias. Pra mais granularidade (subcats),
 * adiciona ID custom no campo "outras" da UI.
 */
export type AmazonCategory = {
  id: string; // BrowseNodeId Int64 como string
  name: string;
  emoji?: string;
};

export const AMAZON_CATEGORIES: AmazonCategory[] = [
  { id: '17873924011', name: 'Eletrônicos', emoji: '📱' },
  { id: '17873925011', name: 'Casa, Móveis e Decoração', emoji: '🏠' },
  { id: '17873929011', name: 'Cozinha', emoji: '🍳' },
  { id: '17873930011', name: 'Saúde e Cuidados Pessoais', emoji: '💊' },
  { id: '16306707011', name: 'Beleza', emoji: '💄' },
  { id: '17873954011', name: 'Esportes', emoji: '⚽' },
  { id: '17873953011', name: 'Brinquedos e Jogos', emoji: '🧸' },
  { id: '17873945011', name: 'Pet Shop', emoji: '🐾' },
  { id: '17873934011', name: 'Bebês', emoji: '🍼' },
  { id: '17873935011', name: 'Livros', emoji: '📚' },
  { id: '17873937011', name: 'Computadores e Informática', emoji: '💻' },
  { id: '17873939011', name: 'Eletrodomésticos', emoji: '🔌' },
  { id: '17873952011', name: 'Roupas, Calçados e Joias', emoji: '👔' },
  { id: '17873968011', name: 'Ferramentas e Construção', emoji: '🔨' },
  { id: '16957228011', name: 'Automotivo', emoji: '🚗' },
];
