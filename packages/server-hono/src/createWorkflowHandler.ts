import { Context } from 'hono';
import { stream } from 'hono/streaming';
import { createServerStore, WorkflowHandlerConfig, setupServerWorkflowListener } from '@cascaide-ts/core';


export function createHonoWorkflowHandler(config: WorkflowHandlerConfig) {
  return async function (c: Context) {
    const relayedAction = await c.req.json();
    const startTime = Date.now();
    const { store, serverListener } = createServerStore(
      config.persistor,
      config.extraMiddlewares ?? []
    );
    const isLite = !config.persistor


    return stream(c, async (s) => {
      const streamControl = {
        send: async (data: any) => void await s.write(JSON.stringify(data) + '\n'),
        writeRaw: async (data: string) => void await s.write(data),
        close: async () => void await s.close(),
      };

      // Promise that resolves when the listener calls close()
      let resolveWorkflowDone!: () => void;
      const workflowDone = new Promise<void>((resolve) => {
        resolveWorkflowDone = resolve;
      });

      // Wrap close() so we know when the listener is truly finished
      const wrappedStreamControl = {
        ...streamControl,
        close: async () => {
          await streamControl.close();
          resolveWorkflowDone(); // unblock the generator
        },
      };

      setupServerWorkflowListener(
        serverListener,
        {
          workflowGraph: config.workflowGraph,
          maxExecutionTime: config.maxExecutionTime || 30000,
          safeBuffer: config.safeBuffer || 2000,
        },
        wrappedStreamControl,
        { chainDepth: { current: 0 } },
        startTime,
        isLite
      );

      store.dispatch(relayedAction);

      // Safety timeout so we never hang forever
      const timeout = setTimeout(
        resolveWorkflowDone,
        (config.maxExecutionTime || 30000) + (config.safeBuffer || 2000)
      );

      await workflowDone;
      clearTimeout(timeout);
    });
  };
}