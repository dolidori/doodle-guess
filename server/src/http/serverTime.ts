import type { Request, Response } from 'express';

export const serverTime = (_request: Request, response: Response): void => {
  const serverReceivedAt = Date.now();
  response.setHeader('Cache-Control', 'no-store');
  response.json({ serverReceivedAt, serverSentAt: Date.now() });
};
