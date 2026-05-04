import { CookieForm } from '@/components/cookie-form';

export default function ShopeeCookiePage(): React.ReactElement {
  return (
    <CookieForm
      marketplace="SHOPEE"
      title="Cookie Shopee Affiliate"
      panelUrl="https://affiliate.shopee.com.br"
      envVarName="SHOPEE_PANEL_COOKIE"
    />
  );
}
