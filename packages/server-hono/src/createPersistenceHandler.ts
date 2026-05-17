import { Context } from 'hono';
import { CascadePersistence,handlePersistenceAction } from '@cascaide-ts/core';

export function createPersistenceHandler(persistor: CascadePersistence) {
  return async function (c: Context) {
    const { action, ...data } = await c.req.json();

    try {
      const result = await handlePersistenceAction(persistor, action, data);
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  };
}