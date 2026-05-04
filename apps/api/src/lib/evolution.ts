import { request } from 'undici';
import { logger } from '@/lib/logger.js';
import { getSettingsSection } from '@/lib/settings.js';

type SendTextArgs = {
  instance?: string;
  to: string;
  text: string;
  delayMs?: number;
};

type SendMediaArgs = {
  instance?: string;
  to: string;
  mediaUrl: string;
  mediaType: 'image' | 'video' | 'document';
  caption?: string;
  fileName?: string;
  delayMs?: number;
};

type EvolutionConfig = {
  apiUrl?: string;
  apiKey?: string;
  defaultInstance?: string;
};

async function getConfig(): Promise<EvolutionConfig> {
  return getSettingsSection<EvolutionConfig>('evolution');
}

async function callEvolution<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const cfg = await getConfig();
  if (!cfg.apiUrl || !cfg.apiKey) {
    throw new Error(
      'Evolution não configurada (apiUrl/apiKey vazios). Acesse /settings → Evolution no painel.',
    );
  }
  const url = `${cfg.apiUrl.replace(/\/$/, '')}${path}`;
  const res = await request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: cfg.apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.body.text();
  if (res.statusCode >= 400) {
    logger.error({ url, status: res.statusCode, body: text.slice(0, 500) }, 'evolution error');
    throw new Error(`Evolution ${method} ${path} -> ${res.statusCode}: ${text.slice(0, 200)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function resolveInstance(override?: string): Promise<string> {
  if (override) return override;
  const cfg = await getConfig();
  if (!cfg.defaultInstance) throw new Error('Nenhuma instância default configurada (Evolution settings).');
  return cfg.defaultInstance;
}

export const evolution = {
  async listInstances() {
    return callEvolution('GET', '/instance/fetchInstances');
  },

  async sendText({ instance, to, text, delayMs = 0 }: SendTextArgs) {
    const inst = await resolveInstance(instance);
    return callEvolution('POST', `/message/sendText/${inst}`, {
      number: to,
      text,
      delay: delayMs,
    });
  },

  async sendMedia({ instance, to, mediaUrl, mediaType, caption, fileName, delayMs = 0 }: SendMediaArgs) {
    const inst = await resolveInstance(instance);
    return callEvolution('POST', `/message/sendMedia/${inst}`, {
      number: to,
      mediatype: mediaType,
      media: mediaUrl,
      caption,
      fileName,
      delay: delayMs,
    });
  },

  async listGroups(instance?: string) {
    const inst = await resolveInstance(instance);
    return callEvolution('GET', `/group/fetchAllGroups/${inst}?getParticipants=false`);
  },
};
