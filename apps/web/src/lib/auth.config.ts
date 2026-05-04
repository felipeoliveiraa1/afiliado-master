import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe auth config (no Node-only deps like bcrypt).
 * Used by `middleware.ts` to gate routes; the full config with the
 * Credentials provider lives in `auth.ts`.
 */
export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [],
  callbacks: {
    authorized: ({ auth, request }) => {
      const isLogged = Boolean(auth);
      const url = new URL(request.url);
      if (url.pathname.startsWith('/login')) return true;
      if (url.pathname.startsWith('/api/auth')) return true;
      return isLogged;
    },
  },
};
