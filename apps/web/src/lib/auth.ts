import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { authConfig } from './auth.config';

/**
 * Lê o hash bcrypt do owner. O Next/@next/env expande `$` em valores de env
 * mesmo dentro de aspas simples (não respeita o quoting do dotenv padrão), o
 * que corrompe um hash bcrypt como `$2a$10$...`. Armazenamos em base64 e
 * decodamos aqui para contornar a expansion.
 *
 * Aceita ambos `OWNER_PASSWORD_HASH_B64` (preferido) e `OWNER_PASSWORD_HASH`
 * (legado, só funciona se não tiver `$`).
 */
function readOwnerPasswordHash(): string {
  const b64 = process.env.OWNER_PASSWORD_HASH_B64;
  if (b64) return Buffer.from(b64, 'base64').toString('utf-8');
  return process.env.OWNER_PASSWORD_HASH ?? '';
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      authorize: async (credentials) => {
        const ownerEmail = process.env.OWNER_EMAIL ?? '';
        const ownerPasswordHash = readOwnerPasswordHash();
        const email = String(credentials?.email ?? '').toLowerCase();
        const password = String(credentials?.password ?? '');
        if (!email || !password) return null;
        if (!ownerEmail || !ownerPasswordHash) {
          console.error('[auth] OWNER_EMAIL/OWNER_PASSWORD_HASH(_B64) não configurados', {
            hasEmail: Boolean(ownerEmail),
            hasHash: Boolean(ownerPasswordHash),
            hashLen: ownerPasswordHash.length,
          });
          throw new Error('OWNER_EMAIL/OWNER_PASSWORD_HASH não configurados');
        }
        if (email !== ownerEmail.toLowerCase()) return null;
        const ok = await bcrypt.compare(password, ownerPasswordHash);
        if (!ok) return null;
        return { id: 'owner', email, name: 'Owner' };
      },
    }),
  ],
});
