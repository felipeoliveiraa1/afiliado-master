import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Pula middleware pra: rotas auth, assets do Next, favicon E qualquer arquivo
  // estático em /public (png/jpg/svg/etc). Sem isso, /foto2.png redirecionava
  // pro login e a logo da landing aparecia quebrada.
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff|woff2|ttf|css|js|map)$).*)',
  ],
};
