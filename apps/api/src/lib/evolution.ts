import { request } from 'undici';
import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';

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

const baseHeaders = () => ({
  'Content-Type': 'application/json',
  apikey: env.EVOLUTION_API_KEY,
});

async function callEvolution<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const url = `${env.EVOLUTION_API_URL.replace(/\/$/, '')}${path}`;
  const res = await request(url, {
    method,
    headers: baseHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.body.text();
  if (res.statusCode >= 400) {
    logger.error({ url, status: res.statusCode, body: text }, 'evolution error');
    throw new Error(`Evolution ${method} ${path} -> ${res.statusCode}: ${text}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export const evolution = {
  async listInstances() {
    return callEvolution('GET', '/instance/fetchInstances');
  },

  async sendText({ instance, to, text, delayMs = 0 }: SendTextArgs) {
    const inst = instance || env.EVOLUTION_DEFAULT_INSTANCE;
    return callEvolution('POST', `/message/sendText/${inst}`, {
      number: to,
      text,
      delay: delayMs,
    });
  },

  async sendMedia({ instance, to, mediaUrl, mediaType, caption, fileName, delayMs = 0 }: SendMediaArgs) {
    const inst = instance || env.EVOLUTION_DEFAULT_INSTANCE;
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
    const inst = instance || env.EVOLUTION_DEFAULT_INSTANCE;
    return callEvolution('GET', `/group/fetchAllGroups/${inst}?getParticipants=false`);
  },
};
