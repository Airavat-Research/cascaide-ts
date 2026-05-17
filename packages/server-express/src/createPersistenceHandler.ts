import { Request, Response } from 'express';
import { CascadePersistence, handlePersistenceAction } from '@cascaide-ts/core';

export function createPersistenceHandler(persistor: CascadePersistence) {
  return async function (req: Request, res: Response) {
    const { action, ...data } = req.body;

    try {
      const result = await handlePersistenceAction(persistor, action, data);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  };
}