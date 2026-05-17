import { NextRequest } from 'next/server';
import { 
  WorkflowHandlerConfig
} from '@cascaide-ts/core';
import { setupServerWorkflowListener, StreamControl } from '@cascaide-ts/core';
import { createServerStore } from '@cascaide-ts/core';

const METADATA_DELIMITER = '\n__END_STREAM_METADATA__\n';

export function createWorkflowHandler(config: WorkflowHandlerConfig) {
  return async function POST(req: NextRequest) {
    const relayedAction = await req.json();
    const startTime = Date.now();
    
    const { store, serverListener } = createServerStore(
      config.persistor,
      config.extraMiddlewares ?? []  
    );
    
    const stream = new TransformStream(); 
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    const isLite = !config.persistor

    // ─── Implementation of the StreamControl Interface ───
    const streamControl: StreamControl = {
      // Sends standard JSON updates + newline
      send: async (data: any) => {
        await writer.write(encoder.encode(JSON.stringify(data) + '\n'));
      },
      // Sends raw strings (like the Metadata Delimiter)
      writeRaw: async (data: string) => {
        await writer.write(encoder.encode(data));
      },
      // Handles the specific Next.js/Web stream closing logic
      close: async () => {
        if (writer.desiredSize !== null) {
          await writer.close();
        }
      }
    };

    const counters = {
      chainDepth: { current: 0 }
    };

    // Pass the abstracted streamControl instead of the raw writer
    setupServerWorkflowListener(
      serverListener,
      {
        workflowGraph: config.workflowGraph,
        maxExecutionTime: config.maxExecutionTime ?? 55000, // Default to 55s for Vercel
        safeBuffer: config.safeBuffer ?? 5000,
      },
      streamControl,
      counters,
      startTime,
      isLite
    );

    // Bootstrap the process
    store.dispatch(relayedAction);

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  };
}