import { FastifyRequest, FastifyReply } from 'fastify';
import { PassThrough } from 'node:stream';
import { createServerStore, WorkflowHandlerConfig, setupServerWorkflowListener } from '@cascaide-ts/core';

function createPassThroughStreamControl(passThrough: PassThrough) {
  let resolveWorkflowDone!: () => void;
  const workflowDone = new Promise<void>((resolve) => {
    resolveWorkflowDone = resolve;
  });

  const streamControl = {
    send: async (data: any) => void passThrough.write(JSON.stringify(data) + '\n'),
    writeRaw: async (data: string) => void passThrough.write(data),
    close: async () => {
      passThrough.end();
      resolveWorkflowDone();
    },
  };

  return { streamControl, workflowDone };
}

export function createFastifyWorkflowHandler(config: WorkflowHandlerConfig) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const relayedAction = req.body as any;
    const startTime = Date.now();
    const { store, serverListener } = createServerStore(
      config.persistor,
      config.extraMiddlewares ?? []
    );
    const isLite = !config.persistor


    const passThrough = new PassThrough();
    const { streamControl, workflowDone } = createPassThroughStreamControl(passThrough);

    reply
      .header('Content-Type', 'text/event-stream')
      .header('Cache-Control', 'no-cache')
      .send(passThrough);

    setupServerWorkflowListener(
      serverListener,
      {
        workflowGraph: config.workflowGraph,
        maxExecutionTime: config.maxExecutionTime || 30000,
        safeBuffer: config.safeBuffer || 2000,
      },
      streamControl,
      { chainDepth: { current: 0 } },
      startTime,
      isLite
    );

    store.dispatch(relayedAction);

    const timeout = setTimeout(
      () => passThrough.end(),
      (config.maxExecutionTime || 30000) + (config.safeBuffer || 2000)
    );

    await workflowDone;
    clearTimeout(timeout);

    return reply;
  };
}