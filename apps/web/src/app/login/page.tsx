import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Entrar',
};

export default function LoginPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
