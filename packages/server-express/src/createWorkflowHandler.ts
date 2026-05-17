import { Request, Response } from 'express';
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

export function createExpressWorkflowHandler(config: WorkflowHandlerConfig) {
  return async function (req: Request, res: Response) {
    const relayedAction = req.body;
    const startTime = Date.now();
    const { store, serverListener } = createServerStore(
      config.persistor,
      config.extraMiddlewares ?? []
    );
    const isLite = !config.persistor


    const passThrough = new PassThrough();
    const { streamControl, workflowDone } = createPassThroughStreamControl(passThrough);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    passThrough.pipe(res);

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
  };
}