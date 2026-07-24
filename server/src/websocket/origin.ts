import type { IncomingMessage } from 'node:http';
import type { ServerConfig } from '../config.js';

export const isOriginAllowed = (request: IncomingMessage, config: ServerConfig): boolean => {
  const origin = request.headers.origin;
  if (config.nodeEnv !== 'production' && !origin) return true;
  if (!origin) return false;
  if (config.allowedOrigins.has(origin)) return true;
  if (config.nodeEnv !== 'production') {
    try {
      const url = new URL(origin);
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }
  return false;
};
