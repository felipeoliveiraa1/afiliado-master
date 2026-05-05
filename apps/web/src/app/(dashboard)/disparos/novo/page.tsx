import { redirect } from 'next/navigation';

// Wizard antigo unificado em /campaigns (página única com form inline).
// Mantém esta rota como redirect pra não quebrar links salvos.
export default function NovoDisparoRedirect(): never {
  redirect('/campaigns');
}
