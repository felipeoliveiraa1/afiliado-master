import { CookieForm } from '@/components/cookie-form';

export default function MercadoLivreCookiePage(): React.ReactElement {
  return (
    <CookieForm
      marketplace="MERCADOLIVRE"
      title="Cookie Mercado Livre Afiliados"
      panelUrl="https://www.mercadolivre.com.br/afiliados/hub?is_affiliate=true"
      envVarName="MERCADOLIVRE_PANEL_COOKIE"
    />
  );
}
