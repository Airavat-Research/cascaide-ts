import { FastifyRequest, FastifyReply } from 'fastify';
import { CascadePersistence, handlePersistenceAction } from '@cascaide-ts/core';

export function createPersistenceHandler(persistor: CascadePersistence) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const { action, ...data } = req.body as any;

    try {
      const result = await handlePersistenceAction(persistor, action, data);
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  };
}