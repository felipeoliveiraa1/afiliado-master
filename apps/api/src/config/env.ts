import { cleanEnv, str, num, port, url, bool } from 'envalid';
import 'dotenv/config';

export const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),
  PORT: port({ default: 3000 }),
  LOG_LEVEL: str({ default: 'info' }),
  /** Skip BullMQ workers + cron (HTTP only); use to debug infra without Redis jobs. */
  API_DISABLE_BACKGROUND: bool({ default: false }),

  DATABASE_URL: url(),

  REDIS_HOST: str({ default: 'localhost' }),
  REDIS_PORT: port({ default: 6379 }),
  REDIS_PASSWORD: str({ default: '' }),

  EVOLUTION_API_URL: url(),
  EVOLUTION_API_KEY: str(),
  EVOLUTION_DEFAULT_INSTANCE: str(),

  OPENAI_API_KEY: str(),
  OPENAI_MODEL: str({ default: 'gpt-4o-mini' }),

  SHOPEE_APP_ID: str({ default: '' }),
  SHOPEE_APP_SECRET: str({ default: '' }),

  SHOPEE_PANEL_AUTO_ENABLED: bool({ default: false }),
  SHOPEE_PANEL_COOKIE: str({ default: '' }),
  SHOPEE_PANEL_GENERATE_ENDPOINT: str({ default: '' }),
  SHOPEE_PANEL_CSRF_TOKEN: str({ default: '' }),
  SHOPEE_PANEL_DAILY_LIMIT: num({ default: 25 }),
  SHOPEE_PANEL_MIN_INTERVAL_SEC: num({ default: 45 }),
  SHOPEE_PANEL_MAX_INTERVAL_SEC: num({ default: 180 }),

  AMAZON_AFFILIATE_TAG: str({ default: '' }),
  APIFY_TOKEN: str({ default: '' }),
  APIFY_MERCADOLIVRE_ACTOR: str({ default: 'apify~mercadolibre-scraper' }),

  // PA-API 5 (Product Advertising API oficial). Liberada após 10 vendas
  // qualificadas em 180 dias. Quando vazias, adapter lança erro claro.
  AMAZON_PAAPI_ACCESS_KEY: str({ default: '' }),
  AMAZON_PAAPI_SECRET_KEY: str({ default: '' }),
  AMAZON_PAAPI_PARTNER_TAG: str({ default: '' }),
  AMAZON_PAAPI_HOST: str({ default: 'webservices.amazon.com.br' }),
  AMAZON_PAAPI_REGION: str({ default: 'us-east-1' }),
  AMAZON_PAAPI_BROWSE_NODES: str({ default: '' }),

  MERCADOLIVRE_AFFILIATE_TAG: str({ default: '' }),
  MERCADOLIVRE_SESSION_COOKIE: str({ default: '' }),
  MERCADOLIVRE_SCRAPER: str({ choices: ['public-api', 'apify'], default: 'public-api' }),
  MERCADOLIVRE_APIFY_START_URLS: str({ default: '' }),

  MERCADOLIVRE_PANEL_AUTO_ENABLED: bool({ default: false }),
  MERCADOLIVRE_PANEL_COOKIE: str({ default: '' }),
  MERCADOLIVRE_PANEL_DEFAULT_TAG: str({ default: '' }),
  MERCADOLIVRE_PANEL_DAILY_LIMIT: num({ default: 30 }),
  MERCADOLIVRE_PANEL_MIN_INTERVAL_SEC: num({ default: 45 }),
  MERCADOLIVRE_PANEL_MAX_INTERVAL_SEC: num({ default: 180 }),

  DISPATCH_MIN_INTERVAL: num({ default: 45 }),
  DISPATCH_MAX_INTERVAL: num({ default: 180 }),
  DISPATCH_DAILY_LIMIT_PER_INSTANCE: num({ default: 300 }),
  DISPATCH_WINDOW_START: num({ default: 8 }),
  DISPATCH_WINDOW_END: num({ default: 22 }),

  CLICK_TRACKING_ENABLED: bool({ default: false }),
  PUBLIC_BASE_URL: str({ default: 'http://localhost:3000' }),

  WEB_ORIGIN_URL: str({ default: 'http://localhost:3001' }),

  ADMIN_ALERT_GROUP_ID: str({ default: '' }),
});
