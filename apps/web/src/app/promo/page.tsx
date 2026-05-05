import { redirect } from 'next/navigation';

// /promo é alias da raiz / — landing principal está em app/page.tsx
// Mantido por compat caso anúncios antigos apontem pra /promo.
export default function PromoRedirect(): never {
  redirect('/');
}
