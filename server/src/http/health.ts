import type { Request, Response } from 'express';
import type { RoomRegistry } from '../rooms/roomRegistry.js';

export const live = (_request: Request, response: Response): void => {
  response.json({ status: 'ok' });
};

export const ready = (registry: RoomRegistry) =>
  (_request: Request, response: Response): void => {
    const overloaded = [...registry.rooms.values()].some((room) => room.queue.size >= 200);
    response.status(overloaded ? 503 : 200).json({
      status: overloaded ? 'busy' : 'ready',
      rooms: registry.rooms.size
    });
  };
